/**
 * The arpeggio verifier's state machine (§4.1).
 *
 * Only one string sounds at a time, which makes this the reliable, monophonic
 * case — and the only source of truth for diagnosis (§4). Kept out of the
 * component because its verdicts are the flagship feature's whole output, and a
 * wrong verdict here is a confident, specific, wrong statement about somebody's
 * hand. tests/chordCheck.test drives it frame by frame.
 *
 * ── Calibration ───────────────────────────────────────────────────────────
 * Every threshold this file judges by is a named constant below and is used
 * nowhere else. None has met a real guitar yet: they are reasoned from §4.1 and
 * from the numbers Phase 1 measured. Recalibrating after a session with a real
 * instrument should be editing this block, never rewriting the logic.
 */

import { centsOff, midiFromFreq, noteName } from '../audio/notes';
import type { Pitch, Settled } from '../audio/yin';
import { soundingStrings, type ChordShape, type ChordString } from '../content/chords';
import { diagnose, summarise, type Verdict } from '../content/diagnosis';

/** How long we listen after a string starts sounding, before judging it. */
export const ATTACK_WINDOW_MS = 450;
/**
 * How far off pitch a string may be and still count as the right note. Half a
 * semitone is the distance to the next note, so anything inside it is a tuning
 * problem rather than a wrong finger — and saying "wrong fret" to someone whose
 * guitar has merely drifted is exactly the confidently wrong answer §4.2 warns
 * about.
 */
export const MATCH_CENTS = 50;
/**
 * Periodicity below this is not a note at all — it is the thud of a finger
 * lying across the string. Above it, there is a string vibrating and the
 * problem is pressure or position. This is the line between "dead" and "buzz",
 * and so between two completely different pieces of advice.
 */
export const BUZZ_CONFIDENCE = 0.45;
/** §4.1: a note that collapses this fast was never properly fretted. */
export const FAST_DECAY_MS = 200;
/** How far a note must fall, relative to its peak, to count as collapsed. */
export const DECAY_RATIO = 0.25;
/** Silence required before the checker will accept the next string. */
export const REARM_MS = 250;

export type CheckFrame = {
  nowMs: number;
  rms: number;
  /** The adaptive gate for the current room — see yin.ts gateFor. */
  gate: number;
  settled: Settled;
  /** YIN before the confidence floor, which is what separates dead from buzz. */
  raw: Pitch | null;
};

export type StringResult = {
  string: ChordString['string'];
  verdict: Verdict;
  expectedMidi: number;
  heardMidi: number | null;
  cents: number | null;
  diagnosis: string;
};

export type CheckView = {
  chord: ChordShape;
  /** Which sounding string the checker is waiting for. */
  index: number;
  target: ChordString | null;
  phase: 'waiting' | 'listening' | 'ringing' | 'done';
  results: StringResult[];
  /** 0..1 through the current attack window. */
  listenProgress: number;
  complete: boolean;
  summary: { text: string; clean: boolean };
};

const nameOf = (midi: number) => {
  const n = noteName(440 * Math.pow(2, (midi - 69) / 12));
  return `${n.name}${n.octave}`;
};

export class ChordCheckRun {
  readonly chord: ChordShape;
  #order: ChordString[];
  #index = 0;
  #results: StringResult[] = [];

  #phase: CheckView['phase'] = 'waiting';
  #attackStart = 0;
  #peak = 0;
  #collapsedAt: number | null = null;
  #bestSettled: Pitch | null = null;
  #maxRawConfidence = 0;
  /**
   * Whether the next sound counts as a fresh pluck. False while the previous
   * string is still ringing: a decaying note is not the next string, and
   * counting it as one would judge string 5 against string 6's sound.
   */
  #armed = true;
  #quietSince: number | null = null;
  #lastNow = 0;

  constructor(chord: ChordShape) {
    this.chord = chord;
    this.#order = soundingStrings(chord);
  }

  start(nowMs: number) {
    this.#index = 0;
    this.#results = [];
    this.#phase = 'waiting';
    this.#armed = true;
    this.#quietSince = null;
    this.#lastNow = nowMs;
    this.#resetAttack();
  }

  /** Drop the last verdict and listen for that string again. */
  redoLast() {
    if (this.#results.length === 0) return;
    this.#results = this.#results.slice(0, -1);
    this.#index = Math.max(0, this.#index - 1);
    this.#phase = 'waiting';
    this.#armed = true;
    this.#quietSince = null;
    this.#resetAttack();
  }

  step(f: CheckFrame): CheckView {
    this.#lastNow = f.nowMs;
    const target = this.#order[this.#index];
    if (!target) {
      this.#phase = 'done';
      return this.view();
    }

    const sounding = f.rms >= f.gate;

    if (this.#phase === 'listening') {
      if (f.rms > this.#peak) this.#peak = f.rms;
      if (this.#collapsedAt === null && this.#peak > 0 && f.rms < this.#peak * DECAY_RATIO) {
        this.#collapsedAt = f.nowMs;
      }
      if (f.settled.settled && f.settled.frequency !== null) {
        this.#bestSettled = {
          frequency: f.settled.frequency,
          confidence: f.settled.confidence ?? 1,
        };
      }
      if (f.raw && f.raw.confidence > this.#maxRawConfidence) {
        this.#maxRawConfidence = f.raw.confidence;
      }

      if (f.nowMs - this.#attackStart >= ATTACK_WINDOW_MS) {
        this.#results.push(this.#judge(target));
        this.#index++;
        this.#armed = false;
        this.#quietSince = null;
        this.#phase = this.#index >= this.#order.length ? 'done' : 'ringing';
        this.#resetAttack();
      }
      return this.view();
    }

    // Not listening. Either the previous string is still sounding, or we are
    // armed and waiting for this one.
    if (!this.#armed) {
      if (sounding) {
        this.#quietSince = null;
        this.#phase = 'ringing';
      } else {
        this.#quietSince ??= f.nowMs;
        if (f.nowMs - this.#quietSince >= REARM_MS) {
          this.#armed = true;
          this.#phase = 'waiting';
        } else {
          this.#phase = 'ringing';
        }
      }
      return this.view();
    }

    if (sounding) {
      this.#phase = 'listening';
      this.#attackStart = f.nowMs;
      this.#peak = f.rms;
      this.#collapsedAt = null;
      this.#bestSettled = null;
      this.#maxRawConfidence = 0;
    } else {
      this.#phase = 'waiting';
    }
    return this.view();
  }

  #resetAttack() {
    this.#peak = 0;
    this.#collapsedAt = null;
    this.#bestSettled = null;
    this.#maxRawConfidence = 0;
  }

  #judge(target: ChordString): StringResult {
    const expected = nameOf(target.midi);
    const collapsed =
      this.#collapsedAt !== null && this.#collapsedAt - this.#attackStart < FAST_DECAY_MS;

    let verdict: Verdict;
    let heardMidi: number | null = null;
    let cents: number | null = null;

    if (this.#bestSettled) {
      heardMidi = Math.round(midiFromFreq(this.#bestSettled.frequency));
      const target440 = 440 * Math.pow(2, (target.midi - 69) / 12);
      cents = centsOff(this.#bestSettled.frequency, target440);

      if (Math.abs(cents) > MATCH_CENTS) verdict = 'wrong';
      else if (collapsed) verdict = 'buzz';
      else verdict = 'correct';
    } else if (this.#maxRawConfidence >= BUZZ_CONFIDENCE) {
      // Something is vibrating at a period — it just never held still enough
      // to trust. That is a fretting-pressure problem, not a muted string.
      verdict = 'buzz';
    } else {
      verdict = 'dead';
    }

    return {
      string: target.string,
      verdict,
      expectedMidi: target.midi,
      heardMidi,
      cents,
      diagnosis: diagnose(
        verdict,
        target.string,
        heardMidi === null ? null : nameOf(heardMidi),
        expected,
      ),
    };
  }

  view(): CheckView {
    const target = this.#order[this.#index] ?? null;
    const complete = this.#results.length === this.#order.length;
    return {
      chord: this.chord,
      index: this.#index,
      target,
      phase: complete ? 'done' : this.#phase,
      results: this.#results,
      listenProgress:
        this.#phase === 'listening'
          ? Math.min(1, Math.max(0, (this.#lastNow - this.#attackStart) / ATTACK_WINDOW_MS))
          : 0,
      complete,
      summary: summarise(
        this.#results.map((r) => r.verdict),
        this.chord,
      ),
    };
  }
}
