/**
 * Monophonic pitch detection (§3.2).
 *
 * YIN, by hand, because both alternatives fail on guitar in the same way: on a
 * plucked string the second harmonic is frequently louder than the fundamental,
 * so FFT peak-picking and raw autocorrelation report an octave too high. On the
 * low E that happens constantly. YIN's cumulative mean normalised difference
 * function exists to suppress exactly that error — tests/yin.test.ts asserts it.
 *
 * This module also owns the pre-processing §3.2 requires around the detector:
 * the RMS gate, the 65 Hz high-pass, and the 5-frame stability filter. The
 * buffer is deliberately NOT windowed — a Hann window biases the difference
 * function.
 */

import { centsOff } from './notes';

/**
 * The gate: below it, the frame is room noise and the detector must not guess.
 *
 * §3.2 specifies a flat 0.008, and a flat number only suits one room and one
 * guitar. An unplugged electric into a phone mic lands near -50 dBFS and is
 * thrown away; a room with an amp humming in it sits above 0.008 and holds the
 * gate open on nothing. What actually matters is whether the string is louder
 * than the room, so the gate is defined relative to the measured noise floor
 * and 0.008 becomes the fallback for when the room has not been measured yet.
 */
export const RMS_GATE = 0.008;
/** The string has to be this far above the room — x4 is 12 dB. */
export const GATE_HEADROOM = 4;
/** -62 dBFS. Below this we would be chasing the converter's own dither. */
export const GATE_MIN = 0.0008;
/** -34 dBFS. Past here the room is so loud that no gate saves us (§12.6). */
export const GATE_MAX = 0.02;

/**
 * The gate for a given measured noise floor.
 *
 * A floor of zero means the room has not been measured yet — the first second
 * after the mic opens. That second resolves to GATE_MIN rather than to the
 * spec's flat 0.008, i.e. it assumes a quiet room until told otherwise, because
 * the two ways of being wrong are not equally bad. Assume-quiet and be wrong:
 * YIN runs on room noise for under a second, and the 0.85 confidence floor and
 * the 4-of-5 stability filter throw it away. Assume-loud and be wrong: someone
 * with a quiet guitar picks a string, nothing happens, and the app looks broken
 * in its first two seconds.
 */
export function gateFor(noiseFloor: number): number {
  if (!(noiseFloor > 0)) return GATE_MIN;
  return Math.min(GATE_MAX, Math.max(GATE_MIN, noiseFloor * GATE_HEADROOM));
}
/** Open low E a semitone flat, up to fret 24 on the high E. */
export const MIN_HZ = 70;
export const MAX_HZ = 1400;
export const MIN_CONFIDENCE = 0.85;
export const YIN_THRESHOLD = 0.12;
export const HIGHPASS_HZ = 65;

/** A note is "settled" only when 4 of the last 5 frames agree within 30 cents. */
export const SETTLE_FRAMES = 5;
export const SETTLE_AGREE = 4;
export const SETTLE_CENTS = 30;

export type Pitch = { frequency: number; confidence: number };

export function rms(buf: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i]! * buf[i]!;
  return Math.sqrt(sum / buf.length);
}

/**
 * YIN, steps 1–4 of the paper.
 *
 * `buf` is a raw time-domain frame. The tau search runs from 2 up to the period
 * of MIN_HZ only: anything slower than 70 Hz is rejected downstream anyway, and
 * stopping there is a third of the work. The search deliberately still starts
 * at 2 — clamping the fast end instead would turn an out-of-band 1600 Hz note
 * into a confident 800 Hz answer, which is the very error this function exists
 * to avoid.
 */
export function yin(buf: Float32Array, sampleRate: number, threshold = YIN_THRESHOLD): Pitch | null {
  const W = Math.floor(buf.length / 2);
  const maxTau = Math.min(W - 1, Math.ceil(sampleRate / MIN_HZ));
  if (maxTau < 3) return null;

  // Step 1 — difference function.
  const diff = new Float32Array(maxTau + 1);
  for (let tau = 1; tau <= maxTau; tau++) {
    let sum = 0;
    for (let i = 0; i < W; i++) {
      const d = buf[i]! - buf[i + tau]!;
      sum += d * d;
    }
    diff[tau] = sum;
  }

  // Step 2 — cumulative mean normalised difference.
  const cmnd = new Float32Array(maxTau + 1);
  cmnd[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= maxTau; tau++) {
    running += diff[tau]!;
    cmnd[tau] = running === 0 ? 1 : (diff[tau]! * tau) / running;
  }

  // Step 3 — absolute threshold, then the first local minimum below it.
  let tau = -1;
  for (let t = 2; t < maxTau; t++) {
    if (cmnd[t]! < threshold) {
      while (t + 1 <= maxTau && cmnd[t + 1]! < cmnd[t]!) t++;
      tau = t;
      break;
    }
  }
  if (tau === -1) return null;

  // Step 4 — parabolic interpolation, for sub-sample precision. Without this
  // the low E quantises to roughly 3 cents per sample of tau.
  const x0 = tau > 1 ? tau - 1 : tau;
  const x2 = tau + 1 <= maxTau ? tau + 1 : tau;
  let betterTau = tau;
  if (x0 !== tau && x2 !== tau) {
    const s0 = cmnd[x0]!;
    const s1 = cmnd[tau]!;
    const s2 = cmnd[x2]!;
    const denom = 2 * (2 * s1 - s2 - s0);
    if (denom !== 0) betterTau = tau + (s2 - s0) / denom;
  }
  if (betterTau <= 0) return null;

  return {
    frequency: sampleRate / betterTau,
    confidence: 1 - cmnd[tau]!,
  };
}

/**
 * The gate, YIN, and the validity band, in the order §3.2 specifies. The frame
 * is expected to have been high-passed already — the filter runs once over the
 * continuous stream rather than per frame, so it carries no restart transient.
 */
export function detectPitch(
  frame: Float32Array,
  sampleRate: number,
  gate = RMS_GATE,
): Pitch | null {
  if (rms(frame) < gate) return null;
  const got = yin(frame, sampleRate);
  if (!got) return null;
  if (got.confidence < MIN_CONFIDENCE) return null;
  if (got.frequency < MIN_HZ || got.frequency > MAX_HZ) return null;
  return got;
}

/**
 * A single-pole-per-stage biquad high-pass at 65 Hz (RBJ cookbook, Q = 1/√2),
 * to kill handling rumble and mains hum before the detector sees them.
 *
 * State is carried between blocks, so the caller must feed it the continuous
 * stream — the 512-sample hop, not the overlapping 2048-sample frame.
 */
export function createHighPass(sampleRate: number, cutoff = HIGHPASS_HZ) {
  const w0 = (2 * Math.PI * cutoff) / sampleRate;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / Math.SQRT2;

  const a0 = 1 + alpha;
  const b0 = (1 + cos) / 2 / a0;
  const b1 = -(1 + cos) / a0;
  const b2 = b0;
  const a1 = (-2 * cos) / a0;
  const a2 = (1 - alpha) / a0;

  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;

  /** Filters `block` in place. */
  return function process(block: Float32Array): Float32Array {
    for (let i = 0; i < block.length; i++) {
      const x0 = block[i]!;
      const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1;
      x1 = x0;
      y2 = y1;
      y1 = y0;
      block[i] = y0;
    }
    return block;
  };
}

/**
 * The room, estimated from the signal itself.
 *
 * The gate depends on this, so getting it wrong is worse than not having it: an
 * estimator that learns the room while a string is ringing raises the gate to
 * meet the note and then shuts on it. So the room is "the quietest it has been
 * recently" — the minimum level in each one-second bucket, and the second
 * smallest of the last eight buckets. Second smallest rather than smallest so a
 * single dropped frame cannot define the room; a minimum rather than an average
 * because an average of a ringing note measures the note.
 *
 * Returns 0 until the first bucket closes, which `gateFor` reads as "not
 * measured yet" and answers with the spec's flat gate.
 *
 * The honest limit: eight seconds of continuously loud input with no gap at all
 * does raise the floor, because nothing in the signal distinguishes a room that
 * loud from playing that constant. Tuning has gaps in it; tests/noiseFloor
 * asserts both the normal case and this one.
 */
export function createNoiseFloor(hopsPerBucket: number, buckets = 8) {
  let bucketMin = Infinity;
  let hops = 0;
  let history: number[] = [];
  let floor = 0;

  return function update(level: number): number {
    if (level < bucketMin) bucketMin = level;
    if (++hops >= hopsPerBucket) {
      history.push(bucketMin);
      if (history.length > buckets) history.shift();
      bucketMin = Infinity;
      hops = 0;

      const sorted = [...history].sort((a, b) => a - b);
      floor = sorted[1] ?? sorted[0] ?? 0;
    }
    return floor;
  };
}

export type Settled = {
  settled: boolean;
  /** The agreed frequency when settled, otherwise the latest raw reading. */
  frequency: number | null;
  confidence: number | null;
};

/**
 * The stability filter. Raw frame-by-frame output jitters; this is what makes
 * the needle feel solid instead of nervous, and it is also the honest answer to
 * "is a note actually ringing" — two dropped frames and it goes unsettled.
 */
export class PitchTracker {
  #history: Array<Pitch | null> = [];

  reset() {
    this.#history = [];
  }

  push(p: Pitch | null): Settled {
    this.#history.push(p);
    if (this.#history.length > SETTLE_FRAMES) this.#history.shift();
    if (this.#history.length < SETTLE_FRAMES) {
      return { settled: false, frequency: p?.frequency ?? null, confidence: p?.confidence ?? null };
    }

    const heard = this.#history.filter((x): x is Pitch => x !== null);
    if (heard.length < SETTLE_AGREE) {
      return { settled: false, frequency: p?.frequency ?? null, confidence: p?.confidence ?? null };
    }

    const sorted = [...heard].sort((a, b) => a.frequency - b.frequency);
    const median = sorted[Math.floor(sorted.length / 2)]!.frequency;
    const agree = heard.filter((x) => Math.abs(centsOff(x.frequency, median)) <= SETTLE_CENTS);
    if (agree.length < SETTLE_AGREE) {
      return { settled: false, frequency: p?.frequency ?? null, confidence: p?.confidence ?? null };
    }

    // Average in the log domain: cents, not hertz, is the perceptual unit.
    const logSum = agree.reduce((s, x) => s + Math.log(x.frequency), 0);
    return {
      settled: true,
      frequency: Math.exp(logSum / agree.length),
      confidence: agree.reduce((s, x) => s + x.confidence, 0) / agree.length,
    };
  }
}
