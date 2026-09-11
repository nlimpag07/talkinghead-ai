"use client";

import { useMemo } from "react";
import type { ConnectionState, OrbState } from "@/types/realtime";

export interface OrbStateInput {
  readonly connectionState: ConnectionState;
  readonly isAssistantSpeaking: boolean;
  readonly isRetrieving: boolean;
  readonly isMuted: boolean;
  readonly hasError: boolean;
}

/**
 * Collapses the session's several independent booleans into the one state the
 * orb renders.
 *
 * Order is precedence, and it is the whole content of this function. Several
 * of these are true at once in normal operation — muted while speaking,
 * retrieving while the tail of the previous sentence is still playing — and the
 * orb can only show one thing. What it shows is whichever is most useful to
 * the visitor at that instant:
 *
 *   error     — nothing else matters if it is broken
 *   muted     — the visitor did this deliberately and needs it confirmed
 *   thinking  — the quiet gap that otherwise looks like a hang
 *   speaking  — audible anyway, but the orb should agree with the ears
 *   listening — the resting state of a live session
 *   idle      — not connected
 */
export function useOrbState(input: OrbStateInput): OrbState {
  const { connectionState, isAssistantSpeaking, isRetrieving, isMuted, hasError } =
    input;

  return useMemo(() => {
    if (hasError || connectionState === "failed") return "error";
    if (connectionState !== "connected") return "idle";
    if (isMuted) return "muted";
    if (isRetrieving) return "thinking";
    if (isAssistantSpeaking) return "speaking";
    return "listening";
  }, [connectionState, isAssistantSpeaking, isRetrieving, isMuted, hasError]);
}
