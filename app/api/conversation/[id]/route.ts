import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { estimateCostUsd } from "@/lib/pricing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const endSessionSchema = z.object({
  status: z.enum(["COMPLETED", "ABANDONED", "FAILED"]),
  usage: z.object({
    audioInputTokens: z.number().int().min(0).max(50_000_000),
    audioOutputTokens: z.number().int().min(0).max(50_000_000),
    textInputTokens: z.number().int().min(0).max(50_000_000),
    textOutputTokens: z.number().int().min(0).max(50_000_000),
    cachedInputTokens: z.number().int().min(0).max(50_000_000),
  }),
  firstAudioLatencyMs: z.number().int().min(0).max(120_000).nullable(),
  turnCount: z.number().int().min(0).max(10_000),
  interruptionCount: z.number().int().min(0).max(10_000),
});

/**
 * Anonymous callers, so the conversation id is the only credential. It is a
 * cuid2 with enough entropy to be unguessable, and this handler refuses
 * anything that is not currently ACTIVE — so a leaked id buys a single write
 * on a session that is already over.
 *
 * The counts are attacker-controlled. They are bounded above, which keeps a
 * hostile client from poisoning the cost dashboard with absurd figures; they
 * are not trustworthy in any stronger sense. Treat Analytics as observability,
 * never as billing truth.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Malformed body.", code: "invalid_request" },
      { status: 400 },
    );
  }

  const parsed = endSessionSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid session report.", code: "invalid_request" },
      { status: 400 },
    );
  }

  const { status, usage, firstAudioLatencyMs, turnCount, interruptionCount } =
    parsed.data;

  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id },
      select: { id: true, status: true, startedAt: true, realtimeModel: true },
    });

    if (!conversation) {
      return NextResponse.json(
        { error: "No such conversation.", code: "invalid_request" },
        { status: 404 },
      );
    }

    if (conversation.status !== "ACTIVE") {
      // Already swept or already reported. Not an error worth surfacing —
      // the client fires this on unload and may fire it twice.
      return NextResponse.json({ alreadyClosed: true }, { status: 200 });
    }

    const endedAt = new Date();
    const durationSeconds = Math.round(
      (endedAt.getTime() - conversation.startedAt.getTime()) / 1000,
    );
    const estimatedCostUsd = estimateCostUsd(conversation.realtimeModel, usage);

    await prisma.$transaction([
      prisma.conversation.update({
        where: { id },
        data: {
          status,
          endedAt,
          ...usage,
          estimatedCostUsd,
          firstAudioLatencyMs,
          turnCount,
          interruptionCount,
        },
      }),
      prisma.analytics.createMany({
        data: [
          {
            conversationId: id,
            metric: "session.cost_usd",
            value: estimatedCostUsd,
            metadata: { model: conversation.realtimeModel },
          },
          {
            conversationId: id,
            metric: "session.duration_seconds",
            value: durationSeconds,
            metadata: {
              status,
              // A session that ran the full cap almost certainly did not end
              // because the visitor was finished.
              hitCap: durationSeconds >= env.SESSION_MAX_SECONDS,
            },
          },
        ],
      }),
    ]);

    return NextResponse.json(
      { estimatedCostUsd, durationSeconds },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Failed to close conversation", error);
    return NextResponse.json(
      { error: "Could not close the conversation.", code: "upstream_error" },
      { status: 500 },
    );
  }
}
