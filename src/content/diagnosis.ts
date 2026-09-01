/**
 * The diagnosis text (§4.1).
 *
 * This is where the teaching happens. "String 4 is muted" is a measurement;
 * "check nothing from a higher finger is leaning on it" is the thing that
 * actually fixes the chord. Each line maps a failure to a physical cause drawn
 * from the curriculum's known failure modes, and each is specific enough to act
 * on without a teacher in the room.
 */

import type { ChordShape, StringNumber } from './chords';

export type Verdict = 'correct' | 'wrong' | 'dead' | 'buzz';

/** Why a particular string tends to go dead, by string. */
const DEAD: Record<StringNumber, string> = {
  6: 'String 6 is muted. Your thumb has crept over the top of the neck and is resting on it — bring it back down behind the middle of the neck.',
  5: 'String 5 is muted. The finger above it is leaning back. Stand it up on its tip.',
  4: 'String 4 is muted. Check nothing from a higher finger is leaning on it.',
  3: 'String 3 is muted. Either the finger on it is not pressing hard enough, or the one below it has flattened across.',
  2: 'String 2 is muted. This is almost always the finger on string 3 lying flat. Arch it.',
  1: 'String 1 is muted. The finger on string 2 is lying flat. Arch it and press with the very tip.',
};

const BUZZ =
  'Buzzing. The finger is too far behind the fret, or not pressing hard enough. Slide it forward until it almost touches the fret wire.';

const ALL_DEAD =
  'Everything is muted. Your thumb has crept over the top of the neck — bring it back down behind the middle, and let your fingers curl.';

export function diagnose(
  verdict: Verdict,
  string: StringNumber,
  heard: string | null,
  expected: string,
): string {
  switch (verdict) {
    case 'correct':
      return `${expected}, ringing clean.`;
    case 'dead':
      return DEAD[string];
    case 'buzz':
      return BUZZ;
    case 'wrong':
      return heard === null
        ? `That is not ${expected}. Check the fret number against the diagram.`
        : `That was ${heard}, not ${expected}. Your finger is on the wrong fret or the wrong string.`;
  }
}

/**
 * The whole-hand read, when the per-string lines would all say the same thing.
 * Six separate "this string is muted" messages is worse advice than one
 * sentence about the thumb.
 */
export function summarise(
  verdicts: Verdict[],
  chord: ChordShape,
): { text: string; clean: boolean } {
  const total = verdicts.length;
  const dead = verdicts.filter((v) => v === 'dead').length;
  const buzz = verdicts.filter((v) => v === 'buzz').length;
  const wrong = verdicts.filter((v) => v === 'wrong').length;

  if (dead === total && total > 0) return { text: ALL_DEAD, clean: false };
  if (dead + buzz + wrong === 0) return { text: `${chord.name}, every string ringing.`, clean: true };
  if (wrong > 0 && dead + buzz === 0) {
    return { text: 'The shape is not quite the one on the diagram. Check the fret numbers.', clean: false };
  }
  if (buzz > dead) {
    return { text: 'Mostly a pressure problem — get the fingers closer to the frets.', clean: false };
  }
  return { text: 'Some strings are not sounding. Arch the fingers and press with the tips.', clean: false };
}
