import "server-only";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { GEMINI_VOICES, isGeminiVoice } from "@/services/gemini/voices";

export interface SessionConfig {
  readonly model: string;
  readonly voice: string;
  /** BCP-47. Governs pronunciation; see services/gemini/voices.ts. */
  readonly languageCode: string;
  readonly instructions: string;
  readonly promptVersion: number;
}

/** Prebuilt Gemini Live voice, overridden by the `voice` Setting row. */
const DEFAULT_VOICE = "Charon";

/**
 * The instructions string must be byte-identical across every session for
 * prompt caching to hit. That rules out interpolating anything per-visitor —
 * no timestamps, no session ids, no visitor locale. Retrieved context arrives
 * later as tool results, which sit after the cached prefix and do not disturb it.
 *
 * If this ever starts varying per turn, the audio bill roughly doubles and
 * nothing in the UI will tell you why.
 */
export async function loadSessionConfig(): Promise<SessionConfig> {
  const [voiceSetting, prompt] = await Promise.all([
    prisma.setting.findUnique({ where: { key: "voice" } }),
    prisma.prompt.findFirst({
      where: { key: "persona", isActive: true },
      orderBy: { version: "desc" },
    }),
  ]);

  if (!prompt) {
    throw new Error(
      "No active persona prompt found. Run `npm run db:seed` before starting a session.",
    );
  }

  const requested = parseVoice(voiceSetting?.value) ?? env.GEMINI_VOICE;
  // Validated rather than trusted. An unknown voice name is accepted all the
  // way through connect and then the session never responds — no error, no
  // audio. Falling back loudly here is the difference between a warning in the
  // log and an assistant that appears simply not to work.
  const voice = isGeminiVoice(requested) ? requested : DEFAULT_VOICE;
  if (voice !== requested) {
    console.warn(
      `Unknown Gemini voice "${requested}"; falling back to ${DEFAULT_VOICE}. ` +
        `Valid names: ${GEMINI_VOICES.join(", ")}`,
    );
  }

  const languageCode =
    parseLanguageCode(voiceSetting?.value) ?? env.GEMINI_LANGUAGE_CODE;

  return {
    model: env.GEMINI_LIVE_MODEL,
    voice,
    languageCode,
    instructions: prompt.content,
    promptVersion: prompt.version,
  };
}

/** Optional `languageCode` on the same `voice` Setting row, so the accent can
 *  be changed from the admin panel alongside the voice it applies to. */
function parseLanguageCode(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const code = (value as Record<string, unknown>).languageCode;
  return typeof code === "string" && code.length >= 2 ? code : null;
}

/** Setting.value is Json, so it is untyped at the boundary and gets narrowed here. */
function parseVoice(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const name = (value as Record<string, unknown>).name;
  return typeof name === "string" && name.length > 0 ? name : null;
}
