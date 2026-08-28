/**
 * The Tuner's run state (§6.1).
 *
 * Kept out of the component because it is the Stage 0 exit check — "all six
 * strings inside ±5 cents in under 2:00" — and an exit check the app measures
 * has to be assertable. tests/tunerRun.test.ts drives it frame by frame.
 */

import { STANDARD_TUNING, accuracy, nearestString } from '../audio/notes';

/** Green has to hold this long before a string counts as done (§6.1). */
export const HOLD_MS = 1500;
/** Stage 0 exit check: all six inside two minutes. */
export const STAGE0_LIMIT_MS = 120_000;
/** A frame gap longer than this is a stall, not elapsed playing time. */
const MAX_STEP_MS = 100;

export type TunerFrame = {
  /** Monotonic milliseconds. */
  nowMs: number;
  settled: boolean;
  frequency: number | null;
};

export type TunerView = {
  /** By index into STANDARD_TUNING: 0 is the low E, 5 the high E. */
  done: readonly boolean[];
  /** The string currently being heard, or the last one heard. */
  activeIndex: number | null;
  /** Cents off the active string's target, or null when nothing is settled. */
  cents: number | null;
  frequency: number | null;
  settled: boolean;
  /** 0..1 — how far through the 1.5 s green hold. */
  holdProgress: number;
  elapsedMs: number;
  /** Set once all six are done. */
  finishedMs: number | null;
  passed: boolean;
};

export class TunerRun {
  #done = STANDARD_TUNING.map(() => false);
  #activeIndex: number | null = null;
  #cents: number | null = null;
  #frequency: number | null = null;
  #settled = false;
  #holdMs = 0;
  #holdIndex: number | null = null;
  #startedMs: number | null = null;
  #lastMs: number | null = null;
  #elapsedMs = 0;
  #finishedMs: number | null = null;

  start(nowMs: number) {
    this.#done = STANDARD_TUNING.map(() => false);
    this.#activeIndex = null;
    this.#cents = null;
    this.#frequency = null;
    this.#settled = false;
    this.#holdMs = 0;
    this.#holdIndex = null;
    this.#startedMs = nowMs;
    this.#lastMs = nowMs;
    this.#elapsedMs = 0;
    this.#finishedMs = null;
  }

  step(f: TunerFrame): TunerView {
    if (this.#startedMs === null) this.start(f.nowMs);

    const dt = Math.min(MAX_STEP_MS, Math.max(0, f.nowMs - (this.#lastMs ?? f.nowMs)));
    this.#lastMs = f.nowMs;
    if (this.#finishedMs === null) this.#elapsedMs = f.nowMs - this.#startedMs!;

    this.#settled = f.settled;

    if (f.settled && f.frequency !== null) {
      const near = nearestString(f.frequency);
      const index = STANDARD_TUNING.indexOf(near.string);
      this.#activeIndex = index;
      this.#cents = near.cents;
      this.#frequency = f.frequency;

      if (accuracy(near.cents) === 'in-tune') {
        // Moving to a different string starts its hold from zero.
        this.#holdMs = this.#holdIndex === index ? this.#holdMs + dt : dt;
        this.#holdIndex = index;
      } else {
        this.#holdMs = 0;
        this.#holdIndex = index;
      }
    } else {
      // Silence, or a note too unstable to trust. Either way the hold breaks:
      // a string is only done if it was held green, not nearly held green.
      this.#cents = null;
      this.#frequency = null;
      this.#holdMs = 0;
    }

    if (this.#holdMs >= HOLD_MS && this.#holdIndex !== null && !this.#done[this.#holdIndex]) {
      this.#done[this.#holdIndex] = true;
      if (this.#done.every(Boolean) && this.#finishedMs === null) {
        this.#finishedMs = this.#elapsedMs;
      }
    }

    return this.view();
  }

  view(): TunerView {
    return {
      done: this.#done,
      activeIndex: this.#activeIndex,
      cents: this.#cents,
      frequency: this.#frequency,
      settled: this.#settled,
      holdProgress: Math.min(1, this.#holdMs / HOLD_MS),
      elapsedMs: this.#elapsedMs,
      finishedMs: this.#finishedMs,
      passed: this.#finishedMs !== null && this.#finishedMs <= STAGE0_LIMIT_MS,
    };
  }
}

/** mm:ss for the on-screen clock. Every numeral in the app is monospaced. */
export function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
