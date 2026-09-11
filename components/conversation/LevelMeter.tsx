"use client";

import { useEffect, useRef } from "react";
import { readLevel } from "@/lib/audio";

/**
 * Microphone input level.
 *
 * Written straight to a DOM style from a rAF loop rather than held in state,
 * for the same reason the orb is a canvas: this value changes 60 times a
 * second and every change would otherwise re-render the transcript beside it.
 *
 * Its real job is answering "is it hearing me?" when the assistant has not
 * replied yet. That question is otherwise unanswerable, and a visitor who
 * cannot tell will start talking louder.
 */
export function LevelMeter({
  analyserRef,
  active,
}: {
  readonly analyserRef: React.RefObject<AnalyserNode | null>;
  readonly active: boolean;
}) {
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const bar = barRef.current;
    if (!bar || !active) return;

    // Reduced motion still gets the meter — it conveys information rather than
    // decoration, and a bar that tracks your voice is not the kind of motion
    // the preference is about. It is only smoothed harder.
    const gentle = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const scratch = new Uint8Array(256);
    let smoothed = 0;
    let frame = 0;

    const tick = () => {
      const analyser = analyserRef.current;
      if (analyser) {
        const raw = readLevel(
          analyser,
          scratch.subarray(0, analyser.fftSize / 2) as Uint8Array<ArrayBuffer>,
        );
        const rise = gentle ? 0.25 : 0.6;
        smoothed = raw > smoothed ? smoothed + (raw - smoothed) * rise : smoothed * 0.9;
        bar.style.transform = `scaleX(${Math.max(0.02, Math.min(1, smoothed * 1.8)).toFixed(3)})`;
      } else {
        bar.style.transform = "scaleX(0.02)";
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [analyserRef, active]);

  return (
    <div
      className="h-1 w-full overflow-hidden rounded-full bg-line"
      role="presentation"
    >
      <div
        ref={barRef}
        className="h-full w-full origin-left rounded-full bg-accent"
        style={{ transform: "scaleX(0.02)" }}
      />
    </div>
  );
}
