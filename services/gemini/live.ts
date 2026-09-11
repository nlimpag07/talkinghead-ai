import "server-only";
import { GoogleGenAI, Modality } from "@google/genai";
import { env } from "@/lib/env";
import { SEARCH_KNOWLEDGE_DECLARATION } from "@/services/gemini/tools";
import type { SessionConfig } from "@/services/session-config";

export interface LiveToken {
  /** The ephemeral token. Goes in the browser client's `apiKey` field. */
  readonly value: string;
  /** Unix seconds. The browser must open its session before this. */
  readonly expiresAt: number;
}

export class LiveUpstreamError extends Error {
  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "LiveUpstreamError";
  }
}

/** How long the token remains valid at all. */
const TOKEN_TTL_MS = 10 * 60_000;
/** How long the browser has to *start* a session with it. Short on purpose —
 *  a leaked token is only useful inside this window. */
const SESSION_START_TTL_MS = 60_000;

/**
 * Mints a single-use ephemeral token the browser uses to open its own Live API
 * WebSocket. The real API key never leaves this process.
 *
 * The important part is `liveConnectConstraints`. Everything that defines the
 * assistant — model, system instruction, tool declarations, voice,
 * transcription — is pinned to the token at mint time, server-side. The
 * browser passes only the token and the response modality; anything else it
 * tries to set is not honoured.
 *
 * That closes a gap the OpenAI WebRTC path could not. There, a visitor could
 * send `session.update` over the data channel and replace the persona
 * wholesale for their own session, which made the grounding rules advisory.
 * Here the persona is not the browser's to change.
 */
export async function createLiveToken(
  config: SessionConfig,
): Promise<LiveToken> {
  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  const now = Date.now();

  try {
    const token = await ai.authTokens.create({
      config: {
        uses: 1,
        expireTime: new Date(now + TOKEN_TTL_MS).toISOString(),
        newSessionExpireTime: new Date(now + SESSION_START_TTL_MS).toISOString(),
        liveConnectConstraints: {
          model: config.model,
          config: {
            responseModalities: [Modality.AUDIO],
            systemInstruction: config.instructions,
            tools: [{ functionDeclarations: [SEARCH_KNOWLEDGE_DECLARATION] }],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: config.voice },
              },
              // Pronunciation, not voice selection. Measurably changes
              // delivery: identical text came back 0.3s longer under fil-PH
              // than en-US.
              languageCode: config.languageCode,
            },
            // Both directions. The visitor's own words feed the transcript
            // panel; the model's feed it too, because the audio is the
            // authoritative output and the text is derived from it.
            inputAudioTranscription: {},
            outputAudioTranscription: {},
          },
        },
      },
    });

    if (!token.name) {
      throw new LiveUpstreamError("authTokens.create returned no token name");
    }

    return {
      value: token.name,
      // The API does not return an expiry, so the one requested above is what
      // the client is told. Kept in sync by construction, not by trust.
      expiresAt: Math.floor((now + SESSION_START_TTL_MS) / 1000),
    };
  } catch (error) {
    if (error instanceof LiveUpstreamError) throw error;
    throw new LiveUpstreamError("Could not mint a Live API token", error);
  }
}
