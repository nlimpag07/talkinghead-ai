export type TranscriptRole = "user" | "assistant";

/**
 * `truncated` is a first-class status, not a flag on a complete message.
 * A barge-in produces a real assistant turn that stopped mid-sentence, and the
 * transcript has to show that it was cut off — otherwise the log reads as
 * though the assistant said something it never finished saying.
 */
export type TranscriptStatus = "streaming" | "complete" | "truncated";

export interface TranscriptMessage {
  /** Stable for the life of the message. Streaming deltas patch by this. */
  readonly id: string;
  readonly role: TranscriptRole;
  /** Monotonic within a conversation. What the UI and the database sort on. */
  readonly sequence: number;
  readonly content: string;
  readonly status: TranscriptStatus;
  readonly createdAt: number;
}

export interface AppendMessagesRequest {
  readonly messages: readonly {
    readonly role: TranscriptRole;
    readonly sequence: number;
    readonly content: string;
    readonly truncated: boolean;
  }[];
}
