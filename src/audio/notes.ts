/**
 * frequency <-> MIDI <-> note name <-> cents (§3.3).
 *
 * Everything downstream of the detector speaks in these units, so they are
 * derived rather than transcribed: the standard-tuning table below is computed
 * from MIDI numbers, and tests/notes.test.ts asserts that the derivation
 * reproduces the frequencies §3.3 prints.
 */

export const midiFromFreq = (f: number) => 69 + 12 * Math.log2(f / 440);
export const freqFromMidi = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
export const centsOff = (f: number, target: number) => 1200 * Math.log2(f / target);

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

export function noteName(f: number) {
  const m = Math.round(midiFromFreq(f));
  return { name: NAMES[((m % 12) + 12) % 12]!, octave: Math.floor(m / 12) - 1, midi: m };
}

export type GuitarString = {
  /** 6 is the low E, 1 is the high E — the way strings are numbered on paper. */
  string: 6 | 5 | 4 | 3 | 2 | 1;
  midi: number;
  /** Scientific pitch name, e.g. 'E2'. */
  label: string;
  /** The tuning target, in Hz. */
  frequency: number;
};

const OPEN_MIDI = [
  { string: 6, midi: 40 },
  { string: 5, midi: 45 },
  { string: 4, midi: 50 },
  { string: 3, midi: 55 },
  { string: 2, midi: 59 },
  { string: 1, midi: 64 },
] as const;

/** Standard E tuning, low to high. Drop D and half-step down are Phase 5. */
export const STANDARD_TUNING: readonly GuitarString[] = OPEN_MIDI.map((s) => {
  const n = noteName(freqFromMidi(s.midi));
  return {
    string: s.string,
    midi: s.midi,
    label: `${n.name}${n.octave}`,
    frequency: freqFromMidi(s.midi),
  };
});

/**
 * Which string is this pitch closest to, and by how much. The tuner never asks
 * the user which string they are on — it works it out, so they can tune in
 * whatever order they like.
 */
export function nearestString(f: number): { string: GuitarString; cents: number } {
  let best = STANDARD_TUNING[0]!;
  let bestCents = centsOff(f, best.frequency);
  for (const s of STANDARD_TUNING) {
    const c = centsOff(f, s.frequency);
    if (Math.abs(c) < Math.abs(bestCents)) {
      best = s;
      bestCents = c;
    }
  }
  return { string: best, cents: bestCents };
}

/** ±5 cents is in tune, ±15 is close, anything beyond is sharp or flat (§3.3). */
export type Accuracy = 'in-tune' | 'close' | 'off';

export function accuracy(cents: number): Accuracy {
  const a = Math.abs(cents);
  if (a <= 5) return 'in-tune';
  if (a <= 15) return 'close';
  return 'off';
}
