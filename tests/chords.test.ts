import { describe, it, expect } from 'vitest';
import { CHORDS, OPEN_MIDI, soundingStrings, chordById } from '../src/content/chords';
import { noteName, freqFromMidi } from '../src/audio/notes';

const pitchClass = (midi: number) => noteName(freqFromMidi(midi)).name;

describe('Chord shapes (§4.3)', () => {
  it('ships Stage 2 in full', () => {
    expect(CHORDS.map((c) => c.id)).toEqual(['Em', 'Am', 'D', 'E', 'A', 'G', 'C']);
    for (const c of CHORDS) expect(c.stage).toBe(2);
  });

  it('gives every shape all six strings, exactly once each', () => {
    for (const c of CHORDS) {
      const numbers = c.strings.map((s) => s.string);
      expect(numbers, c.id).toEqual([6, 5, 4, 3, 2, 1]);
    }
  });

  it('derives every pitch from the open string plus the fret', () => {
    for (const c of CHORDS) {
      for (const s of c.strings) {
        if (s.fret === 'x') {
          expect(s.midi, `${c.id} string ${s.string}`).toBe(-1);
        } else {
          expect(s.midi, `${c.id} string ${s.string}`).toBe(OPEN_MIDI[s.string] + s.fret);
        }
      }
    }
  });

  /* The assertion that catches a mis-transcribed shape. A wrong fret produces a
     chord that does not spell what it claims, and the checker would then tell
     the user their correctly fretted string was wrong. */
  it('spells the chord it claims to, and nothing else', () => {
    for (const c of CHORDS) {
      const heard = new Set(soundingStrings(c).map((s) => pitchClass(s.midi)));
      const claimed = new Set(c.spells);
      expect([...heard].sort(), `${c.id} sounds notes outside ${c.spells.join(' ')}`).toEqual(
        [...claimed].sort(),
      );
    }
  });

  it('sounds its root somewhere, and puts it on the lowest string played', () => {
    // Every Stage 2 shape is in root position — that is what makes them the
    // first shapes taught, and the Power Blitz drill later depends on it.
    for (const c of CHORDS) {
      const lowest = soundingStrings(c)[0]!;
      expect(pitchClass(lowest.midi), `${c.id} is not in root position`).toBe(c.spells[0]);
    }
  });

  it('marks muted strings as unplayed and keeps them out of the arpeggio', () => {
    const am = chordById('Am')!;
    expect(am.strings[0]!.fret).toBe('x');
    expect(soundingStrings(am).map((s) => s.string)).toEqual([5, 4, 3, 2, 1]);
    expect(soundingStrings(chordById('D')!).map((s) => s.string)).toEqual([4, 3, 2, 1]);
    expect(soundingStrings(chordById('Em')!)).toHaveLength(6);
  });

  it('never asks a finger to hold two frets at once', () => {
    for (const c of CHORDS) {
      const byFinger = new Map<number, Set<number>>();
      for (const s of c.strings) {
        if (s.fret === 'x' || s.finger === 0) continue;
        const frets = byFinger.get(s.finger) ?? new Set();
        frets.add(s.fret);
        byFinger.set(s.finger, frets);
      }
      for (const [finger, frets] of byFinger) {
        expect(frets.size, `${c.id} finger ${finger} is on ${[...frets].join(' and ')}`).toBe(1);
      }
    }
  });

  it('uses a finger for every fretted note and none for open strings', () => {
    for (const c of CHORDS) {
      for (const s of c.strings) {
        if (s.fret === 'x') continue;
        if (s.fret === 0) expect(s.finger, `${c.id} string ${s.string}`).toBe(0);
        else expect(s.finger, `${c.id} string ${s.string}`).toBeGreaterThan(0);
      }
    }
  });
});
