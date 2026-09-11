"use client";

import { useRealtimeSession } from "@/hooks/useRealtimeSession";
import { useTranscript } from "@/hooks/useTranscript";
import { useTranscriptSync } from "@/hooks/useTranscriptSync";
import { useKnowledgeTool } from "@/hooks/useKnowledgeTool";
import { useOrbState } from "@/hooks/useOrbState";
import { Orb } from "@/components/orb/Orb";
import { FloatingTranscript } from "@/components/conversation/FloatingTranscript";
import { Sources } from "@/components/conversation/Sources";
import { LevelMeter } from "@/components/conversation/LevelMeter";
import type { OrbState } from "@/types/realtime";

const STATUS_TEXT: Record<string, string> = {
  disconnected: "Not connected",
  "requesting-mic": "Waiting for microphone permission",
  connecting: "Connecting",
  connected: "Connected",
  reconnecting: "Reconnecting",
  failed: "Connection failed",
};

/** What the orb is doing, in words. The orb never carries state alone. */
const ORB_TEXT: Record<OrbState, string> = {
  idle: "Idle",
  listening: "Listening",
  thinking: "Checking the documentation",
  speaking: "Speaking",
  muted: "Muted",
  error: "Something went wrong",
};

export function SessionLauncher() {
  const transcript = useTranscript();
  const knowledge = useKnowledgeTool();
  const {
    connectionState,
    conversationId,
    isMuted,
    isAssistantSpeaking,
    isRetrieving,
    elapsedSeconds,
    maxSessionSeconds,
    error,
    start,
    stop,
    toggleMute,
    inputAnalyserRef,
    outputAnalyserRef,
  } = useRealtimeSession({
    onEvent: transcript.handleEvent,
    onToolCall: knowledge.execute,
  });

  const sync = useTranscriptSync(conversationId, transcript.messages);

  const orbState = useOrbState({
    connectionState,
    isAssistantSpeaking,
    isRetrieving,
    isMuted,
    hasError: error !== null,
  });

  /**
   * Drain before clearing. `transcript.reset()` empties the array the sync hook
   * reads from, so resetting first strands whatever the five-second interval
   * had not yet written — the previous conversation's last turn, usually.
   */
  const onStart = async (): Promise<void> => {
    await sync.flush();
    transcript.reset();
    knowledge.reset();
    await start();
  };

  /** Writes the closing turn immediately rather than up to five seconds late.
   *  The append route's grace window exists for exactly this call order. */
  const onStop = async (): Promise<void> => {
    await stop();
    await sync.flush();
  };

  const isLive = connectionState === "connected";
  const isBusy =
    connectionState === "requesting-mic" || connectionState === "connecting";

  return (
    // Layers over one full viewport, rather than a grid. The orb is the page;
    // everything else floats on top of it, and none of it displaces the orb
    // from centre as it appears and disappears.
    <div className="relative h-dvh w-full overflow-hidden">
      {/* ─── The orb, filling the viewport ───────────────────────────────── */}
      <div className="absolute inset-0 grid place-items-center">
        <Orb
          state={orbState}
          inputAnalyserRef={inputAnalyserRef}
          outputAnalyserRef={outputAnalyserRef}
        />
      </div>

      {/* No heading or description: the orb is the whole page.
          Note that the on-page AI disclosure went with them. The persona still
          states it is an AI when asked — that rule is in the seeded prompt —
          but nothing now says so before a visitor starts talking. Worth a
          deliberate decision if this ever faces the public. */}

      {/* ─── Captions, right edge ────────────────────────────────────────── */}
      {/* pointer-events-none on the column so the orb stays interactive; the
          captions themselves re-enable it to catch hover and hold. */}
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 flex w-[min(26rem,42vw)] flex-col justify-end gap-4 px-6 pb-32 pt-10 sm:px-8">
        <FloatingTranscript messages={transcript.messages} />
        <Sources sources={knowledge.sources} />
      </div>

      {/* ─── Controls, bottom ───────────────────────────────────────────── */}
      <div className="absolute inset-x-0 bottom-0 z-20 flex flex-col items-center gap-3 px-6 pb-8">
        {/* Announced politely: this changes on every turn, and an assertive
            region would interrupt a screen reader mid-sentence. */}
        <p aria-live="polite" className="text-sm font-medium">
          {isLive ? ORB_TEXT[orbState] : (STATUS_TEXT[connectionState] ?? "Unknown")}
        </p>

        {isLive ? (
          <div className="flex w-full max-w-xs flex-col items-center gap-2">
            <LevelMeter analyserRef={inputAnalyserRef} active={isLive} />
            <p className="text-xs tabular-nums text-ink-muted">
              {formatDuration(elapsedSeconds)}
              {maxSessionSeconds ? ` of ${formatDuration(maxSessionSeconds)}` : ""}
            </p>
          </div>
        ) : (
          <p className="text-center text-sm text-ink-muted">
            Press start and speak normally. Interrupt whenever you like.
          </p>
        )}

        {error ? (
          <p role="alert" className="max-w-sm text-center text-sm text-danger">
            {error}
          </p>
        ) : null}

        <div className="mt-1 flex gap-3">
          {isLive ? (
            <>
              <button
                type="button"
                onClick={() => void onStop()}
                className="rounded-full border border-line bg-surface/70 px-5 py-2.5 text-sm font-medium backdrop-blur"
              >
                End conversation
              </button>
              <button
                type="button"
                onClick={toggleMute}
                aria-pressed={isMuted}
                className="rounded-full border border-line bg-surface/70 px-5 py-2.5 text-sm font-medium backdrop-blur"
              >
                {isMuted ? "Unmute" : "Mute"}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => void onStart()}
              disabled={isBusy}
              className="rounded-full bg-accent px-6 py-2.5 text-sm font-medium text-white disabled:opacity-60"
            >
              {isBusy ? "Starting…" : "Start conversation"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
