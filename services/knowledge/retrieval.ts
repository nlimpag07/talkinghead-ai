import "server-only";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { embedQuery, toVectorLiteral } from "@/lib/embeddings";
import type { KnowledgeSource } from "@/types/knowledge";

/** Longest query accepted. The model writes these, but the endpoint is public,
 *  so the bound is enforced rather than assumed. */
export const MAX_QUERY_CHARS = 500;

/**
 * A result must score at least this fraction of the best result to survive.
 * Not configurable: unlike the absolute floor, this is a property of how
 * embedding similarity behaves rather than of a particular corpus, and 0.6
 * held across every query tested. Lower it and the tail comes back; raise it
 * much and genuine second-best passages start disappearing on questions whose
 * answer legitimately spans two sections.
 */
const RELATIVE_SCORE_FLOOR = 0.6;

interface ChunkRow {
  readonly id: string;
  readonly content: string;
  readonly documentTitle: string;
  readonly sourceUrl: string | null;
  readonly heading: string | null;
  readonly score: number;
}

/**
 * Cosine similarity over pgvector. Raw SQL because `embedding` is declared
 * `Unsupported("vector(1536)")` — Prisma tracks the column through Migrate but
 * cannot read or write it.
 *
 * `<=>` is cosine *distance*, so similarity is `1 - distance`. The HNSW index
 * built in `prisma/sql/010_vector_index.sql` uses `vector_cosine_ops`, which
 * means the ORDER BY below is the expression the index can actually serve;
 * changing the operator here silently drops to a sequential scan.
 *
 * The knowledge-base and status filters are applied as a join rather than
 * denormalised onto the chunk, which makes this a post-filter against the
 * index: HNSW finds nearest neighbours first, then rows are discarded. With a
 * single active knowledge base that costs nothing. With many, the candidate
 * pool would need widening before the filter.
 */
export async function searchKnowledge(
  rawQuery: string,
  requestedTopK?: number,
): Promise<KnowledgeSource[]> {
  const query = rawQuery.trim().slice(0, MAX_QUERY_CHARS);
  if (query.length === 0) return [];

  const topK = clampTopK(requestedTopK ?? env.KNOWLEDGE_TOP_K);
  const literal = toVectorLiteral(await embedQuery(query));

  const rows = await prisma.$queryRaw<ChunkRow[]>`
    SELECT
      c."id",
      c."content",
      c."documentTitle",
      c."sourceUrl",
      c."heading",
      1 - (c."embedding" <=> ${literal}::vector) AS score
    FROM "document_chunk" c
    JOIN "document" d ON d."id" = c."documentId"
    JOIN "knowledge_base" kb ON kb."id" = d."knowledgeBaseId"
    WHERE c."embedding" IS NOT NULL
      AND kb."isActive" = true
      AND d."status"::text = 'INDEXED'
    ORDER BY c."embedding" <=> ${literal}::vector
    LIMIT ${topK}
  `;

  // Two filters, because one is not enough.
  //
  // The absolute floor rejects a query nothing answers. The relative floor
  // rejects the long tail *behind* a good answer: measured on a real corpus, a
  // genuine match scores roughly double whatever comes next, so everything
  // under a fraction of the top score is noise — and noise handed to the model
  // is a passage it may quote. Without the relative cut, "what time do you
  // close" returned the opening hours at 0.59 and then a refunds passage at
  // 0.31, which passes any floor low enough to admit a legitimate weak match.
  //
  // Filtered here rather than in SQL so both are tunable without touching the
  // query the HNSW index depends on.
  const best = rows.reduce(
    (max, row) => (Number.isFinite(row.score) && row.score > max ? row.score : max),
    0,
  );
  const relativeFloor = best * RELATIVE_SCORE_FLOOR;

  return rows
    .filter(
      (row) =>
        Number.isFinite(row.score) &&
        row.score >= env.KNOWLEDGE_MIN_SCORE &&
        row.score >= relativeFloor,
    )
    .map((row, index) => ({
      chunkId: row.id,
      documentTitle: row.documentTitle,
      sourceUrl: row.sourceUrl,
      heading: row.heading,
      content: row.content,
      score: Math.round(row.score * 1000) / 1000,
      rank: index + 1,
    }));
}

function clampTopK(value: number): number {
  if (!Number.isFinite(value)) return 5;
  return Math.min(Math.max(Math.trunc(value), 1), 10);
}
