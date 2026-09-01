/**
 * Chord shapes with per-string note data (§4.3).
 *
 * The arpeggio checker compares what it hears against `midi` on each row, so a
 * wrong number here does not produce a bug that looks like a bug — it produces
 * a confident, specific, wrong diagnosis of the user's hand. tests/chords.test
 * derives every midi from the open string plus the fret and checks the result
 * spells the chord it claims to.
 */

export type StringNumber = 1 | 2 | 3 | 4 | 5 | 6;
export type Finger = 0 | 1 | 2 | 3 | 4;

export type ChordString = {
  string: StringNumber;
  /** 'x' means do not play it — the checker skips it and the diagram marks it. */
  fret: number | 'x';
  /** 0 is an open string. */
  finger: Finger;
  /** The pitch this string should sound in this shape. */
  midi: number;
};

export type ChordShape = {
  id: string;
  name: string;
  /** Low E first, so the array reads the way the arpeggio is played. */
  strings: ChordString[];
  /** Pitch classes the shape spells, for the test to check against. */
  spells: string[];
  stage: number;
  difficulty: 1 | 2 | 3 | 4 | 5;
};

/** Open string pitches, low to high. Standard tuning only in v1. */
export const OPEN_MIDI: Record<StringNumber, number> = {
  6: 40, // E2
  5: 45, // A2
  4: 50, // D3
  3: 55, // G3
  2: 59, // B3
  1: 64, // E4
};

/** Build a row, deriving the pitch rather than transcribing it. */
function at(string: StringNumber, fret: number | 'x', finger: Finger): ChordString {
  return {
    string,
    fret,
    finger,
    midi: fret === 'x' ? -1 : OPEN_MIDI[string] + fret,
  };
}

/**
 * Stage 2's set, in the curriculum's own order. Barre shapes and power chords
 * are generated from a root and a template later rather than hand-authored.
 */
export const CHORDS: ChordShape[] = [
  {
    id: 'Em',
    name: 'E minor',
    strings: [at(6, 0, 0), at(5, 2, 2), at(4, 2, 3), at(3, 0, 0), at(2, 0, 0), at(1, 0, 0)],
    spells: ['E', 'G', 'B'],
    stage: 2,
    difficulty: 1,
  },
  {
    id: 'Am',
    name: 'A minor',
    strings: [at(6, 'x', 0), at(5, 0, 0), at(4, 2, 2), at(3, 2, 3), at(2, 1, 1), at(1, 0, 0)],
    spells: ['A', 'C', 'E'],
    stage: 2,
    difficulty: 2,
  },
  {
    id: 'D',
    name: 'D major',
    strings: [at(6, 'x', 0), at(5, 'x', 0), at(4, 0, 0), at(3, 2, 1), at(2, 3, 3), at(1, 2, 2)],
    spells: ['D', 'F#', 'A'],
    stage: 2,
    difficulty: 2,
  },
  {
    id: 'E',
    name: 'E major',
    strings: [at(6, 0, 0), at(5, 2, 2), at(4, 2, 3), at(3, 1, 1), at(2, 0, 0), at(1, 0, 0)],
    spells: ['E', 'G#', 'B'],
    stage: 2,
    difficulty: 2,
  },
  {
    id: 'A',
    name: 'A major',
    strings: [at(6, 'x', 0), at(5, 0, 0), at(4, 2, 1), at(3, 2, 2), at(2, 2, 3), at(1, 0, 0)],
    spells: ['A', 'C#', 'E'],
    stage: 2,
    difficulty: 3,
  },
  {
    id: 'G',
    name: 'G major',
    strings: [at(6, 3, 2), at(5, 2, 1), at(4, 0, 0), at(3, 0, 0), at(2, 0, 0), at(1, 3, 4)],
    spells: ['G', 'B', 'D'],
    stage: 2,
    difficulty: 3,
  },
  {
    id: 'C',
    name: 'C major',
    strings: [at(6, 'x', 0), at(5, 3, 3), at(4, 2, 2), at(3, 0, 0), at(2, 1, 1), at(1, 0, 0)],
    spells: ['C', 'E', 'G'],
    stage: 2,
    difficulty: 3,
  },
];

export const chordById = (id: string): ChordShape | undefined => CHORDS.find((c) => c.id === id);

/** The strings the checker actually asks for, low to high, skipping 'x'. */
export const soundingStrings = (chord: ChordShape): ChordString[] =>
  chord.strings.filter((s) => s.fret !== 'x');
