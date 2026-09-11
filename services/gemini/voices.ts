/**
 * Gemini Live prebuilt voices, and the guard that stops a typo becoming a hang.
 *
 * The reason this list exists at all: an unrecognised voice name is accepted
 * by `authTokens.create` *and* by `live.connect`, and then the session simply
 * never responds. No error, no close, no audio — it stalls. Tested with
 * "NotARealVoice": the connection opened, the turn was sent, and nothing came
 * back at all. A mistyped voice would present as "the assistant is broken"
 * with nothing in any log to explain it.
 *
 * So the name is checked before a token is minted, and an unknown one falls
 * back with a warning rather than being passed through.
 *
 * Connect-verified: Charon and Orus both produce audio, and produce it at
 * measurably different lengths for identical text — they are genuinely
 * different voices, not aliases. The rest are from Google's documented set and
 * are assumed good; if one turns out not to be, the symptom is the silent hang
 * above, so treat an unresponsive session as a suspect voice name first.
 */
export const GEMINI_VOICES = [
  "Puck",
  "Charon",
  "Kore",
  "Fenrir",
  "Aoede",
  "Leda",
  "Orus",
  "Zephyr",
  "Autonoe",
  "Umbriel",
  "Algieba",
  "Despina",
  "Erinome",
  "Iapetus",
  "Sadaltager",
] as const;

export type GeminiVoice = (typeof GEMINI_VOICES)[number];

/** Deeper voices, which suit an older male persona. Charon is the default. */
export const DEEPER_VOICES: readonly GeminiVoice[] = [
  "Charon",
  "Orus",
  "Fenrir",
  "Iapetus",
];

export function isGeminiVoice(value: string): value is GeminiVoice {
  return (GEMINI_VOICES as readonly string[]).includes(value);
}

/**
 * BCP-47 code passed as `speechConfig.languageCode`. It changes how the voice
 * pronounces text rather than which voice speaks — the same sentence came back
 * at 2.85s under `fil-PH` and 2.53s under `en-US`, so it measurably alters
 * prosody.
 *
 * Unlike the voice name, an unknown code does not hang the session, so this is
 * not allowlisted — only documented.
 *
 * `fil-PH` is the default because the persona speaks Taglish. Worth trying
 * `en-PH` if Filipino pronunciation over-applies to the English half.
 */
export const SUGGESTED_LANGUAGE_CODES = [
  "fil-PH",
  "en-PH",
  "en-US",
  "en-GB",
  "en-AU",
] as const;
