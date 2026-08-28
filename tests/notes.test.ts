import { describe, it, expect } from 'vitest';
import {
  midiFromFreq,
  freqFromMidi,
  centsOff,
  noteName,
  STANDARD_TUNING,
  nearestString,
} from '../src/audio/notes';

describe('note maths (§3.3)', () => {
  it('round-trips MIDI and frequency', () => {
    for (let m = 40; m <= 88; m++) {
      expect(midiFromFreq(freqFromMidi(m))).toBeCloseTo(m, 9);
    }
  });

  it('anchors on A4 = 440 Hz', () => {
    expect(freqFromMidi(69)).toBe(440);
    expect(midiFromFreq(440)).toBe(69);
  });

  it('measures cents in both directions', () => {
    expect(centsOff(440, 440)).toBeCloseTo(0, 9);
    expect(centsOff(freqFromMidi(69.5), 440)).toBeCloseTo(50, 6);
    expect(centsOff(freqFromMidi(68), 440)).toBeCloseTo(-100, 6);
  });

  it('names notes with the right octave', () => {
    expect(noteName(82.41)).toMatchObject({ name: 'E', octave: 2, midi: 40 });
    expect(noteName(440)).toMatchObject({ name: 'A', octave: 4, midi: 69 });
    expect(noteName(329.63)).toMatchObject({ name: 'E', octave: 4, midi: 64 });
  });

  /* The string table is derived from MIDI rather than transcribed, so this
     asserts the derivation reproduces §3.3's printed frequencies. */
  it('reproduces the §3.3 standard tuning table', () => {
    const printed = [
      { string: 6, note: 'E2', hz: 82.41 },
      { string: 5, note: 'A2', hz: 110.0 },
      { string: 4, note: 'D3', hz: 146.83 },
      { string: 3, note: 'G3', hz: 196.0 },
      { string: 2, note: 'B3', hz: 246.94 },
      { string: 1, note: 'E4', hz: 329.63 },
    ];
    expect(STANDARD_TUNING).toHaveLength(6);
    for (const row of printed) {
      const s = STANDARD_TUNING.find((x) => x.string === row.string)!;
      expect(s.label).toBe(row.note);
      expect(s.frequency).toBeCloseTo(row.hz, 1);
    }
  });

  it('picks the nearest string, and its cents offset', () => {
    expect(nearestString(82.41).string.string).toBe(6);
    expect(nearestString(110).string.string).toBe(5);
    expect(nearestString(329.63).string.string).toBe(1);

    // A low E a quarter-tone flat is still the low E.
    const flat = nearestString(freqFromMidi(40 - 0.25));
    expect(flat.string.string).toBe(6);
    expect(flat.cents).toBeCloseTo(-25, 0);

    // Fret 5 on string 6 is an A2 — the same pitch as string 5 open.
    expect(nearestString(110.05).string.string).toBe(5);
  });
});
