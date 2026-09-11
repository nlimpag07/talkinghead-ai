import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { getClientIp, hashIp } from "@/lib/hash";
import { loadSessionConfig } from "@/services/session-config";
import {
  createLiveToken,
  LiveUpstreamError,
  type LiveToken,
} from "@/services/gemini/live";
import type {
  ConversationErrorBody,
  StartConversationResponse,
} from "@/types/realtime";

// Prisma and node:crypto both require the Node runtime.
export const runtime = "nodejs";
// A cached ephemeral token is a broken session at best.
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const ipHash = hashIp(getClientIp(request.headers));
  const cutoff = new Date(Date.now() - env.SESSION_MAX_SECONDS * 1000);

  try {
    // Sessions that outlived the cap without reporting an end are abandoned:
    // the tab closed, the network dropped, the browser was killed. Sweeping
    // them here keeps the concurrency check honest without a cron job.
    await prisma.conversation.updateMany({
      where: { status: "ACTIVE", startedAt: { lt: cutoff } },
      data: { status: "ABANDONED", endedAt: new Date() },
    });

    const active = await prisma.conversation.count({
      where: { ipHash, status: "ACTIVE", startedAt: { gte: cutoff } },
    });

    if (active >= env.MAX_SESSIONS_PER_IP) {
      return errorResponse(
        429,
        "You already have a conversation open. End it before starting another.",
        "concurrent_limit",
      );
    }

    const config = await loadSessionConfig();

    // The row is written before the token is minted. The count above is only
    // meaningful if concurrent requests can see each other's rows, and minting
    // first left that window open for a whole upstream round-trip — long
    // enough for a rapid-fire caller to mint an unbounded number of tokens,
    // every one of them a billable session.
    //
    // The window is now two adjacent queries wide rather than a network call
    // wide. It is not closed: count-then-insert is still not atomic. Closing
    // it needs the Redis counter from slice 7, or a serializable transaction
    // with retry on 40001.
    const conversation = await prisma.conversation.create({
      data: {
        ipHash,
        userAgent: request.headers.get("user-agent")?.slice(0, 512) ?? null,
        realtimeModel: config.model,
        voice: config.voice,
      },
      select: { id: true },
    });

    let secret: LiveToken;
    try {
      secret = await createLiveToken(config);
    } catch (error) {
      // A failed mint must not leave an ACTIVE row counting against this
      // visitor's cap — an upstream outage would otherwise lock them out for
      // SESSION_MAX_SECONDS.
      await prisma.conversation
        .delete({ where: { id: conversation.id } })
        .catch(() => {
          // Orphan at worst. The sweep above reclassifies it as ABANDONED.
        });
      throw error;
    }

    const body: StartConversationResponse = {
      conversationId: conversation.id,
      clientSecret: secret.value,
      clientSecretExpiresAt: secret.expiresAt,
      model: config.model,
      voice: config.voice,
      maxSessionSeconds: env.SESSION_MAX_SECONDS,
    };

    return NextResponse.json(body, {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof LiveUpstreamError) {
      // The cause names the field that was rejected, which is the only useful
      // debugging signal when the session shape drifts. Logged, never
      // returned — it can echo the session configuration.
      console.error("Live upstream error", error.message, error.cause);
      return errorResponse(
        502,
        "Could not reach the voice service. Try again in a moment.",
        "upstream_error",
      );
    }

    console.error("Failed to start conversation", error);
    return errorResponse(
      500,
      "Could not start a conversation.",
      "upstream_error",
    );
  }
}

function errorResponse(
  status: number,
  message: string,
  code: ConversationErrorBody["code"],
): Response {
  const body: ConversationErrorBody = { error: message, code };
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
