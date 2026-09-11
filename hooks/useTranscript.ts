"use client";

import { useCallback, useReducer, useRef } from "react";
import type { TranscriptMessage, TranscriptRole } from "@/types/transcript";

interface TranscriptState {
  readonly messages: readonly TranscriptMessage[];
  readonly nextSequence: number;
}

type Action =
  | { type: "open"; id: string; role: TranscriptRole }
  | { type: "delta"; id: string; role: TranscriptRole; text: string }
  | { type: "complete"; id: string; role: TranscriptRole; text?: string }
  | { type: "truncate-active" }
  | { type: "reset" };

const INITIAL: TranscriptState = { messages: [], nextSequence: 0 };

/**
 * Messages are append-only with stable ids. A delta patches one message in
 * place; it never rebuilds the array's contents. The only allocation per token
 * is the new array plus the one message object that changed, which is what
 * keeps a long conversation from re-rendering quadratically.
 */
function reducer(state: TranscriptState, action: Action): TranscriptState {
  switch (action.type) {
    case "open": {
      if (state.messages.some((m) => m.id === action.id)) return state;
      return {
        messages: [
          ...state.messages,
          {
            id: action.id,
            role: action.role,
            sequence: state.nextSequence,
            content: "",
            status: "streaming",
            createdAt: Date.now(),
          },
        ],
        nextSequence: state.nextSequence + 1,
      };
    }

    case "delta": {
      const index = state.messages.findIndex((m) => m.id === action.id);
      if (index === -1) {
        return reducer(
          reducer(state, { type: "open", id: action.id, role: action.role }),
          action,
        );
      }
      const existing = state.messages[index];
      if (!existing || existing.status === "truncated") return state;

      const next = state.messages.slice();
      next[index] = { ...existing, content: existing.content + action.text };
      return { ...state, messages: next };
    }

    case "complete": {
      const index = state.messages.findIndex((m) => m.id === action.id);
      if (index === -1) {
        if (!action.text) return state;
        const opened = reducer(state, {
          type: "open",
          id: action.id,
          role: action.role,
        });
        return reducer(opened, action);
      }
      const existing = state.messages[index];
      if (!existing) return state;

      const next = state.messages.slice();
      next[index] = {
        ...existing,
        // The `.done` event carries the authoritative text; deltas can drop.
        content: action.text ?? existing.content,
        status: existing.status === "truncated" ? "truncated" : "complete",
      };
      return { ...state, messages: next };
    }

    case "truncate-active": {
      const index = state.messages.findLastIndex(
        (m) => m.role === "assistant" && m.status === "streaming",
      );
      if (index === -1) return state;
      const existing = state.messages[index];
      if (!existing) return state;

      const next = state.messages.slice();
      next[index] = { ...existing, status: "truncated" };
      return { ...state, messages: next };
    }

    case "reset":
      return INITIAL;

    default:
      return state;
  }
}

export interface UseTranscript {
  readonly messages: readonly TranscriptMessage[];
  handleEvent: (event: unknown) => void;
  reset: () => void;
}

export function useTranscript(): UseTranscript {
  const [state, dispatch] = useReducer(reducer, INITIAL);

  /**
   * Gemini's Live API carries transcription as incremental text on
   * `serverContent`, with no per-message id and no explicit "done" event —
   * only a `turnComplete` covering the whole turn.
   *
   * So ids are synthesised per turn and per role, from a counter bumped on
   * every `turnComplete`. Without that, every delta in the session would patch
   * the same message and the transcript would be one ever-growing paragraph
   * per speaker.
   */
  const turnRef = useRef(0);

  const handleEvent = useCallback((event: unknown) => {
    const record = asRecord(event);
    if (!record) return;

    const server = asRecord(record.serverContent);
    if (!server) return;

    const turn = turnRef.current;

    const input = str(asRecord(server.inputTranscription)?.text);
    if (input) {
      dispatch({ type: "delta", id: `user-${turn}`, role: "user", text: input });
    }

    const output = str(asRecord(server.outputTranscription)?.text);
    if (output) {
      dispatch({
        type: "delta",
        id: `assistant-${turn}`,
        role: "assistant",
        text: output,
      });
    }

    // Barge-in. Taken from the server's own signal rather than inferred from
    // the visitor starting to speak — the server is what actually decided to
    // stop generating, so this is the moment the audio was truly cut.
    if (server.interrupted === true) {
      dispatch({ type: "truncate-active" });
      turnRef.current += 1;
      return;
    }

    if (server.turnComplete === true) {
      // Both roles are closed out: the visitor's turn is over once the model
      // has finished answering it.
      dispatch({ type: "complete", id: `user-${turn}`, role: "user" });
      dispatch({ type: "complete", id: `assistant-${turn}`, role: "assistant" });
      turnRef.current += 1;
    }
  }, []);

  const reset = useCallback(() => {
    turnRef.current = 0;
    dispatch({ type: "reset" });
  }, []);

  return { messages: state.messages, handleEvent, reset };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}
