/** The six orb states. Defined here rather than in the orb component because
 *  the session hook produces them and the orb only consumes them. */
export type OrbState =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "muted"
  | "error";

/** Coarse connection state. Allowed to live in React state; audio levels are not. */
export type ConnectionState =
  | "disconnected"
  | "requesting-mic"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "failed";

/** What POST /api/conversation returns to the browser. */
export interface StartConversationResponse {
  readonly conversationId: string;
  /** Ephemeral client secret. Short-lived; only good for opening one session. */
  readonly clientSecret: string;
  /** Unix seconds. The browser must connect before this. */
  readonly clientSecretExpiresAt: number;
  readonly model: string;
  readonly voice: string;
  /** Server-enforced ceiling. The client mirrors it in the UI; it is not the
   *  enforcement point. */
  readonly maxSessionSeconds: number;
}

/** Token counts reported back when a session ends. Audio and text are billed
 *  at very different rates, so they never get summed before storage. */
export interface RealtimeUsage {
  readonly audioInputTokens: number;
  readonly audioOutputTokens: number;
  readonly textInputTokens: number;
  readonly textOutputTokens: number;
  readonly cachedInputTokens: number;
}

export interface ConversationErrorBody {
  readonly error: string;
  readonly code:
    | "rate_limited"
    | "concurrent_limit"
    | "upstream_error"
    | "invalid_request"
    | "not_configured";
}
