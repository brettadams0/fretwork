import { describe, it, expect } from 'vitest';
import {
  ChordCheckRun,
  ATTACK_WINDOW_MS,
  FAST_DECAY_MS,
  MATCH_CENTS,
  BUZZ_CONFIDENCE,
  REARM_MS,
  type CheckFrame,
} from '../src/games/chordCheck';
import { chordById, soundingStrings } from '../src/content/chords';
import { freqFromMidi } from '../src/audio/notes';

const HOP = (512 / 48000) * 1000; // 10.67 ms, the engine's real cadence
const GATE = 0.001;
const LOUD = 0.05;

const em = () => chordById('Em')!;

/** A frame carrying a clean, settled note at a given pitch. */
function ringing(nowMs: number, midi: number, cents = 0, rms = LOUD): CheckFrame {
  const frequency = freqFromMidi(midi + cents / 100);
  return {
    nowMs,
    rms,
    gate: GATE,
    settled: { settled: true, frequency, confidence: 0.98 },
    raw: { frequency, confidence: 0.98 },
  };
}

/** Sound arrived, but nothing periodic in it — a muted thud. */
function thud(nowMs: number, rms = LOUD): CheckFrame {
  return {
    nowMs,
    rms,
    gate: GATE,
    settled: { settled: false, frequency: null, confidence: null },
    raw: { frequency: 300, confidence: 0.2 },
  };
}

/** Periodic, but too weak and unstable to pass the confidence floor. */
function rattle(nowMs: number, midi: number, rms = LOUD): CheckFrame {
  return {
    nowMs,
    rms,
    gate: GATE,
    settled: { settled: false, frequency: null, confidence: null },
    raw: { frequency: freqFromMidi(midi), confidence: 0.7 },
  };
}

const silence = (nowMs: number): CheckFrame => ({
  nowMs,
  rms: GATE / 10,
  gate: GATE,
  settled: { settled: false, frequency: null, confidence: null },
  raw: null,
});

/** Feed `ms` of frames built by `make`, at the engine's hop rate. */
function play(
  run: ChordCheckRun,
  t: { now: number },
  ms: number,
  make: (nowMs: number) => CheckFrame,
) {
  const until = t.now + ms;
  while (t.now < until) {
    t.now += HOP;
    run.step(make(t.now));
  }
  return run.view();
}

/** Silence long enough for the checker to arm for the next string. */
const rearm = (run: ChordCheckRun, t: { now: number }) => play(run, t, REARM_MS + 60, silence);

describe('Chord Check — the arpeggio verifier (§4.1)', () => {
  it('asks for the sounding strings in order, low to high', () => {
    const run = new ChordCheckRun(em());
    const t = { now: 0 };
    run.start(t.now);
    expect(run.view().target!.string).toBe(6);

    play(run, t, ATTACK_WINDOW_MS + 100, (n) => ringing(n, 40));
    rearm(run, t);
    expect(run.view().target!.string).toBe(5);
  });

  it('skips strings the shape does not play', () => {
    // D is xx0232 — the checker must never ask for strings 6 or 5.
    const run = new ChordCheckRun(chordById('D')!);
    run.start(0);
    expect(run.view().target!.string).toBe(4);
    expect(soundingStrings(chordById('D')!).map((s) => s.string)).toEqual([4, 3, 2, 1]);
  });

  it('passes a string that rings at the right pitch', () => {
    const run = new ChordCheckRun(em());
    const t = { now: 0 };
    run.start(t.now);
    const v = play(run, t, ATTACK_WINDOW_MS + 100, (n) => ringing(n, 40, 3));

    expect(v.results).toHaveLength(1);
    expect(v.results[0]!.verdict).toBe('correct');
    expect(v.results[0]!.string).toBe(6);
    expect(v.results[0]!.cents!).toBeCloseTo(3, 0);
  });

  it('accepts a string that is merely out of tune, not wrongly fretted', () => {
    // A guitar drifts. Being 30 cents flat is a tuning problem, and telling the
    // user their finger is wrong would be a confidently wrong diagnosis.
    const run = new ChordCheckRun(em());
    const t = { now: 0 };
    run.start(t.now);
    const v = play(run, t, ATTACK_WINDOW_MS + 100, (n) => ringing(n, 40, MATCH_CENTS - 10));
    expect(v.results[0]!.verdict).toBe('correct');
  });

  it('calls a wrong fret wrong, and says what it heard', () => {
    const run = new ChordCheckRun(em());
    const t = { now: 0 };
    run.start(t.now);
    const v = play(run, t, ATTACK_WINDOW_MS + 100, (n) => ringing(n, 42)); // two frets up

    expect(v.results[0]!.verdict).toBe('wrong');
    expect(v.results[0]!.heardMidi).toBe(42);
    expect(v.results[0]!.diagnosis).toContain('F#2');
  });

  /* The diagnosis the whole feature exists for. Sound arrives, no pitch comes
     out of it: that is a finger lying across the string. */
  it('calls a muted string dead, not wrong', () => {
    const run = new ChordCheckRun(em());
    const t = { now: 0 };
    run.start(t.now);
    const v = play(run, t, ATTACK_WINDOW_MS + 100, thud);

    expect(v.results[0]!.verdict).toBe('dead');
    expect(v.results[0]!.heardMidi).toBeNull();
    expect(v.results[0]!.diagnosis).toMatch(/muted/i);
  });

  it('tells a buzz from a dead string by the periodicity underneath it', () => {
    const run = new ChordCheckRun(em());
    const t = { now: 0 };
    run.start(t.now);
    const v = play(run, t, ATTACK_WINDOW_MS + 100, (n) => rattle(n, 40));

    expect(v.results[0]!.verdict).toBe('buzz');
    expect(v.results[0]!.diagnosis).toMatch(/fret wire|pressing/i);
    // The distinction is the confidence: below BUZZ_CONFIDENCE it is a thud.
    expect(BUZZ_CONFIDENCE).toBeGreaterThan(0.2);
    expect(BUZZ_CONFIDENCE).toBeLessThan(0.7);
  });

  it('calls a note that dies inside 200 ms a buzz, even at the right pitch', () => {
    const run = new ChordCheckRun(em());
    const t = { now: 0 };
    run.start(t.now);
    const start = t.now;
    const v = play(run, t, ATTACK_WINDOW_MS + 100, (n) => {
      const age = n - start;
      // Collapses to a tenth of its peak well inside the fast-decay window.
      const level = age < FAST_DECAY_MS * 0.5 ? LOUD : LOUD * 0.08;
      return ringing(n, 40, 0, level);
    });
    expect(v.results[0]!.verdict).toBe('buzz');
  });

  it('does not judge anything while the string is still silent', () => {
    const run = new ChordCheckRun(em());
    const t = { now: 0 };
    run.start(t.now);
    const v = play(run, t, 3000, silence);
    expect(v.results).toHaveLength(0);
    expect(v.phase).toBe('waiting');
    expect(v.target!.string).toBe(6);
  });

  it('will not take the next string until the last one has stopped', () => {
    const run = new ChordCheckRun(em());
    const t = { now: 0 };
    run.start(t.now);
    play(run, t, ATTACK_WINDOW_MS + 100, (n) => ringing(n, 40));
    expect(run.view().results).toHaveLength(1);

    // Still ringing: a decaying string must not be counted as the next pluck.
    play(run, t, 400, (n) => ringing(n, 40));
    expect(run.view().results).toHaveLength(1);

    rearm(run, t);
    play(run, t, ATTACK_WINDOW_MS + 100, (n) => ringing(n, 47));
    expect(run.view().results).toHaveLength(2);
    expect(run.view().results[1]!.verdict).toBe('correct');
  });

  it('runs a whole clean chord and reports it clean', () => {
    const chord = em();
    const run = new ChordCheckRun(chord);
    const t = { now: 0 };
    run.start(t.now);

    for (const s of soundingStrings(chord)) {
      play(run, t, ATTACK_WINDOW_MS + 100, (n) => ringing(n, s.midi));
      rearm(run, t);
    }

    const v = run.view();
    expect(v.complete).toBe(true);
    expect(v.results).toHaveLength(6);
    expect(v.results.every((r) => r.verdict === 'correct')).toBe(true);
    expect(v.summary.clean).toBe(true);
  });

  it('reads six dead strings as one problem, not six', () => {
    const chord = em();
    const run = new ChordCheckRun(chord);
    const t = { now: 0 };
    run.start(t.now);
    for (let i = 0; i < 6; i++) {
      play(run, t, ATTACK_WINDOW_MS + 100, thud);
      rearm(run, t);
    }
    const v = run.view();
    expect(v.complete).toBe(true);
    expect(v.summary.clean).toBe(false);
    expect(v.summary.text).toMatch(/thumb/i);
  });

  it('holds the per-string result against the string it was played on', () => {
    const chord = em();
    const run = new ChordCheckRun(chord);
    const t = { now: 0 };
    run.start(t.now);

    // String 6 fine, string 5 muted, the rest fine.
    for (const s of soundingStrings(chord)) {
      if (s.string === 5) play(run, t, ATTACK_WINDOW_MS + 100, thud);
      else play(run, t, ATTACK_WINDOW_MS + 100, (n) => ringing(n, s.midi));
      rearm(run, t);
    }

    const v = run.view();
    const bad = v.results.filter((r) => r.verdict !== 'correct');
    expect(bad).toHaveLength(1);
    expect(bad[0]!.string).toBe(5);
    expect(bad[0]!.diagnosis).toMatch(/String 5/);
  });

  it('can redo a single string without losing the rest', () => {
    const chord = em();
    const run = new ChordCheckRun(chord);
    const t = { now: 0 };
    run.start(t.now);
    play(run, t, ATTACK_WINDOW_MS + 100, thud);
    rearm(run, t);
    expect(run.view().results[0]!.verdict).toBe('dead');

    run.redoLast();
    expect(run.view().results).toHaveLength(0);
    expect(run.view().target!.string).toBe(6);

    play(run, t, ATTACK_WINDOW_MS + 100, (n) => ringing(n, 40));
    expect(run.view().results[0]!.verdict).toBe('correct');
  });
});
