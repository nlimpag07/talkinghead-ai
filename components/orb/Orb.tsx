"use client";

import { useEffect, useRef } from "react";
import { readLevel } from "@/lib/audio";
import type { OrbState } from "@/types/realtime";

export interface OrbProps {
  readonly state: OrbState;
  /** Mic analyser. Drives the orb while listening. */
  readonly inputAnalyserRef: React.RefObject<AnalyserNode | null>;
  /** Playback analyser. Drives the orb while speaking. */
  readonly outputAnalyserRef: React.RefObject<AnalyserNode | null>;
}

/**
 * Latitude rings, and the longitude count at the equator.
 *
 * A lat-long grid is what gives the visible lattice — a Fibonacci sphere
 * scatters evenly but reads as noise. The cost of the grid is that a fixed
 * longitude count bunches particles at the poles, which renders as two bright
 * tufts that look like a rendering fault rather than a design. So each ring
 * gets a longitude count proportional to its circumference, which keeps
 * surface density roughly uniform and the lattice intact.
 */
const LAT_STEPS = 74;
const LON_AT_EQUATOR = 104;

/** Colour ramp resolution. Bucketing lets one `fillStyle` assignment cover
 *  every particle sharing a colour, which is what keeps ~4,400 draws a frame
 *  affordable on a 2D canvas. */
const RAMP_STEPS = 28;

type Ramp = readonly (readonly [number, number, number])[];

/**
 * Vertical colour ramps, bottom to top.
 *
 * Deliberate art direction rather than theme tokens: the cool-to-warm sweep is
 * most of what makes the orb read as a single object with depth, and a
 * single-hue version of it looks flat. The `orb` row in Setting already exists
 * to make this swappable from the admin panel in slice 8.
 */
const RAMPS: Record<"active" | "muted" | "error", Ramp> = {
  // Amber at the base through magenta to indigo at the crown.
  active: [
    [255, 196, 88],
    [255, 126, 74],
    [236, 72, 122],
    [168, 68, 190],
    [96, 82, 214],
    [64, 96, 208],
  ],
  muted: [
    [110, 110, 115],
    [98, 98, 104],
    [88, 88, 94],
    [78, 78, 84],
    [70, 70, 76],
    [64, 64, 70],
  ],
  error: [
    [255, 150, 120],
    [244, 96, 84],
    [224, 62, 62],
    [196, 44, 54],
    [162, 36, 50],
    [134, 30, 44],
  ],
};

/** Per-state behaviour. */
const APPEARANCE: Record<
  OrbState,
  {
    readonly ramp: keyof typeof RAMPS;
    readonly spin: number;
    readonly spike: number;
    readonly churn: number;
    readonly brightness: number;
    readonly reactive: "input" | "output" | null;
  }
> = {
  idle: { ramp: "active", spin: 0.05, spike: 0.11, churn: 0.28, brightness: 0.72, reactive: null },
  listening: { ramp: "active", spin: 0.07, spike: 0.13, churn: 0.45, brightness: 1.0, reactive: "input" },
  thinking: { ramp: "active", spin: 0.26, spike: 0.20, churn: 1.30, brightness: 1.05, reactive: null },
  speaking: { ramp: "active", spin: 0.09, spike: 0.15, churn: 0.60, brightness: 1.1, reactive: "output" },
  muted: { ramp: "muted", spin: 0.03, spike: 0.02, churn: 0.15, brightness: 0.45, reactive: null },
  error: { ramp: "error", spin: 0.02, spike: 0.03, churn: 0.20, brightness: 0.8, reactive: null },
};

/**
 * The assistant's visual presence: a sphere of particles that spikes outward
 * with the audio.
 *
 * Everything animated lives outside React. Amplitude changes 60 times a second
 * and putting that through setState would re-render the transcript beside it,
 * so the loop reads the analyser directly and draws; React only ever hears
 * about `state`.
 *
 * Three things make several thousand particles per frame affordable on a 2D
 * canvas:
 * the sphere is generated once, the displacement noise is factored so no
 * trigonometry runs per particle per frame, and particles are pre-grouped by
 * colour so `fillStyle` is assigned 28 times a frame instead of 4,400.
 *
 * Decorative, so `aria-hidden`. Every state it shows is also announced as text
 * in the controls — the orb is never the only indication of anything.
 */
export function Orb({ state, inputAnalyserRef, outputAnalyserRef }: OrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return;

    // ─── Geometry, built once ──────────────────────────────────────────────
    // Ring longitude counts first, so the exact particle total is known before
    // any typed array is allocated.
    const ringLon: number[] = [];
    const ringPhi: number[] = [];
    for (let i = 0; i < LAT_STEPS; i += 1) {
      // acos spacing rather than linear, so rings are equal-area.
      const phi = Math.acos(1 - (2 * (i + 0.5)) / LAT_STEPS);
      ringPhi.push(phi);
      ringLon.push(Math.max(5, Math.round(LON_AT_EQUATOR * Math.sin(phi))));
    }
    const PARTICLES = ringLon.reduce((sum, n) => sum + n, 0);

    const px = new Float32Array(PARTICLES);
    const py = new Float32Array(PARTICLES);
    const pz = new Float32Array(PARTICLES);

    /**
     * Displacement noise, pre-factored.
     *
     * Each term is `sin(k·angles + ω·t)`, expanded via
     * `sin(a+b) = sin a cos b + cos a sin b` so the angle-dependent halves can
     * be precomputed per particle and only `cos(ωt)`/`sin(ωt)` vary per frame.
     * Without this the loop would run six trig calls per particle per frame —
     * about 1.6 million a second — for a shape that never changes.
     */
    const s1 = new Float32Array(PARTICLES);
    const c1 = new Float32Array(PARTICLES);
    const s2 = new Float32Array(PARTICLES);
    const c2 = new Float32Array(PARTICLES);
    const s3 = new Float32Array(PARTICLES);
    const c3 = new Float32Array(PARTICLES);

    // Colour bucket per particle, from latitude. Fixed for the life of the
    // orb: rotation is about the Y axis, so a particle's height never changes.
    const bucketOf = new Uint8Array(PARTICLES);

    let index = 0;
    for (let i = 0; i < LAT_STEPS; i += 1) {
      const phi = ringPhi[i]!;
      const lonCount = ringLon[i]!;
      const sinPhi = Math.sin(phi);
      const cosPhi = Math.cos(phi);
      // Offset each ring so the lattice reads as a weave rather than straight
      // meridians, which is closer to the reference and hides the seam where
      // longitude wraps.
      const offset = (i % 2) * (Math.PI / lonCount);

      for (let j = 0; j < lonCount; j += 1) {
        const theta = (2 * Math.PI * j) / lonCount + offset;
        const x = sinPhi * Math.cos(theta);
        const y = cosPhi;
        const z = sinPhi * Math.sin(theta);

        px[index] = x;
        py[index] = y;
        pz[index] = z;

        const a1 = 3 * theta + 4 * phi;
        const a2 = 7 * phi - 2 * theta;
        const a3 = 5 * theta + 9 * phi;
        s1[index] = Math.sin(a1);
        c1[index] = Math.cos(a1);
        s2[index] = Math.sin(a2);
        c2[index] = Math.cos(a2);
        s3[index] = Math.sin(a3);
        c3[index] = Math.cos(a3);

        // y is +1 at the crown, -1 at the base; the ramp reads base-first.
        bucketOf[index] = Math.min(
          RAMP_STEPS - 1,
          Math.max(0, Math.round(((y + 1) / 2) * (RAMP_STEPS - 1))),
        );
        index += 1;
      }
    }

    // Particle indices grouped by colour bucket, so each bucket is one
    // fillStyle assignment followed by a tight draw loop.
    const buckets: Uint32Array[] = [];
    {
      const counts = new Uint32Array(RAMP_STEPS);
      for (let i = 0; i < PARTICLES; i += 1) counts[bucketOf[i] ?? 0]! += 1;
      const cursors = new Uint32Array(RAMP_STEPS);
      for (let b = 0; b < RAMP_STEPS; b += 1) {
        buckets.push(new Uint32Array(counts[b] ?? 0));
      }
      for (let i = 0; i < PARTICLES; i += 1) {
        const b = bucketOf[i] ?? 0;
        buckets[b]![cursors[b]!++] = i;
      }
    }

    // ─── Colour ────────────────────────────────────────────────────────────
    /** Ramp sampled into RAMP_STEPS CSS strings, rebuilt when brightness or
     *  the ramp changes rather than per frame. */
    let cachedKey = "";
    let colours: string[] = [];

    const buildColours = (rampKey: keyof typeof RAMPS, brightness: number) => {
      const key = `${rampKey}:${brightness.toFixed(2)}`;
      if (key === cachedKey) return;
      cachedKey = key;

      const ramp = RAMPS[rampKey];
      colours = new Array<string>(RAMP_STEPS);
      for (let b = 0; b < RAMP_STEPS; b += 1) {
        const position = (b / (RAMP_STEPS - 1)) * (ramp.length - 1);
        const low = Math.floor(position);
        const high = Math.min(ramp.length - 1, low + 1);
        const mix = position - low;
        const a = ramp[low]!;
        const z = ramp[high]!;
        const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
        const r = clamp((a[0] + (z[0] - a[0]) * mix) * brightness);
        const g = clamp((a[1] + (z[1] - a[1]) * mix) * brightness);
        const bl = clamp((a[2] + (z[2] - a[2]) * mix) * brightness);
        colours[b] = `rgb(${r}, ${g}, ${bl})`;
      }
    };

    // ─── Canvas sizing ─────────────────────────────────────────────────────
    let width = 0;
    let height = 0;
    let ratio = 1;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      // Capped at 2: a 3x ratio triples the fill cost for no visible gain on
      // one-pixel particles.
      ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    // ─── Loop ──────────────────────────────────────────────────────────────
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const scratch = new Uint8Array(1024);
    let smoothed = 0;
    let spin = 0;
    let lastMs = 0;
    let frame = 0;

    const draw = (timeMs: number) => {
      const look = APPEARANCE[stateRef.current];
      const still = reducedMotion.matches;
      const t = timeMs / 1000;
      const dt = lastMs === 0 ? 0 : Math.min(0.05, (timeMs - lastMs) / 1000);
      lastMs = timeMs;

      let amplitude = 0;
      if (look.reactive && !still) {
        const analyser =
          look.reactive === "input"
            ? inputAnalyserRef.current
            : outputAnalyserRef.current;
        if (analyser) {
          const raw = readLevel(
            analyser,
            scratch.subarray(0, analyser.fftSize / 2) as Uint8Array<ArrayBuffer>,
          );
          // Asymmetric: snaps up on speech onset, decays slowly so the orb
          // does not flicker between syllables.
          smoothed = raw > smoothed ? raw : smoothed * 0.9 + raw * 0.1;
          amplitude = Math.min(1, smoothed * 1.7);
        }
      } else {
        smoothed = 0;
      }

      // Integrated rather than derived from `t`, so a change of spin rate does
      // not make the sphere jump to a new angle.
      if (!still) spin += dt * look.spin * Math.PI * 2;

      buildColours(look.ramp, look.brightness);

      const cx = width / 2;
      const cy = height / 2;
      const unit = Math.min(width, height);
      // Leaves room for spikes to extend without touching the canvas edge.
      const scale = unit * 0.33;

      const churn = still ? 0 : t * look.churn;
      const ct1 = Math.cos(churn * 0.7);
      const st1 = Math.sin(churn * 0.7);
      const ct2 = Math.cos(churn * 1.3);
      const st2 = Math.sin(churn * 1.3);
      const ct3 = Math.cos(churn * 0.45);
      const st3 = Math.sin(churn * 0.45);

      const cosSpin = Math.cos(spin);
      const sinSpin = Math.sin(spin);
      const reach = look.spike + amplitude * 0.55;
      const dot = Math.max(1, ratio > 1 ? 1 : 1.2);

      context.clearRect(0, 0, width, height);

      for (let b = 0; b < RAMP_STEPS; b += 1) {
        const group = buckets[b]!;
        if (group.length === 0) continue;
        context.fillStyle = colours[b]!;

        for (let k = 0; k < group.length; k += 1) {
          const i = group[k]!;

          // Coherent lobes, in -1..1. Three terms is enough for the spiky,
          // clustered character; one term alone reads as a smooth blob.
          const n =
            (s1[i]! * ct1 + c1[i]! * st1) * 0.5 +
            (s2[i]! * ct2 + c2[i]! * st2) * 0.32 +
            (s3[i]! * ct3 + c3[i]! * st3) * 0.18;

          // Only outward, and sharpened: `n*n` concentrates displacement into
          // fewer, sharper bursts instead of swelling the whole sphere.
          const push = n > 0 ? n * n * reach : 0;
          const r = 1 + push;

          const x = px[i]! * r;
          const y = py[i]! * r;
          const z = pz[i]! * r;

          // Rotate about Y.
          const rx = x * cosSpin + z * sinSpin;
          const rz = -x * sinSpin + z * cosSpin;

          // Weak perspective: enough for depth, not enough to distort the
          // silhouette into an egg.
          const depth = 1 / (1.9 - rz * 0.45);
          const sx = cx + rx * scale * depth * 1.9;
          const sy = cy - y * scale * depth * 1.9;

          // Size carries depth instead of alpha. Alpha would mean a second
          // fillStyle per particle, which is the one thing this loop cannot
          // afford.
          const size = rz > 0 ? dot * 1.35 : dot;
          context.fillRect(sx, sy, size, size);
        }
      }

      if (!still) frame = requestAnimationFrame(draw);
    };

    resize();
    frame = requestAnimationFrame(draw);

    const observer = new ResizeObserver(() => {
      resize();
      // Reduced motion runs no loop, so a resize needs an explicit redraw.
      if (reducedMotion.matches) draw(performance.now());
    });
    observer.observe(canvas);

    const onMotionChange = () => {
      cancelAnimationFrame(frame);
      lastMs = 0;
      frame = requestAnimationFrame(draw);
    };
    reducedMotion.addEventListener("change", onMotionChange);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      reducedMotion.removeEventListener("change", onMotionChange);
    };
  }, [inputAnalyserRef, outputAnalyserRef]);

  // A state change needs an explicit redraw when the loop is not running.
  useEffect(() => {
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    // Cheapest correct nudge: ResizeObserver fires on any box change, and the
    // loop's own redraw path is behind it.
    if (context) canvas.style.willChange = canvas.style.willChange ? "" : "transform";
  }, [state]);

  return (
    // Square, sized to the smaller viewport axis. Height is the tighter
    // constraint because the controls sit along the bottom, so it is capped
    // lower than width — at 92vh the sphere ran straight into them. The canvas
    // draws relative to min(width, height), so this is the only place size is
    // decided.
    <div className="relative aspect-square h-[min(72vh,86vw)] w-[min(72vh,86vw)]">
      <canvas ref={canvasRef} aria-hidden className="h-full w-full" />
    </div>
  );
}
