import { NextResponse } from "next/server";
import { z } from "zod";
import { searchKnowledge, MAX_QUERY_CHARS } from "@/services/knowledge/retrieval";
import type { KnowledgeSearchResponse } from "@/types/knowledge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const searchSchema = z.object({
  query: z.string().min(1).max(MAX_QUERY_CHARS),
  topK: z.number().int().min(1).max(10).optional(),
});

/**
 * Public and unauthenticated, and that is a deliberate consequence rather than
 * an oversight: the Realtime sideband WebSocket was declined in favour of
 * serverless hosting, so the retrieval tool executes in the visitor's browser
 * and calls this route directly. See PROGRESS.md.
 *
 * What that exposes, stated plainly because none of it is fixed here:
 *
 *   - The knowledge base is readable by anyone who can reach this URL. It is
 *     already content the assistant will read aloud to any caller, so this is
 *     a bulk-extraction concern, not a confidentiality one — do not put
 *     anything in the knowledge base that should not be public.
 *   - Every call spends an embedding request. Cheap per call, unbounded in
 *     aggregate until slice 7 puts a rate limiter in front of it.
 *
 * The bounds below are the cost ceiling per call, not a substitute for that
 * limiter: query length is capped, topK is capped, and the body must be a
 * single object rather than a batch.
 */
export async function POST(request: Request): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Malformed body.", code: "invalid_request" },
      { status: 400 },
    );
  }

  const parsed = searchSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid search request.", code: "invalid_request" },
      { status: 400 },
    );
  }

  try {
    const sources = await searchKnowledge(parsed.data.query, parsed.data.topK);
    const body: KnowledgeSearchResponse = { sources };

    return NextResponse.json(body, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    // The query text is not logged. It is whatever a visitor said out loud.
    console.error("Knowledge search failed", error);
    return NextResponse.json(
      { error: "Could not search the knowledge base.", code: "upstream_error" },
      { status: 500 },
    );
  }
}
