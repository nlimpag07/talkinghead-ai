import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Appends arrive after the session ends, so a grace window is required. */
const APPEND_GRACE_MS = 60_000;

const appendSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        sequence: z.number().int().min(0).max(10_000),
        content: z.string().min(1).max(8_000),
        truncated: z.boolean(),
      }),
    )
    .min(1)
    .max(50),
});

export async function POST(
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

  const parsed = appendSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid transcript batch.", code: "invalid_request" },
      { status: 400 },
    );
  }

  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id },
      select: { id: true, endedAt: true },
    });

    if (!conversation) {
      return NextResponse.json(
        { error: "No such conversation.", code: "invalid_request" },
        { status: 404 },
      );
    }

    if (
      conversation.endedAt &&
      Date.now() - conversation.endedAt.getTime() > APPEND_GRACE_MS
    ) {
      return NextResponse.json(
        { error: "This conversation is closed.", code: "invalid_request" },
        { status: 409 },
      );
    }

    // Ids are generated server-side rather than accepting the model's item ids
    // as primary keys — a client-supplied PK is a client-supplied collision.
    // Idempotency comes from the (conversationId, sequence) unique constraint.
    const result = await prisma.message.createMany({
      data: parsed.data.messages.map((message) => ({
        conversationId: id,
        role:
          message.role === "user" ? ("USER" as const) : ("ASSISTANT" as const),
        sequence: message.sequence,
        content: message.content,
        truncated: message.truncated,
      })),
      skipDuplicates: true,
    });

    return NextResponse.json(
      { written: result.count },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Failed to append messages", error);
    return NextResponse.json(
      { error: "Could not save the transcript.", code: "upstream_error" },
      { status: 500 },
    );
  }
}
