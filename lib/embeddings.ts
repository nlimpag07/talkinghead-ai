import { join } from "node:path";
import {
  pipeline,
  env as hfEnv,
  type FeatureExtractionPipeline,
} from "@huggingface/transformers";

/**
 * Local embeddings. No API key, no network after the first run, no per-token
 * cost — the model runs in this process on CPU.
 *
 * Deliberately not `server-only`, unlike the rest of `lib/`. Both the Next
 * route and `scripts/ingest.ts` need this, and `server-only` throws outside a
 * React Server Component graph, which is why the ingest script used to carry
 * its own copy of the embedding logic. One implementation is worth more than
 * the import guard here: nothing in a client component imports this, and it
 * must stay that way — the model is ~130MB and has no business in a browser
 * bundle.
 */

/**
 * Chosen by measurement against three candidates at 384 dimensions, on a small
 * front-desk corpus with English, Taglish and Bisaya queries:
 *
 *   bge-small-en-v1.5       English-only. Good English scores, but retrieved
 *                           the wrong passage for every Taglish query.
 *   multilingual-e5-small   Handled Taglish, but scored *everything* 0.77-0.89
 *                           — only 0.03 between the worst true positive and the
 *                           best false positive, which leaves no room for a
 *                           threshold to mean anything.
 *   this one                Same accuracy as e5, and 0.17 of separation.
 *
 * Separation is what decides it. The persona's whole job is saying "wala ako
 * niyan" when the answer is not in the documents, and that depends entirely on
 * a score floor that can actually distinguish a match from a near-miss.
 *
 * Multilingual matters even though the documentation is English: the tool
 * description tells the model to translate to English keywords before
 * searching, but that is an instruction, not a guarantee. This model keeps a
 * Taglish query that slips through usable rather than actively wrong.
 */
const MODEL_ID = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";

/**
 * Fixed by the schema. `DocumentChunk.embedding` is `vector(384)`, so a model
 * of any other width cannot be stored — swapping models means a migration and
 * a full re-index, and the assertion below is what makes that fail at ingest
 * rather than silently at query time.
 */
export const EMBEDDING_DIMENSIONS = 384;

/**
 * This model is symmetric — queries and passages are embedded identically, so
 * there is no instruction prefix. `embedQuery` and `embedDocuments` stay
 * separate anyway: most retrieval models are asymmetric (BGE wants a query
 * instruction, E5 wants `query:`/`passage:`), and having the seam already in
 * place is what makes swapping models a one-file change instead of a hunt for
 * every call site.
 */
const QUERY_PREFIX = "";
const DOCUMENT_PREFIX = "";

/** Model weights land here on first run rather than inside node_modules,
 *  which `npm ci` would wipe. Gitignored. */
hfEnv.cacheDir = join(process.cwd(), ".models");
// Nothing is fetched from a local filesystem path; only the HF hub.
hfEnv.allowLocalModels = false;

export class EmbeddingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmbeddingError";
  }
}

/**
 * Loading the model takes a few seconds and must happen once per process, not
 * once per request. The promise itself is the singleton, so concurrent callers
 * during a cold start await the same load instead of each starting their own.
 */
let extractorPromise: Promise<FeatureExtractionPipeline> | null = null;

function getExtractor(): Promise<FeatureExtractionPipeline> {
  // fp32, not q8, and the 465MB download is the price. Measured on the same
  // corpus, q8 kept top-1 accuracy at 8/8 but narrowed the gap between the
  // weakest true positive and the strongest false positive from 0.142 to
  // 0.081 — leaving 0.022 of headroom under KNOWLEDGE_MIN_SCORE instead of
  // 0.032 over it. That margin is what lets the assistant say it does not
  // know, so it is not the thing to trade for image size. Revisit only with a
  // re-calibrated threshold and a bigger query set.
  extractorPromise ??= pipeline("feature-extraction", MODEL_ID, {
    dtype: "fp32",
  }).catch((error: unknown) => {
    // Cleared so a transient failure — usually the first-run download — can be
    // retried on the next call instead of poisoning the process.
    extractorPromise = null;
    throw new EmbeddingError(
      `Could not load ${MODEL_ID}: ${error instanceof Error ? error.message : String(error)}`,
    );
  });

  return extractorPromise;
}

/** Warms the model so the first real request does not pay the load cost. */
export async function warmEmbeddings(): Promise<void> {
  await getExtractor();
}

async function run(texts: readonly string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const extractor = await getExtractor();

  // Mean pooling over tokens, then L2 normalise. Normalised vectors make
  // cosine distance equivalent to a dot product, which is what pgvector's
  // `<=>` with vector_cosine_ops expects.
  const output = await extractor(texts as string[], {
    pooling: "mean",
    normalize: true,
  });

  const [rows, dims] = output.dims as [number, number];

  if (dims !== EMBEDDING_DIMENSIONS) {
    throw new EmbeddingError(
      `${MODEL_ID} produced ${dims} dimensions; the column is vector(${EMBEDDING_DIMENSIONS})`,
    );
  }
  if (rows !== texts.length) {
    throw new EmbeddingError(
      `expected ${texts.length} vectors, got ${rows}`,
    );
  }

  const flat = output.data as Float32Array;
  const vectors: number[][] = [];

  for (let i = 0; i < rows; i += 1) {
    const start = i * dims;
    const vector = Array.from(flat.subarray(start, start + dims));

    if (!vector.every((n) => Number.isFinite(n))) {
      throw new EmbeddingError(`embedding ${i} contained a non-finite value`);
    }
    vectors.push(vector);
  }

  return vectors;
}

/** Embeds passages for storage. */
export async function embedDocuments(
  texts: readonly string[],
): Promise<number[][]> {
  return run(DOCUMENT_PREFIX ? texts.map((t) => DOCUMENT_PREFIX + t) : texts);
}

/** Embeds a search query. */
export async function embedQuery(text: string): Promise<number[]> {
  const [vector] = await run([`${QUERY_PREFIX}${text}`]);
  if (!vector) throw new EmbeddingError("embedding returned no vector");
  return vector;
}

/**
 * pgvector's text input format. Passed as a bound parameter and cast with
 * `::vector` at the call site, so this never becomes string-concatenated SQL.
 */
export function toVectorLiteral(vector: readonly number[]): string {
  return `[${vector.join(",")}]`;
}
