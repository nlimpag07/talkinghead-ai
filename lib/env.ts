import "server-only";
import { z } from "zod";

/**
 * Fail fast and loudly. A missing OPENAI_API_KEY should stop the process at
 * startup, not surface as a 500 in the middle of a visitor's first sentence.
 *
 * Variables belonging to later slices are optional here and tightened when
 * that slice lands, so the app stays runnable at every point in the build.
 */
/**
 * An unset variable in a `.env` file is conventionally written `FOO=""`, not
 * omitted — and that is how `.env.example` ships every not-yet-used key. Zod's
 * `.optional()` only accepts `undefined`, so an empty string fails the inner
 * check instead of being treated as absent: `z.url()` rejects `""`, and so
 * does `z.string().min(1)`.
 *
 * Without this, `cp .env.example .env` produced an app where every server
 * route threw at module load, because `lib/prisma.ts` imports this file. Empty
 * means unset for anything optional.
 */
const emptyAsUndefined = (value: unknown): unknown =>
  value === "" ? undefined : value;

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.url(),

  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().min(1),
  PRISMA_POOL_MAX: z.coerce.number().int().positive().max(20).default(1),

  BETTER_AUTH_SECRET: z.string().min(32),

  // Voice. Gemini's Live API native-audio models are free of charge on the
  // free tier, which is why the voice path moved here from OpenAI Realtime.
  // Embeddings run locally (lib/embeddings.ts), so retrieval needs no key
  // from anyone.
  GEMINI_API_KEY: z.string().min(1),
  GEMINI_LIVE_MODEL: z.string().min(1).default("gemini-3.1-flash-live-preview"),
  // Prebuilt Gemini Live voice. Deeper male voices fit the persona; the value
  // is overridden by the `voice` row in Setting when one is present.
  GEMINI_VOICE: z.string().min(1).default("Charon"),
  // BCP-47, passed as speechConfig.languageCode. Changes pronunciation, not
  // which voice speaks. fil-PH by default because the persona is Taglish; see
  // services/gemini/voices.ts for the alternatives.
  GEMINI_LANGUAGE_CODE: z.string().min(2).default("fil-PH"),

  // Unused. The OpenAI Realtime path in services/openai/ is retained for a
  // switch back once credits or the Azure grant land, so its config stays
  // optional rather than being deleted.
  OPENAI_API_KEY: z.preprocess(emptyAsUndefined, z.string().min(1).optional()),
  OPENAI_REALTIME_MODEL: z.string().min(1).default("gpt-realtime-mini"),

  // Keyed hash for visitor IPs. Rotating this resets every rate-limit bucket,
  // so treat it as long-lived config rather than a rotatable secret.
  IP_HASH_SALT: z.string().min(32),

  SESSION_MAX_SECONDS: z.coerce.number().int().positive().max(3600).default(600),
  MAX_SESSIONS_PER_IP: z.coerce.number().int().positive().max(10).default(2),

  // Retrieval. The floor is the difference between "answers from the docs" and
  // "answers from whatever was least dissimilar".
  //
  // 0.3 is calibrated against the local model on real ingested content, which
  // is the only way this number means anything — score distributions differ
  // wildly between embedding models, and a value carried over from a different
  // one is worse than no filter, because it looks deliberate.
  //
  // Measured over English, Taglish and Bisaya queries: the weakest legitimate
  // match scored 0.319, the strongest false positive 0.268. 0.3 sits between
  // them, and that gap is narrow enough that it is worth re-measuring once
  // there is a real corpus — the per-citation scores in `Sources.tsx` exist to
  // make that possible from observed behaviour.
  //
  // This is only half the filter; see RELATIVE_SCORE_FLOOR in
  // services/knowledge/retrieval.ts for the part that removes the tail behind
  // a good answer.
  KNOWLEDGE_TOP_K: z.coerce.number().int().positive().max(10).default(5),
  KNOWLEDGE_MIN_SCORE: z.coerce.number().min(0).max(1).default(0.3),

  // Slice 6, file uploads. Not yet read by anything.
  SUPABASE_URL: z.preprocess(emptyAsUndefined, z.url().optional()),
  SUPABASE_SERVICE_ROLE_KEY: z.preprocess(
    emptyAsUndefined,
    z.string().min(1).optional(),
  ),
  SUPABASE_STORAGE_BUCKET: z.preprocess(
    emptyAsUndefined,
    z.string().min(1).default("knowledge"),
  ),

  // Slice 7.
  UPSTASH_REDIS_REST_URL: z.preprocess(emptyAsUndefined, z.url().optional()),
  UPSTASH_REDIS_REST_TOKEN: z.preprocess(
    emptyAsUndefined,
    z.string().min(1).optional(),
  ),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  // Docker image builds and CI typecheck runs have no secrets. Validation is
  // skippable there and nowhere else; the flag is never set in production.
  if (process.env.SKIP_ENV_VALIDATION === "true") {
    return process.env as unknown as Env;
  }

  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    // Names only. Never the values.
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  return parsed.data;
}

export const env: Env = loadEnv();
