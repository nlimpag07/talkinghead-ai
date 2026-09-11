import "server-only";
// RETAINED BUT UNUSED. The voice path moved to Gemini Live — see
// services/gemini/live.ts and PROGRESS.md. Kept because there is no version
// control here to recover it from, and because the Azure OpenAI route uses
// this same API shape. Nothing imports it.
import { env } from "@/lib/env";
import type { SessionConfig } from "@/services/session-config";

const CLIENT_SECRETS_URL = "https://api.openai.com/v1/realtime/client_secrets";

/** The tool name the seeded persona already refers to by name. Changing it
 *  here without changing the prompt leaves the model calling something that
 *  does not exist. */
export const SEARCH_KNOWLEDGE = "search_knowledge";

/**
 * Declared on the session, which means it sits inside the cached prefix
 * alongside the instructions — so this definition has to be as byte-stable as
 * the prompt is. It is a module constant for that reason, not built per
 * request.
 *
 * The description is written at the model rather than at a developer: it has
 * to induce a call on the first mention of anything company-specific, because
 * the alternative failure is the model answering a question about your
 * business from its own weights.
 */
const SEARCH_KNOWLEDGE_TOOL = {
  type: "function",
  name: SEARCH_KNOWLEDGE,
  description:
    "Search the company's own documentation. Call this before answering any question about this company — its services, hours, prices, policies, locations, people, or processes — even if you believe you already know the answer. Call it again with different wording if the first result is not useful.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "What to look up, as a short phrase in English. Translate the visitor's Taglish or Bisaya into English keywords first — the documentation is in English.",
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
} as const;

export interface ClientSecret {
  readonly value: string;
  /** Unix seconds. */
  readonly expiresAt: number;
}

export class RealtimeUpstreamError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = "RealtimeUpstreamError";
  }
}

/**
 * Mints a short-lived credential the browser uses to open its own WebRTC
 * connection. The standard API key never leaves this process.
 *
 * The session object here is the highest-drift surface in the codebase — it
 * changed shape at GA and will change again. A 400 from this endpoint names
 * the offending field in the response body, which is why the body is preserved
 * on the error rather than swallowed.
 *
 * Note that a determined visitor can still send `session.update` over the data
 * channel and override these instructions for their own session. That is
 * inherent to client-terminated WebRTC and is not fixable from here — the
 * sideband control channel is the fix, and it was declined in favour of
 * serverless hosting.
 */
export async function createClientSecret(
  config: SessionConfig,
  safetyIdentifier: string,
): Promise<ClientSecret> {
  const response = await fetch(CLIENT_SECRETS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
      // Binds the hashed visitor identity to the token, so abuse is traceable
      // to a bucket without the browser ever sending or seeing the value.
      "OpenAI-Safety-Identifier": safetyIdentifier,
    },
    cache: "no-store",
    body: JSON.stringify({
      session: {
        type: "realtime",
        model: config.model,
        instructions: config.instructions,
        audio: {
          input: {
            transcription: { model: "gpt-4o-mini-transcribe" },
            // Server-side turn detection. `interrupt_response` is what makes
            // barge-in work: user speech cancels in-flight assistant audio
            // rather than queueing behind it.
            turn_detection: {
              type: "server_vad",
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 500,
              create_response: true,
              interrupt_response: true,
            },
          },
          output: { voice: config.voice },
        },
        tools: [SEARCH_KNOWLEDGE_TOOL],
        tool_choice: "auto",
        // The persona is two or three sentences per turn. This is a backstop
        // against a runaway generation, not the mechanism that keeps turns short.
        max_output_tokens: 1200,
      },
    }),
  });

  const text = await response.text();

  if (!response.ok) {
    throw new RealtimeUpstreamError(
      `client_secrets returned ${response.status}`,
      response.status,
      text,
    );
  }

  const data = JSON.parse(text) as { value?: unknown; expires_at?: unknown };

  if (typeof data.value !== "string") {
    throw new RealtimeUpstreamError(
      "client_secrets response had no token value",
      response.status,
      text,
    );
  }

  return {
    value: data.value,
    expiresAt:
      typeof data.expires_at === "number"
        ? data.expires_at
        : Math.floor(Date.now() / 1000) + 60,
  };
}
