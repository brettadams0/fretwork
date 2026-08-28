import { describe, it, expect } from 'vitest';
import { TunerRun, HOLD_MS, STAGE0_LIMIT_MS, clock } from '../src/games/tunerRun';
import { STANDARD_TUNING, freqFromMidi } from '../src/audio/notes';

/** Feed the run `ms` of frames at the engine's real 10.67 ms hop. */
function play(
  run: TunerRun,
  t: { now: number },
  ms: number,
  frame: { settled: boolean; frequency: number | null },
) {
  const step = 512 / 48000 * 1000;
  const until = t.now + ms;
  let view = run.view();
  while (t.now < until) {
    t.now += step;
    view = run.step({ nowMs: t.now, ...frame });
  }
  return view;
}

const inTune = (i: number) => ({ settled: true, frequency: STANDARD_TUNING[i]!.frequency });
const silence = { settled: false, frequency: null };

describe('TunerRun — the Stage 0 exit check (§6.1)', () => {
  it('marks a string only after a full 1.5 s of green', () => {
    const run = new TunerRun();
    const t = { now: 1000 };
    run.start(t.now);

    const early = play(run, t, HOLD_MS - 200, inTune(0));
    expect(early.done[0]).toBe(false);
    expect(early.holdProgress).toBeGreaterThan(0.8);

    const late = play(run, t, 300, inTune(0));
    expect(late.done[0]).toBe(true);
  });

  it('resets the hold when the note stops part way through', () => {
    const run = new TunerRun();
    const t = { now: 0 };
    run.start(t.now);

    play(run, t, 1200, inTune(2));
    const broken = play(run, t, 200, silence);
    expect(broken.holdProgress).toBe(0);
    expect(broken.done[2]).toBe(false);

    // 1.2 s of credit is gone: another 1.2 s is still not enough.
    expect(play(run, t, 1200, inTune(2)).done[2]).toBe(false);
    expect(play(run, t, 400, inTune(2)).done[2]).toBe(true);
  });

  it('resets the hold when the string drifts out of ±5 cents', () => {
    const run = new TunerRun();
    const t = { now: 0 };
    run.start(t.now);

    play(run, t, 1200, inTune(1));
    const drifted = play(run, t, 100, {
      settled: true,
      frequency: freqFromMidi(45 + 12 / 100), // 12 cents sharp — "close", not in tune
    });
    expect(drifted.holdProgress).toBe(0);
    expect(drifted.cents).toBeCloseTo(12, 0);
    expect(drifted.done[1]).toBe(false);
  });

  it('starts a new string from zero rather than inheriting the last hold', () => {
    const run = new TunerRun();
    const t = { now: 0 };
    run.start(t.now);

    play(run, t, 1400, inTune(0));
    const switched = play(run, t, 200, inTune(1));
    expect(switched.done[0]).toBe(false);
    expect(switched.done[1]).toBe(false);
    expect(switched.holdProgress).toBeLessThan(0.2);
  });

  it('identifies the string from the pitch, in any order', () => {
    const run = new TunerRun();
    const t = { now: 0 };
    run.start(t.now);
    for (const i of [5, 2, 0, 4, 1, 3]) {
      const v = play(run, t, HOLD_MS + 100, inTune(i));
      expect(v.activeIndex).toBe(i);
      expect(v.done[i]).toBe(true);
    }
    expect(run.view().done.every(Boolean)).toBe(true);
  });

  it('times the run and passes when all six land under 2:00', () => {
    const run = new TunerRun();
    const t = { now: 5000 };
    run.start(t.now);
    for (let i = 0; i < 6; i++) play(run, t, HOLD_MS + 100, inTune(i));

    const v = run.view();
    expect(v.finishedMs).not.toBeNull();
    expect(v.finishedMs!).toBeGreaterThan(6 * HOLD_MS);
    expect(v.finishedMs!).toBeLessThan(STAGE0_LIMIT_MS);
    expect(v.passed).toBe(true);
  });

  it('records the time but fails the check when it runs over 2:00', () => {
    const run = new TunerRun();
    const t = { now: 0 };
    run.start(t.now);
    for (let i = 0; i < 5; i++) play(run, t, HOLD_MS + 100, inTune(i));
    play(run, t, STAGE0_LIMIT_MS, silence); // two minutes of not playing
    play(run, t, HOLD_MS + 100, inTune(5));

    const v = run.view();
    expect(v.finishedMs).not.toBeNull();
    expect(v.finishedMs!).toBeGreaterThan(STAGE0_LIMIT_MS);
    expect(v.passed).toBe(false);
  });

  it('stops the clock once the sixth string lands', () => {
    const run = new TunerRun();
    const t = { now: 0 };
    run.start(t.now);
    for (let i = 0; i < 6; i++) play(run, t, HOLD_MS + 100, inTune(i));
    const finished = run.view().finishedMs;

    play(run, t, 30_000, silence);
    expect(run.view().elapsedMs).toBeCloseTo(finished!, 5);
  });

  it('does not accumulate time across a stalled tab', () => {
    const run = new TunerRun();
    const t = { now: 0 };
    run.start(t.now);
    // One frame arriving a minute late must not count as a minute of green.
    run.step({ nowMs: 60_000, settled: true, frequency: STANDARD_TUNING[0]!.frequency });
    expect(run.view().done[0]).toBe(false);
    expect(run.view().holdProgress).toBeLessThan(0.1);
  });
});

describe('clock', () => {
  it('formats mm:ss', () => {
    expect(clock(0)).toBe('0:00');
    expect(clock(9_400)).toBe('0:09');
    expect(clock(65_000)).toBe('1:05');
    expect(clock(STAGE0_LIMIT_MS)).toBe('2:00');
  });
});
