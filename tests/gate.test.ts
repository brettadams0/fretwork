import { describe, it, expect } from 'vitest';
import {
  detectPitch,
  gateFor,
  rms,
  createHighPass,
  RMS_GATE,
  GATE_HEADROOM,
  GATE_MIN,
  GATE_MAX,
} from '../src/audio/yin';
import { centsOff } from '../src/audio/notes';
import { synthString, addNoise, frameAt } from './fixtures/synth';

const SR = 48000;
const FRAME = 2048;
const OFFSET = 4800;

const dbfs = (x: number) => 20 * Math.log10(x);
const fromDb = (db: number) => Math.pow(10, db / 20);

/** Scale a signal so the analysed frame lands at a chosen level. */
function atLevel(signal: Float32Array, target: number): Float32Array {
  const frame = frameAt(signal, OFFSET, FRAME);
  const scale = target / rms(frame);
  const out = new Float32Array(signal.length);
  for (let i = 0; i < signal.length; i++) out[i] = signal[i]! * scale;
  return out;
}

/** Steady room tone: broadband noise at a chosen RMS. */
function room(level: number, seed = 3): Float32Array {
  const silence = new Float32Array(SR);
  const noise = addNoise(silence, 0, seed);
  // addNoise scales against signal power, which is zero here, so fill directly.
  let a = seed >>> 0;
  for (let i = 0; i < noise.length; i++) {
    a = (a * 1664525 + 1013904223) >>> 0;
    noise[i] = ((a / 4294967296) * 2 - 1) * level * Math.sqrt(3);
  }
  return noise;
}

describe('The gate adapts to the room (§3.2, §12.4)', () => {
  /* Before the room is known, assume it is quiet. Assuming it is loud makes the
     app look broken for its first two seconds to exactly the user this change
     is for — the one with a quiet guitar. */
  it('assumes a quiet room until it has measured one', () => {
    expect(gateFor(0)).toBe(GATE_MIN);
    expect(gateFor(-1)).toBe(GATE_MIN);
    expect(gateFor(Number.NaN)).toBe(GATE_MIN);
    expect(GATE_MIN).toBeLessThan(RMS_GATE);
  });

  it('detects a quiet note in the first second, before any room estimate', () => {
    const signal = atLevel(synthString(196, SR), 0.003);
    const got = detectPitch(frameAt(signal, OFFSET, FRAME), SR, gateFor(0));
    expect(got).not.toBeNull();
    expect(Math.abs(centsOff(got!.frequency, 196))).toBeLessThan(5);
  });

  it('sits a fixed headroom above the measured floor', () => {
    for (const db of [-70, -60, -50, -45]) {
      const floor = fromDb(db);
      const gate = gateFor(floor);
      if (gate > GATE_MIN && gate < GATE_MAX) {
        expect(gate).toBeCloseTo(floor * GATE_HEADROOM, 9);
        // Stated as a signal-to-room ratio, that headroom is what matters.
        expect(dbfs(gate) - dbfs(floor)).toBeCloseTo(dbfs(GATE_HEADROOM), 6);
      }
    }
  });

  it('never chases digital silence, and never demands the impossible', () => {
    expect(gateFor(1e-9)).toBe(GATE_MIN);
    expect(gateFor(0.5)).toBe(GATE_MAX);
    for (const floor of [1e-9, 1e-6, 1e-3, 0.01, 0.5]) {
      const g = gateFor(floor);
      expect(g).toBeGreaterThanOrEqual(GATE_MIN);
      expect(g).toBeLessThanOrEqual(GATE_MAX);
    }
  });

  it('rises monotonically with the room', () => {
    let last = 0;
    for (const db of [-90, -80, -70, -60, -50, -40, -30]) {
      const g = gateFor(fromDb(db));
      expect(g).toBeGreaterThanOrEqual(last);
      last = g;
    }
  });

  /* The case the fixed gate gets wrong, and the reason for this change.
     An unplugged electric into a phone mic in a quiet room: the note is real,
     steady and perfectly detectable, and 0.008 throws it away. */
  it('hears a quiet guitar in a quiet room, where the fixed gate would not', () => {
    const quietRoom = 0.00005; // the S20 FE's measured idle floor, -86 dBFS
    const signal = atLevel(synthString(82.41, SR), 0.003); // -50 dBFS
    const frame = frameAt(signal, OFFSET, FRAME);

    expect(rms(frame)).toBeLessThan(RMS_GATE); // the fixed gate rejects it
    expect(detectPitch(frame, SR)).toBeNull();

    const adaptive = gateFor(quietRoom);
    expect(rms(frame)).toBeGreaterThan(adaptive);

    const got = detectPitch(frame, SR, adaptive);
    expect(got, 'a real note was thrown away').not.toBeNull();
    expect(Math.abs(centsOff(got!.frequency, 82.41))).toBeLessThan(5);
  });

  it('still refuses the room itself, at any room level', () => {
    for (const db of [-85, -70, -55, -40]) {
      const level = fromDb(db);
      const frame = frameAt(room(level), OFFSET, FRAME);
      const floor = rms(frame);
      // The room cannot clear a gate defined as the room plus headroom.
      expect(floor).toBeLessThan(gateFor(floor));
      expect(detectPitch(frame, SR, gateFor(floor))).toBeNull();
    }
  });

  it('does not let a guitar quieter than the room through', () => {
    const loudRoom = 0.01; // -40 dBFS
    const signal = atLevel(synthString(110, SR), 0.004); // under the room
    const frame = frameAt(signal, OFFSET, FRAME);
    expect(detectPitch(frame, SR, gateFor(loudRoom))).toBeNull();
  });

  it('works end to end at four very different levels', () => {
    // Same note, same room ratio, levels spanning 40 dB: an unplugged guitar
    // across the room, and an amp in front of the phone, must both work.
    for (const level of [0.002, 0.01, 0.05, 0.2]) {
      const floor = level / 8; // consistently 18 dB of signal over the room
      const signal = atLevel(synthString(146.83, SR), level);
      const hp = createHighPass(SR);
      const filtered = Float32Array.from(signal);
      for (let o = 0; o + 512 <= filtered.length; o += 512) hp(filtered.subarray(o, o + 512));

      const frame = frameAt(filtered, OFFSET, FRAME);
      const got = detectPitch(frame, SR, gateFor(floor));
      expect(got, `nothing detected at ${dbfs(level).toFixed(0)} dBFS`).not.toBeNull();
      expect(Math.abs(centsOff(got!.frequency, 146.83))).toBeLessThan(5);
    }
  });
});
