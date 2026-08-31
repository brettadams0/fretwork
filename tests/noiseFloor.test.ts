import { describe, it, expect } from 'vitest';
import { createNoiseFloor, gateFor, RMS_GATE, GATE_HEADROOM } from '../src/audio/yin';

/** One second of hops at the engine's real rate. */
const PER_BUCKET = 94;

function feed(update: (l: number) => number, level: number, seconds: number) {
  let out = 0;
  for (let i = 0; i < PER_BUCKET * seconds; i++) out = update(level);
  return out;
}

describe('Noise floor — the room, not the note (§12.4)', () => {
  it('reports nothing until it has heard a full second', () => {
    const nf = createNoiseFloor(PER_BUCKET);
    for (let i = 0; i < PER_BUCKET - 1; i++) expect(nf(0.001)).toBe(0);
    // An unmeasured room is assumed quiet, not assumed loud.
    expect(gateFor(0)).toBeLessThan(RMS_GATE);
  });

  it('learns a steady room', () => {
    const nf = createNoiseFloor(PER_BUCKET);
    const floor = feed(nf, 0.0004, 3);
    expect(floor).toBeCloseTo(0.0004, 6);
  });

  /* The failure this estimator exists to avoid: a note rings, the floor climbs
     to meet it, the gate rises above the note, and the tuner goes deaf on a
     string that is plainly sounding. */
  it('is not dragged up by a ringing note', () => {
    const nf = createNoiseFloor(PER_BUCKET);
    const room = 0.0002;
    feed(nf, room, 3);

    // Four seconds of a loud note, with the short gaps real plucking has.
    let floor = 0;
    for (let pluck = 0; pluck < 4; pluck++) {
      floor = feed(nf, 0.05, 0.8);
      floor = feed(nf, room, 0.2);
    }

    expect(floor).toBeCloseTo(room, 6);
    // And the note still clears the gate that floor implies.
    expect(0.05).toBeGreaterThan(gateFor(floor));
  });

  it('survives a single dropped frame without redefining the room', () => {
    const nf = createNoiseFloor(PER_BUCKET);
    feed(nf, 0.0005, 4);
    nf(0); // one frame of nothing
    const floor = feed(nf, 0.0005, 2);
    expect(floor).toBeCloseTo(0.0005, 6);
  });

  it('follows the room down when it gets quieter', () => {
    const nf = createNoiseFloor(PER_BUCKET);
    feed(nf, 0.004, 8);
    const quieter = feed(nf, 0.0002, 8);
    expect(quieter).toBeCloseTo(0.0002, 6);
  });

  /* Documented honestly rather than hidden: with no gap at all across the whole
     window there is nothing in the signal that separates a loud room from
     constant playing, and the floor does rise. */
  it('does rise under input that never stops, which is the known limit', () => {
    const nf = createNoiseFloor(PER_BUCKET);
    feed(nf, 0.0002, 3);
    const floor = feed(nf, 0.05, 10);
    expect(floor).toBeCloseTo(0.05, 4);
    expect(gateFor(floor)).toBe(0.02); // clamps at GATE_MAX, and the UI says so
  });

  it('keeps the gate a fixed ratio above whatever room it finds', () => {
    for (const room of [0.00002, 0.0005, 0.002]) {
      const nf = createNoiseFloor(PER_BUCKET);
      const floor = feed(nf, room, 3);
      const gate = gateFor(floor);
      if (gate > 0.0008 && gate < 0.02) expect(gate / floor).toBeCloseTo(GATE_HEADROOM, 6);
    }
  });
});
