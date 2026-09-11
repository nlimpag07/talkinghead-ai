"use client";

import { useEphemeralMessages } from "@/hooks/useEphemeralMessages";
import type { TranscriptMessage } from "@/types/transcript";

/**
 * Turns of conversation as transient captions down the right edge.
 *
 * No panel and no background — the orb is the page, and this floats over it.
 * Captions are bottom-anchored so a new turn rises from the bottom like
 * subtitles, which also means a turn leaving from the top does not shove the
 * newest one down as it goes.
 *
 * Two layers, deliberately:
 *
 *   The visible one is `aria-hidden`. It is a performance — things fly in,
 *   wait, and fly out — and a live region whose content is animated away after
 *   seven seconds is hostile to a screen reader.
 *
 *   Beneath it, a visually hidden `role="log"` carries the *complete*
 *   transcript, permanently. Assistive technology gets the full record;
 *   sighted users get the cinematic version. Nothing is actually lost, which
 *   is the only reason the visible layer is allowed to discard anything.
 */
export function FloatingTranscript({
  messages,
}: {
  readonly messages: readonly TranscriptMessage[];
}) {
  const { visible, setPaused } = useEphemeralMessages(messages);

  return (
    <>
      {/* Visible, ephemeral, decorative. */}
      <div
        aria-hidden
        onPointerEnter={() => setPaused(true)}
        onPointerLeave={() => setPaused(false)}
        className="pointer-events-auto flex max-h-full w-full flex-col justify-end gap-5"
      >
        {visible.map(({ message, leaving }) => (
          <article
            key={message.id}
            data-leaving={leaving || undefined}
            className="caption text-right"
          >
            <p className="mb-1 text-[0.65rem] font-medium uppercase tracking-[0.14em] text-ink-muted">
              {message.role === "user" ? "You" : "Tatay Dodong"}
            </p>
            <p
              className={
                message.role === "assistant"
                  ? "text-balance text-lg leading-snug font-medium"
                  : "text-balance text-base leading-snug text-ink-muted"
              }
            >
              {message.content}
              {message.status === "streaming" ? (
                <span className="ml-0.5 opacity-40">▍</span>
              ) : null}
            </p>
            {message.status === "truncated" ? (
              <p className="mt-1 text-xs italic text-ink-muted">Interrupted</p>
            ) : null}
          </article>
        ))}
      </div>

      {/* Complete, permanent, for assistive technology only. */}
      <div role="log" aria-live="polite" aria-label="Conversation transcript" className="sr-only">
        {messages.map((message) => (
          <p key={message.id}>
            {message.role === "user" ? "You: " : "Assistant: "}
            {message.content}
            {message.status === "truncated" ? " (interrupted)" : ""}
          </p>
        ))}
      </div>
    </>
  );
}
