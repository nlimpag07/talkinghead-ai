"use client";

import { useCallback, useEffect, useRef } from "react";
import type {
  AppendMessagesRequest,
  TranscriptMessage,
} from "@/types/transcript";

const FLUSH_INTERVAL_MS = 5000;

/** How far this conversation has been written. Tagged with the id it belongs
 *  to, because a flush that lands late must not be mistaken for progress on
 *  the conversation that replaced it — both number their turns from zero. */
interface FlushMarker {
  readonly id: string | null;
  readonly through: number;
}

export interface UseTranscriptSync {
  /**
   * Writes every finalized message not yet persisted. Awaitable and serialized
   * against the interval, so a caller can fully drain one conversation before
   * clearing the transcript for the next.
   */
  flush: (useKeepalive?: boolean) => Promise<void>;
}

/**
 * Only finalized messages are written — a streaming message would be persisted
 * mid-sentence and then need updating, which turns one insert per turn into
 * many. Batching on an interval means a crashed tab loses at most five seconds
 * of transcript, which is the right trade against writing on every token.
 *
 * Idempotent by `(conversationId, sequence)`: a retried batch is a no-op.
 */
export function useTranscriptSync(
  conversationId: string | null,
  messages: readonly TranscriptMessage[],
): UseTranscriptSync {
  const messagesRef = useRef(messages);
  const markerRef = useRef<FlushMarker>({ id: null, through: -1 });
  const inFlightRef = useRef<Promise<void> | null>(null);

  // Which conversation is current, as opposed to which one a given in-flight
  // request was started for.
  const activeIdRef = useRef(conversationId);

  messagesRef.current = messages;
  activeIdRef.current = conversationId;

  const flushOnce = useCallback(
    async (useKeepalive: boolean): Promise<void> => {
      if (!conversationId) return;

      const marker = markerRef.current;
      const through = marker.id === conversationId ? marker.through : -1;

      const pending = messagesRef.current.filter(
        (message) =>
          message.status !== "streaming" &&
          message.sequence > through &&
          message.content.trim().length > 0,
      );

      if (pending.length === 0) return;

      const highest = pending[pending.length - 1]?.sequence ?? -1;

      const body: AppendMessagesRequest = {
        messages: pending.map((message) => ({
          role: message.role,
          sequence: message.sequence,
          content: message.content,
          truncated: message.status === "truncated",
        })),
      };

      try {
        const response = await fetch(
          `/api/conversation/${conversationId}/messages`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            keepalive: useKeepalive,
          },
        );
        // Progress is recorded only while this conversation is still the
        // current one. A request for a conversation that has since been
        // replaced still wrote its rows; it just has no progress left to
        // report, and claiming any would suppress the new conversation's
        // opening turns.
        if (response.ok && activeIdRef.current === conversationId) {
          markerRef.current = { id: conversationId, through: highest };
        }
      } catch {
        // Left unflushed; the next interval retries the same range.
      }
    },
    [conversationId],
  );

  const flush = useCallback(
    async (useKeepalive = false): Promise<void> => {
      // Serialized rather than skipped. Returning early while another flush
      // was in flight would let an awaiting caller clear the transcript
      // believing the write had landed.
      const previous = inFlightRef.current;
      if (previous) await previous;

      const run = flushOnce(useKeepalive);
      inFlightRef.current = run;
      try {
        await run;
      } finally {
        if (inFlightRef.current === run) inFlightRef.current = null;
      }
    },
    [flushOnce],
  );

  useEffect(() => {
    if (!conversationId) return;

    const timer = window.setInterval(() => void flush(false), FLUSH_INTERVAL_MS);
    const onHide = () => void flush(true);
    window.addEventListener("pagehide", onHide);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("pagehide", onHide);
      // Final flush on teardown catches the last turn, which is otherwise
      // stranded between the last interval and the session ending.
      void flush(true);
    };
  }, [conversationId, flush]);

  return { flush };
}
