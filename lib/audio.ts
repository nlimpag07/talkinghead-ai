"use client";

/**
 * Raw PCM audio plumbing for the Live API.
 *
 * WebRTC used to do all of this: Opus encoding, resampling, jitter buffering,
 * packet scheduling. Gemini's Live API is a plain WebSocket carrying
 * base64 PCM, so it is ours to do.
 *
 * Two fixed formats, both from the API contract and neither negotiable:
 *   input  — 16-bit PCM, 16kHz, mono, little-endian, `audio/pcm;rate=16000`
 *   output — 16-bit PCM, 24kHz, mono, little-endian
 *
 * The rates differ, which is why capture and playback get separate
 * AudioContexts rather than sharing one.
 */

export const INPUT_SAMPLE_RATE = 16_000;
export const OUTPUT_SAMPLE_RATE = 24_000;
export const INPUT_MIME_TYPE = `audio/pcm;rate=${INPUT_SAMPLE_RATE}`;

/** ~64ms at 16kHz. Small enough that barge-in feels immediate, large enough
 *  not to flood the socket with tiny frames. */
const CAPTURE_FRAME_SAMPLES = 1024;

/**
 * Runs on the audio thread and forwards fixed-size frames to the main thread.
 * Delivered as a Blob URL rather than a file in /public so the worklet cannot
 * fall out of sync with this module.
 *
 * Buffering to a fixed frame size happens here, not on the main thread,
 * because `process` is called with whatever block size the browser chooses
 * (128 samples, typically) and one message per 128 samples would be ~125
 * postMessage calls a second.
 */
const CAPTURE_WORKLET = `
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = new Float32Array(${CAPTURE_FRAME_SAMPLES});
    this._offset = 0;
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    for (let i = 0; i < channel.length; i++) {
      this._buffer[this._offset++] = channel[i];
      if (this._offset === this._buffer.length) {
        // Transferred, not copied. A fresh buffer replaces it each time.
        this.port.postMessage(this._buffer, [this._buffer.buffer]);
        this._buffer = new Float32Array(${CAPTURE_FRAME_SAMPLES});
        this._offset = 0;
      }
    }
    return true;
  }
}
registerProcessor('capture-processor', CaptureProcessor);
`;

export interface MicCapture {
  /** Analyser over the live input, for the level meter and the orb. Reading it
   *  is a per-frame concern, so it is exposed rather than polled here. */
  readonly analyser: AnalyserNode;
  setMuted: (muted: boolean) => void;
  close: () => Promise<void>;
}

/**
 * Captures the microphone as base64 PCM16 frames.
 *
 * The AudioContext is constructed at 16kHz so the browser resamples from the
 * device's native rate for us. Doing it by hand — decimating 48kHz to 16kHz —
 * is where a naive implementation introduces aliasing that reads to the model
 * as a bad microphone.
 */
export async function createMicCapture(
  stream: MediaStream,
  onFrame: (base64: string) => void,
): Promise<MicCapture> {
  const context = new AudioContext({ sampleRate: INPUT_SAMPLE_RATE });

  // Autoplay policy can leave a context suspended even when created from a
  // click, and a suspended context produces silence with no error.
  if (context.state === "suspended") await context.resume();

  const blobUrl = URL.createObjectURL(
    new Blob([CAPTURE_WORKLET], { type: "application/javascript" }),
  );
  try {
    await context.audioWorklet.addModule(blobUrl);
  } finally {
    URL.revokeObjectURL(blobUrl);
  }

  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.6;

  const worklet = new AudioWorkletNode(context, "capture-processor");

  let muted = false;
  worklet.port.onmessage = (event: MessageEvent<Float32Array>) => {
    if (muted) return;
    onFrame(floatToBase64Pcm16(event.data));
  };

  source.connect(analyser);
  analyser.connect(worklet);
  // Not connected to the destination. Routing the microphone to the speakers
  // would be a feedback loop.

  return {
    analyser,
    setMuted: (value) => {
      muted = value;
    },
    close: async () => {
      worklet.port.onmessage = null;
      worklet.disconnect();
      analyser.disconnect();
      source.disconnect();
      await context.close();
    },
  };
}

export interface AudioSink {
  /** Queues a base64 PCM16 chunk at 24kHz for gapless playback. */
  enqueue: (base64: string) => void;
  /** Drops everything queued and not yet heard. Called on barge-in. */
  interrupt: () => void;
  /** True while audio is actually playing. */
  isPlaying: () => boolean;
  readonly analyser: AnalyserNode;
  close: () => Promise<void>;
}

/**
 * Plays a stream of PCM chunks without gaps or overlap.
 *
 * Each chunk is scheduled against a running cursor rather than played on
 * arrival. Playing on arrival means every chunk starts when the network
 * delivered it, which is audible as stutter; scheduling means chunk N+1 starts
 * exactly where chunk N ends.
 *
 * The cursor is pushed forward to `currentTime` whenever it falls behind,
 * which happens after a pause or an underrun — without that it would schedule
 * into the past and the chunks would all fire at once.
 */
export async function createAudioSink(): Promise<AudioSink> {
  const context = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
  if (context.state === "suspended") await context.resume();

  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.6;
  analyser.connect(context.destination);

  let cursor = 0;
  let active = new Set<AudioBufferSourceNode>();

  return {
    enqueue: (base64) => {
      const samples = base64ToInt16(base64);
      if (samples.length === 0) return;

      const buffer = context.createBuffer(1, samples.length, OUTPUT_SAMPLE_RATE);
      const channel = buffer.getChannelData(0);
      for (let i = 0; i < samples.length; i += 1) {
        // Int16 to Float32. -32768 divides by 32768, so the range maps to
        // [-1, 1) without clipping the negative extreme.
        channel[i] = (samples[i] ?? 0) / 32768;
      }

      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(analyser);

      // A small lead keeps the first chunk from being scheduled in the past
      // by the time it is actually decoded.
      const startAt = Math.max(cursor, context.currentTime + 0.02);
      source.start(startAt);
      cursor = startAt + buffer.duration;

      active.add(source);
      source.onended = () => {
        active.delete(source);
      };
    },

    interrupt: () => {
      for (const source of active) {
        try {
          source.stop();
        } catch {
          // Already ended. Stopping twice throws and means nothing.
        }
      }
      active = new Set();
      cursor = 0;
    },

    isPlaying: () => active.size > 0,
    analyser,

    close: async () => {
      for (const source of active) {
        try {
          source.stop();
        } catch {
          /* already ended */
        }
      }
      active = new Set();
      analyser.disconnect();
      await context.close();
    },
  };
}

function floatToBase64Pcm16(input: Float32Array): string {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    // Clamp before scaling: values slightly outside [-1, 1] are normal after
    // resampling, and wrapping them would be heard as a click.
    const clamped = Math.max(-1, Math.min(1, input[i] ?? 0));
    out[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  return bytesToBase64(new Uint8Array(out.buffer as ArrayBuffer));
}

function base64ToInt16(base64: string): Int16Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  // An odd byte count would leave a dangling half-sample; drop it rather than
  // letting Int16Array throw on a misaligned buffer.
  const usable = bytes.length - (bytes.length % 2);
  return new Int16Array(bytes.buffer, 0, usable / 2);
}

function bytesToBase64(bytes: Uint8Array<ArrayBuffer>): string {
  // Chunked because String.fromCharCode with a large spread overflows the
  // call stack, which for a long utterance is a crash rather than a slowdown.
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Peak amplitude, 0..1. Shared by the level meter and, in slice 4, the orb. */
export function readLevel(
  analyser: AnalyserNode,
  scratch: Uint8Array<ArrayBuffer>,
): number {
  analyser.getByteTimeDomainData(scratch);
  let peak = 0;
  for (let i = 0; i < scratch.length; i += 1) {
    const deviation = Math.abs((scratch[i] ?? 128) - 128);
    if (deviation > peak) peak = deviation;
  }
  return Math.min(1, peak / 128);
}
