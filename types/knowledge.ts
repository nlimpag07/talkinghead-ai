/** One retrieved passage, as returned to the browser and cited in the UI. */
export interface KnowledgeSource {
  readonly chunkId: string;
  readonly documentTitle: string;
  readonly sourceUrl: string | null;
  readonly heading: string | null;
  readonly content: string;
  /** Cosine similarity, 0..1. Higher is closer. */
  readonly score: number;
  /** 1-based position in the result list. Stored on MessageSource. */
  readonly rank: number;
}

export interface KnowledgeSearchRequest {
  readonly query: string;
  readonly topK?: number;
}

export interface KnowledgeSearchResponse {
  readonly sources: readonly KnowledgeSource[];
}

/** A function call the model issued over the data channel. */
export interface RealtimeToolCall {
  readonly callId: string;
  readonly name: string;
  /** Raw JSON string as emitted by the model — not yet parsed or trusted. */
  readonly argumentsJson: string;
}
