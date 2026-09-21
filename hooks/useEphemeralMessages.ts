"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TranscriptMessage } from "@/types/transcript";

/** How long a finished turn stays on screen before it leaves. */
const DWELL_MS = 7000;
/** Must match the exit animation in globals.css, or a caption is unmounted
 *  mid-flight and vanishes instead of leaving. */
const EXIT_MS = 600;

/** Timer key for the group exit on reset. Shares the timer map with the
 *  per-caption timers so unmount cleanup cancels it too. */
const RESET_TIMER = "__reset__";

export interface EphemeralMessage {
  readonly message: TranscriptMessage;
  readonly leaving: boolean;
}

export interface UseEphemeralMessages {
  readonly visible: readonly EphemeralMessage[];
  /** Hold everything on screen — bound to pointer and focus, so reading a
   *  phone number is not a race against a timer. */
  setPaused: (paused: boolean) => void;
}

/**
 * Shows each turn briefly, then lets it go.
 *
 * The dwell clock starts when a turn *finishes*, not when it appears: a
 * streaming message stays as long as it takes to arrive, and only then begins
 * its seven seconds. Starting the clock on arrival would expire long answers
 * while they were still being spoken.
 *
 * This is presentation only. `transcript.messages` keeps every turn, and the
 * database keeps them too — a caption leaving the screen is not a message
 * being discarded.
 */
export function useEphemeralMessages(
  messages: readonly TranscriptMessage[],
): UseEphemeralMessages {
  const [rendered, setRendered] = useState<readonly string[]>([]);
  const [leaving, setLeaving] = useState<readonly string[]>([]);

  // Which ids already have a dwell timer, so a re-render does not start a
  // second one and halve the dwell.
  const scheduledRef = useRef<Set<string>>(new Set());
  const timersRef = useRef<Map<string, number>>(new Map());
  const pausedRef = useRef(false);

  /** Mirror of `rendered`, so the reset effect reads the current value without
   *  taking it as a dependency and re-running on every mount it causes. */
  const renderedRef = useRef<readonly string[]>([]);

  /** Last-known content for everything currently on screen. A caption has to
   *  survive its message being removed from the transcript for long enough to
   *  animate out; pruned as captions unmount, so it stays bounded. */
  const snapshotRef = useRef<Map<string, TranscriptMessage>>(new Map());

  const clearTimer = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const retire = useCallback(
    (id: string) => {
      setLeaving((current) => (current.includes(id) ? current : [...current, id]));
      const timer = window.setTimeout(() => {
        setRendered((current) => current.filter((x) => x !== id));
        setLeaving((current) => current.filter((x) => x !== id));
        timersRef.current.delete(id);
      }, EXIT_MS);
      timersRef.current.set(id, timer);
    },
    [],
  );

  const scheduleDwell = useCallback(
    (id: string) => {
      clearTimer(id);
      const timer = window.setTimeout(() => {
        // Paused: keep it up and check again later rather than dropping it the
        // instant the pointer leaves.
        if (pausedRef.current) {
          scheduleDwell(id);
          return;
        }
        retire(id);
      }, DWELL_MS);
      timersRef.current.set(id, timer);
    },
    [clearTimer, retire],
  );

  useEffect(() => {
    // Newly seen turns get mounted; the entrance itself is a CSS animation, so
    // no "entering" state is needed here.
    //
    // The membership test runs *inside* the updater, against the current value
    // rather than the one captured when the effect was created. Computing the
    // additions outside and appending them was not idempotent: React's
    // development double-invocation ran the effect twice against the same
    // stale `rendered`, and every caption mounted twice.
    setRendered((current) => {
      const known = new Set(current);
      const additions = messages
        .filter((m) => !known.has(m.id))
        .map((m) => m.id);
      return additions.length > 0 ? [...current, ...additions] : current;
    });

    for (const message of messages) {
      const finished =
        message.status === "complete" || message.status === "truncated";
      if (!finished) continue;
      if (scheduledRef.current.has(message.id)) continue;
      scheduledRef.current.add(message.id);
      scheduleDwell(message.id);
    }
  }, [messages, scheduleDwell]);

  /**
   * A reset — ending the conversation, or starting a new one — empties the
   * transcript. Whatever is still on screen belongs to a conversation that no
   * longer exists, so it goes; but it goes by *leaving*, using the same exit
   * animation as an expiring caption. Dropping the whole column in one frame
   * looks like a glitch rather than a clear.
   *
   * This is why `snapshotRef` exists. The content is resolved from `messages`
   * normally, and `messages` is now empty — without a copy there would be
   * nothing left to animate.
   */
  useEffect(() => {
    if (messages.length > 0) return;

    for (const timer of timersRef.current.values()) window.clearTimeout(timer);
    timersRef.current.clear();
    scheduledRef.current.clear();

    const onScreen = renderedRef.current;
    if (onScreen.length === 0) return;

    setLeaving(onScreen);
    const timer = window.setTimeout(() => {
      setRendered([]);
      setLeaving([]);
      snapshotRef.current.clear();
      timersRef.current.delete(RESET_TIMER);
    }, EXIT_MS);
    timersRef.current.set(RESET_TIMER, timer);
  }, [messages.length]);

  useEffect(
    () => () => {
      for (const timer of timersRef.current.values()) window.clearTimeout(timer);
      timersRef.current.clear();
    },
    [],
  );

  renderedRef.current = rendered;

  const byId = new Map(messages.map((m) => [m.id, m]));
  const leavingSet = new Set(leaving);
  const renderedSet = new Set(rendered);

  // Snapshot what is on screen, and forget what has left.
  for (const [id, message] of byId) {
    if (renderedSet.has(id)) snapshotRef.current.set(id, message);
  }
  for (const id of snapshotRef.current.keys()) {
    if (!renderedSet.has(id)) snapshotRef.current.delete(id);
  }

  const visible: EphemeralMessage[] = [];
  for (const id of rendered) {
    const message = byId.get(id) ?? snapshotRef.current.get(id);
    if (!message) continue;
    if (message.content.trim().length === 0 && message.status !== "streaming") {
      continue;
    }
    visible.push({ message, leaving: leavingSet.has(id) });
  }

  const setPaused = useCallback((paused: boolean) => {
    pausedRef.current = paused;
  }, []);

  return { visible, setPaused };
}
