/**
 * Published rates, USD per 1M tokens. Audio dominates;
 * everything else is arithmetic noise by comparison.
 *
 * Verify against the pricing page before trusting these for invoice
 * reconciliation — they have moved three times since the 2024 beta and will
 * move again. `estimateCostUsd` is for the in-app cost display and the
 * Analytics table, not for accounting.
 */
export interface RateCard {
  readonly audioInput: number;
  readonly cachedAudioInput: number;
  readonly audioOutput: number;
  readonly textInput: number;
  readonly textOutput: number;
}

const RATE_CARDS: Readonly<Record<string, RateCard>> = {
  // Gemini Live. These are the PAID-tier rates; the free tier bills nothing,
  // so on free-tier usage `estimatedCostUsd` reports what the same traffic
  // would cost once you outgrow the quota. That is the useful number to see —
  // a dashboard reading zero forever tells you nothing about scaling.
  "gemini-3.1-flash-live-preview": {
    audioInput: 3,
    cachedAudioInput: 0.75,
    audioOutput: 12,
    textInput: 0.5,
    textOutput: 2,
  },
  "gemini-2.5-flash-native-audio-latest": {
    audioInput: 3,
    cachedAudioInput: 0.75,
    audioOutput: 12,
    textInput: 0.5,
    textOutput: 2,
  },

  "gpt-realtime-mini": {
    audioInput: 10,
    cachedAudioInput: 0.3,
    audioOutput: 20,
    textInput: 0.6,
    textOutput: 2.4,
  },
  "gpt-realtime-2.1-mini": {
    audioInput: 10,
    cachedAudioInput: 0.3,
    audioOutput: 20,
    textInput: 0.6,
    textOutput: 2.4,
  },
  "gpt-realtime": {
    audioInput: 32,
    cachedAudioInput: 0.4,
    audioOutput: 64,
    textInput: 4,
    textOutput: 24,
  },
  "gpt-realtime-2.1": {
    audioInput: 32,
    cachedAudioInput: 0.4,
    audioOutput: 64,
    textInput: 4,
    textOutput: 24,
  },
};

/** Unknown models bill at the most expensive known card, so a model swap
 *  overestimates rather than silently reporting near-zero cost. */
const FALLBACK: RateCard = RATE_CARDS["gpt-realtime-2.1"] as RateCard;

export interface TokenCounts {
  readonly audioInputTokens: number;
  readonly audioOutputTokens: number;
  readonly textInputTokens: number;
  readonly textOutputTokens: number;
  readonly cachedInputTokens: number;
}

export function rateCardFor(model: string): RateCard {
  return RATE_CARDS[model] ?? FALLBACK;
}

/**
 * Cached tokens are reported by OpenAI as a subset of input tokens, not as a
 * separate bucket, so they are subtracted before the fresh rate applies.
 *
 * Approximation worth knowing about: the usage payload reports one cached
 * total rather than splitting it by audio and text. All of it is billed at the
 * audio cached rate here, because audio is the overwhelming majority of input
 * on a voice session. That overstates cost slightly on tool-heavy turns.
 */
export function estimateCostUsd(model: string, usage: TokenCounts): number {
  const rates = rateCardFor(model);
  const cached = Math.min(usage.cachedInputTokens, usage.audioInputTokens);
  const freshAudioInput = usage.audioInputTokens - cached;

  const total =
    (freshAudioInput * rates.audioInput +
      cached * rates.cachedAudioInput +
      usage.audioOutputTokens * rates.audioOutput +
      usage.textInputTokens * rates.textInput +
      usage.textOutputTokens * rates.textOutput) /
    1_000_000;

  // Six decimal places matches the Decimal(10, 6) column.
  return Math.round(total * 1_000_000) / 1_000_000;
}
