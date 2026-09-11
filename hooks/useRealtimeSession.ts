"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GoogleGenAI, Modality, type Session } from "@google/genai";
import { toFailureOutput } from "@/lib/knowledge-output";
import {
  createAudioSink,
  createMicCapture,
  INPUT_MIME_TYPE,
  type AudioSink,
  type MicCapture,
} from "@/lib/audio";
import type {
  ConnectionState,
  RealtimeUsage,
  StartConversationResponse,
} from "@/types/realtime";
import type { RealtimeToolCall } from "@/types/knowledge";

const EMPTY_USAGE: RealtimeUsage = {
  audioInputTokens: 0,
  audioOutputTokens: 0,
  textInputTokens: 0,
  textOutputTokens: 0,
  cachedInputTokens: 0,
};

export interface UseRealtimeSessionOptions {
  /** Called for every server message. Held in a ref, so changing the identity
   *  of this function never rebuilds the session. */
  readonly onEvent?: (event: unknown) => void;
  /**
   * Executes a function call and resolves to the JSON string returned to the
   * model. Rejecting is allowed; a failure is reported as a tool error rather
   * than left hanging, because a call with no response stalls the turn.
   */
  readonly onToolCall?: (call: RealtimeToolCall) => Promise<string>;
}

export interface UseRealtimeSession {
  readonly connectionState: ConnectionState;
  /** Survives the end of a session so the final transcript flush can land. */
  readonly conversationId: string | null;
  readonly isMuted: boolean;
  readonly isAssistantSpeaking: boolean;
  /** True while a tool call is in flight — the "thinking" state for slice 4. */
  readonly isRetrieving: boolean;
  readonly elapsedSeconds: number;
  readonly maxSessionSeconds: number | null;
  readonly error: string | null;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  toggleMute: () => void;
  /** Analysers for the level meter and, in slice 4, the orb. Never read during
   *  render — these change at frame rate. */
  readonly inputAnalyserRef: React.RefObject<AnalyserNode | null>;
  readonly outputAnalyserRef: React.RefObject<AnalyserNode | null>;
}

/**
 * Drives a Gemini Live API session.
 *
 * Transport is a WebSocket carrying base64 PCM, opened by the browser directly
 * using a single-use ephemeral token minted server-side. The model, system
 * instruction, tools and voice are pinned to that token — see
 * `services/gemini/live.ts` — so nothing this hook sends can change the
 * assistant's identity.
 */
export function useRealtimeSession(
  options: UseRealtimeSessionOptions = {},
): UseRealtimeSession {
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("disconnected");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isAssistantSpeaking, setIsAssistantSpeaking] = useState(false);
  const [isRetrieving, setIsRetrieving] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [maxSessionSeconds, setMaxSessionSeconds] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sessionRef = useRef<Session | null>(null);
  const captureRef = useRef<MicCapture | null>(null);
  const sinkRef = useRef<AudioSink | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const inputAnalyserRef = useRef<AnalyserNode | null>(null);
  const outputAnalyserRef = useRef<AnalyserNode | null>(null);

  const conversationIdRef = useRef<string | null>(null);
  const usageRef = useRef<RealtimeUsage>(EMPTY_USAGE);
  const turnCountRef = useRef(0);
  const interruptionCountRef = useRef(0);
  const firstAudioLatencyRef = useRef<number | null>(null);
  const turnStartedAtRef = useRef<number | null>(null);
  const startedAtRef = useRef<number | null>(null);

  // Mirrors isAssistantSpeaking so audio chunks, which arrive many times per
  // second, only call setState on an actual transition.
  const speakingRef = useRef(false);
  const speakingTimerRef = useRef<number | null>(null);
  const tickRef = useRef<number | null>(null);
  const capRef = useRef<number | null>(null);
  const closingRef = useRef(false);
  const handledCallsRef = useRef<Set<string>>(new Set());
  const pendingCallsRef = useRef(0);

  const onEventRef = useRef(options.onEvent);
  onEventRef.current = options.onEvent;
  const onToolCallRef = useRef(options.onToolCall);
  onToolCallRef.current = options.onToolCall;

  const setSpeaking = useCallback((value: boolean) => {
    if (speakingRef.current === value) return;
    speakingRef.current = value;
    setIsAssistantSpeaking(value);
  }, []);

  /**
   * There is no "audio finished" message — only a stream of chunks and, later,
   * `turnComplete`. Speaking is therefore inferred from chunks still arriving,
   * and cleared by a short idle timer. `turnComplete` fires when generation
   * ends, which is well before the queued audio has actually been heard.
   */
  const markSpeaking = useCallback(() => {
    setSpeaking(true);
    if (speakingTimerRef.current !== null) {
      window.clearTimeout(speakingTimerRef.current);
    }
    speakingTimerRef.current = window.setTimeout(() => {
      if (!sinkRef.current?.isPlaying()) setSpeaking(false);
      else markSpeaking();
    }, 400);
  }, [setSpeaking]);

  /** Idempotent. Releases every resource; the mic indicator must go dark. */
  const teardown = useCallback(() => {
    for (const [ref, clear] of [
      [tickRef, window.clearInterval],
      [capRef, window.clearTimeout],
      [speakingTimerRef, window.clearTimeout],
    ] as const) {
      if (ref.current !== null) {
        clear(ref.current);
        ref.current = null;
      }
    }

    try {
      sessionRef.current?.close();
    } catch {
      // Already closed, or closed by the server.
    }
    sessionRef.current = null;

    void captureRef.current?.close();
    captureRef.current = null;
    void sinkRef.current?.close();
    sinkRef.current = null;
    inputAnalyserRef.current = null;
    outputAnalyserRef.current = null;

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    speakingRef.current = false;
    pendingCallsRef.current = 0;
    setIsAssistantSpeaking(false);
    setIsRetrieving(false);
    setIsMuted(false);
    setElapsedSeconds(0);
  }, []);

  const report = useCallback(
    (status: "COMPLETED" | "ABANDONED" | "FAILED", useKeepalive: boolean) => {
      const id = conversationIdRef.current;
      if (!id || closingRef.current) return;
      closingRef.current = true;
      conversationIdRef.current = null;

      void fetch(`/api/conversation/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          usage: usageRef.current,
          firstAudioLatencyMs: firstAudioLatencyRef.current,
          turnCount: turnCountRef.current,
          interruptionCount: interruptionCountRef.current,
        }),
        // keepalive lets the request survive the page unloading. sendBeacon is
        // not usable here because this is a PATCH.
        keepalive: useKeepalive,
      }).catch(() => {
        // A failed report costs an analytics row, not a session. The server
        // sweep reclassifies it as ABANDONED.
      });
    },
    [],
  );

  const dispatchToolCall = useCallback(async (call: RealtimeToolCall) => {
    const handler = onToolCallRef.current;
    const session = sessionRef.current;
    if (!handler || !session) return;

    pendingCallsRef.current += 1;
    setIsRetrieving(true);

    let output: string;
    try {
      output = await handler(call);
    } catch {
      output = toFailureOutput();
    } finally {
      pendingCallsRef.current -= 1;
      if (pendingCallsRef.current <= 0) {
        pendingCallsRef.current = 0;
        setIsRetrieving(false);
      }
    }

    // The session can close while a lookup is in flight — the visitor hung up.
    if (sessionRef.current !== session) return;

    try {
      session.sendToolResponse({
        functionResponses: [
          {
            id: call.callId,
            name: call.name,
            // Parsed rather than passed as a string: `response` is a structured
            // object, and a JSON string inside it arrives at the model as a
            // quoted blob instead of readable fields.
            response: safeParse(output),
          },
        ],
      });
    } catch (caught) {
      console.error("Failed to return tool output", caught);
    }
  }, []);

  const runOnce = useCallback(
    (call: RealtimeToolCall) => {
      if (handledCallsRef.current.has(call.callId)) return;
      handledCallsRef.current.add(call.callId);
      void dispatchToolCall(call);
    },
    [dispatchToolCall],
  );

  const handleMessage = useCallback(
    (message: Record<string, unknown>) => {
      // Subscribers see every message, including the ones this hook ignores.
      onEventRef.current?.(message);

      const server = asRecord(message.serverContent);

      if (server) {
        const parts = asRecord(server.modelTurn)?.parts;
        if (Array.isArray(parts)) {
          for (const part of parts) {
            const data = asRecord(asRecord(part)?.inlineData)?.data;
            if (typeof data !== "string") continue;

            if (firstAudioLatencyRef.current === null && turnStartedAtRef.current !== null) {
              firstAudioLatencyRef.current = Math.round(
                performance.now() - turnStartedAtRef.current,
              );
            }
            sinkRef.current?.enqueue(data);
            markSpeaking();
          }
        }

        // Barge-in. The server decided the visitor started talking over the
        // model, so the queued audio must be dropped immediately — otherwise
        // the assistant keeps talking for as long as the buffer is deep.
        if (server.interrupted === true) {
          interruptionCountRef.current += 1;
          sinkRef.current?.interrupt();
          setSpeaking(false);
        }

        if (server.turnComplete === true) turnCountRef.current += 1;
      }

      const toolCall = asRecord(message.toolCall);
      const calls = toolCall?.functionCalls;
      if (Array.isArray(calls)) {
        for (const raw of calls) {
          const call = toToolCall(asRecord(raw));
          if (call) runOnce(call);
        }
      }

      const usage = asRecord(message.usageMetadata);
      if (usage) usageRef.current = accumulateUsage(usageRef.current, usage);
    },
    [markSpeaking, runOnce, setSpeaking],
  );

  const stop = useCallback(async () => {
    report("COMPLETED", false);
    teardown();
    setConnectionState("disconnected");
  }, [report, teardown]);

  const start = useCallback(async () => {
    if (sessionRef.current) return;

    setError(null);
    closingRef.current = false;
    usageRef.current = EMPTY_USAGE;
    turnCountRef.current = 0;
    interruptionCountRef.current = 0;
    firstAudioLatencyRef.current = null;
    turnStartedAtRef.current = null;
    handledCallsRef.current = new Set();
    pendingCallsRef.current = 0;

    try {
      setConnectionState("requesting-mic");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      setConnectionState("connecting");

      const response = await fetch("/api/conversation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(body?.error ?? "Could not start a conversation.");
      }

      const session = (await response.json()) as StartConversationResponse;
      conversationIdRef.current = session.conversationId;
      setConversationId(session.conversationId);
      setMaxSessionSeconds(session.maxSessionSeconds);

      const sink = await createAudioSink();
      sinkRef.current = sink;
      outputAnalyserRef.current = sink.analyser;

      // `v1alpha` is required for ephemeral tokens; the SDK warns and then
      // misbehaves without it.
      const client = new GoogleGenAI({
        apiKey: session.clientSecret,
        httpOptions: { apiVersion: "v1alpha" },
      });

      const live = await client.live.connect({
        model: session.model,
        // Everything else — instructions, tools, voice, transcription — is
        // pinned to the token server-side and cannot be set from here.
        config: { responseModalities: [Modality.AUDIO] },
        callbacks: {
          onmessage: (message) =>
            handleMessage(message as unknown as Record<string, unknown>),
          onerror: (event) => {
            console.error("Live session error", event);
            setError("The voice service reported an error.");
          },
          onclose: () => {
            // A server-side close after the visitor is done is normal. One
            // while still connected is the session dropping.
            if (sessionRef.current && !closingRef.current) {
              setConnectionState("failed");
              setError("The connection dropped.");
              report("FAILED", false);
              teardown();
            }
          },
        },
      });
      sessionRef.current = live;

      const capture = await createMicCapture(stream, (base64) => {
        // Marks the start of a turn for the latency measurement. Overwritten
        // continuously while the visitor speaks, so it ends up holding the
        // moment they stopped — which is what first-audio latency is measured
        // from.
        if (!speakingRef.current) turnStartedAtRef.current = performance.now();
        try {
          live.sendRealtimeInput({
            audio: { data: base64, mimeType: INPUT_MIME_TYPE },
          });
        } catch {
          // Socket closed mid-frame. The close handler deals with it.
        }
      });
      captureRef.current = capture;
      inputAnalyserRef.current = capture.analyser;

      startedAtRef.current = Date.now();
      setConnectionState("connected");

      // 1 Hz. Coarse enough for setState; nothing frame-rate goes through here.
      tickRef.current = window.setInterval(() => {
        if (startedAtRef.current === null) return;
        setElapsedSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000));
      }, 1000);

      // Best-effort duration cap. The server sweep is the backstop. Gemini
      // also closes audio-only sessions at 15 minutes regardless.
      capRef.current = window.setTimeout(() => {
        void stop();
      }, session.maxSessionSeconds * 1000);
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "Could not start.";
      setError(message);
      setConnectionState("failed");
      report("FAILED", false);
      teardown();
    }
  }, [handleMessage, report, stop, teardown]);

  const toggleMute = useCallback(() => {
    const track = streamRef.current?.getAudioTracks()[0];
    const capture = captureRef.current;
    if (!track || !capture) return;

    const next = track.enabled;
    track.enabled = !next;
    // Both: disabling the track stops the browser's mic indicator, and the
    // capture gate stops frames already in flight from being sent.
    capture.setMuted(next);
    setIsMuted(next);
  }, []);

  useEffect(() => {
    const onUnload = () => report("ABANDONED", true);
    window.addEventListener("pagehide", onUnload);

    return () => {
      window.removeEventListener("pagehide", onUnload);
      report("ABANDONED", true);
      teardown();
    };
  }, [report, teardown]);

  return {
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
  };
}

function toToolCall(source: Record<string, unknown> | null): RealtimeToolCall | null {
  if (!source) return null;
  const id = source.id;
  const name = source.name;
  if (typeof id !== "string" || id.length === 0) return null;
  if (typeof name !== "string" || name.length === 0) return null;

  // Gemini delivers args already parsed, unlike OpenAI's JSON string.
  // Re-serialised so the handler contract stays provider-neutral.
  return { callId: id, name, argumentsJson: JSON.stringify(source.args ?? {}) };
}

function safeParse(json: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* fall through */
  }
  return { result: json };
}

/**
 * Gemini reports usage per modality rather than in named audio/text buckets,
 * as `promptTokensDetails` and `responseTokensDetails` arrays. Every field is
 * narrowed because this is an untyped boundary.
 *
 * Usage arrives cumulatively for the session, not per turn, so it is assigned
 * rather than added — summing would multiply the count by the number of
 * messages received.
 */
function accumulateUsage(
  current: RealtimeUsage,
  usage: Record<string, unknown>,
): RealtimeUsage {
  const byModality = (value: unknown, modality: string): number => {
    if (!Array.isArray(value)) return 0;
    for (const entry of value) {
      const record = asRecord(entry);
      if (record?.modality === modality) return num(record.tokenCount);
    }
    return 0;
  };

  const prompt = usage.promptTokensDetails;
  const response = usage.responseTokensDetails;

  const next: RealtimeUsage = {
    audioInputTokens: byModality(prompt, "AUDIO"),
    textInputTokens: byModality(prompt, "TEXT"),
    audioOutputTokens: byModality(response, "AUDIO"),
    textOutputTokens: byModality(response, "TEXT"),
    cachedInputTokens: num(usage.cachedContentTokenCount),
  };

  // A message carrying no detail arrays must not zero what was already
  // counted.
  const total =
    next.audioInputTokens +
    next.textInputTokens +
    next.audioOutputTokens +
    next.textOutputTokens;
  return total === 0 ? current : next;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
