"use client";

import { useEffect, useRef } from "react";
import type { TranscriptMessage } from "@/types/transcript";

export function Transcript({
  messages,
}: {
  readonly messages: readonly TranscriptMessage[];
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  // Follow the tail, but stop following the moment the reader scrolls up —
  // yanking someone back to the bottom mid-read is worse than no autoscroll.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element || !pinnedRef.current) return;
    element.scrollTop = element.scrollHeight;
  }, [messages]);

  const onScroll = () => {
    const element = scrollRef.current;
    if (!element) return;
    const distance =
      element.scrollHeight - element.scrollTop - element.clientHeight;
    pinnedRef.current = distance < 48;
  };

  if (messages.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        The conversation will appear here as you speak.
      </p>
    );
  }

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      role="log"
      aria-live="polite"
      aria-label="Conversation transcript"
      className="flex h-full flex-col gap-4 overflow-y-auto pr-2"
    >
      {messages.map((message) => (
        <article key={message.id} className="text-sm">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-muted">
            {message.role === "user" ? "You" : "Assistant"}
          </p>
          <p className="whitespace-pre-wrap">
            {message.content}
            {message.status === "streaming" ? (
              <span aria-hidden className="opacity-40">
                {" "}
                ▍
              </span>
            ) : null}
          </p>
          {message.status === "truncated" ? (
            // Conveyed in text, not by styling alone.
            <p className="mt-1 text-xs italic text-ink-muted">
              Interrupted
            </p>
          ) : null}
        </article>
      ))}
    </div>
  );
}
