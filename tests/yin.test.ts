import { describe, it, expect } from 'vitest';
import { yin, rms, detectPitch, PitchTracker, RMS_GATE } from '../src/audio/yin';
import { centsOff, freqFromMidi, STANDARD_TUNING } from '../src/audio/notes';
import { synthString, synthHarmonics, addNoise, frameAt } from './fixtures/synth';

const SR = 48000;
const FRAME = 2048;
// 0.1 s in: past any onset, still well inside the decay.
const OFFSET = 4800;

function analyse(signal: Float32Array) {
  return yin(frameAt(signal, OFFSET, FRAME), SR);
}

describe('YIN (§3.2)', () => {
  it('returns each open-string frequency within ±2 cents', () => {
    for (const s of STANDARD_TUNING) {
      const got = analyse(synthString(s.frequency, SR));
      expect(got, `${s.label} produced no result`).not.toBeNull();
      const err = centsOff(got!.frequency, s.frequency);
      expect(Math.abs(err), `${s.label} was ${err.toFixed(2)} cents out`).toBeLessThan(2);
      expect(got!.confidence).toBeGreaterThan(0.85);
    }
  });

  /* §10.1 calls this the single most important test in the suite. On a plucked
     string the second harmonic is frequently louder than the fundamental, and
     FFT peak-picking and raw autocorrelation both report an octave too high.
     This fixture makes harmonic 2 four times the power of harmonic 1. */
  it('does not octave-error when harmonic 2 is louder than harmonic 1', () => {
    for (const s of STANDARD_TUNING) {
      const boosted = synthHarmonics(s.frequency, [0.5, 1.0, 0.4, 0.25, 0.1, 0.05], SR);
      const got = analyse(boosted);
      expect(got, `${s.label} produced no result`).not.toBeNull();

      const err = centsOff(got!.frequency, s.frequency);
      expect(
        Math.abs(err),
        `${s.label} reported ${got!.frequency.toFixed(2)} Hz against a true ` +
          `${s.frequency.toFixed(2)} Hz — ${(err / 100).toFixed(2)} semitones out`,
      ).toBeLessThan(2);
    }
  });

  it('does not octave-error on a missing fundamental either', () => {
    // Harmonic 1 removed entirely: the ear still hears the fundamental, and so
    // should the detector, because the period is unchanged.
    const got = analyse(synthHarmonics(82.41, [0, 1.0, 0.5, 0.3, 0.15], SR));
    expect(got).not.toBeNull();
    expect(Math.abs(centsOff(got!.frequency, 82.41))).toBeLessThan(5);
  });

  /* §10.1's noise requirement. Detection holding is the assertion the spec
     asks for; the cents budget below is the measured truth, and the low E is
     genuinely worse than the rest. YIN integrates its difference function over
     buf.length / 2 = 1024 samples, which is only 1.76 periods of an 82 Hz E, so
     noise biases the minimum. The bias is systematic, so the stability filter
     cannot average it away — measured at 6.3 cents mean, 13.2 worst, through
     the full pipeline at a constant 20 dB SNR.

     Phase 2 owns the fix. Integrating each tau over every available sample
     (N - tau, mean-normalised) measures 5.2 cents mean on the same fixture and
     0.10 rather than 0.62 cents on a clean E2, at 1.66x the cost. That trade is
     a Phase 2 decision made against a device number, not a guess made here. */
  it('holds detection with white noise added at 20 dB SNR', () => {
    const ref = { offset: OFFSET, length: FRAME };
    const budget: Record<string, number> = { E2: 15 };
    for (const s of STANDARD_TUNING) {
      const noisy = addNoise(synthString(s.frequency, SR), 20, s.string, ref);
      const got = analyse(noisy);
      expect(got, `${s.label} produced no result at 20 dB SNR`).not.toBeNull();
      expect(got!.confidence).toBeGreaterThan(0.85);

      const err = centsOff(got!.frequency, s.frequency);
      // Whatever else noise does, it must never move the answer by an octave.
      expect(Math.abs(err), `${s.label} octave-errored under noise`).toBeLessThan(50);

      const limit = budget[s.label] ?? 5;
      expect(
        Math.abs(err),
        `${s.label} was ${err.toFixed(2)} cents out at 20 dB SNR, budget ${limit}`,
      ).toBeLessThan(limit);
    }
  });

  /* A dying note is a falling SNR, and a detector that keeps answering
     confidently into the noise floor is how a tuner tells you a settled string
     is 60 cents sharp. The RMS gate is what has to stop that, so assert the
     gate does close rather than assuming it. */
  it('goes quiet rather than guessing as a note decays into noise', () => {
    const signal = synthString(82.41, SR, 2.0);
    const noisy = addNoise(signal, 20, 6, { offset: OFFSET, length: FRAME });
    const late = frameAt(noisy, SR * 1.5, FRAME); // 1.5 s in, ~35 dB of decay
    expect(detectPitch(late, SR)).toBeNull();
  });

  it('does not claim a confident pitch for a buffer with no periodicity', () => {
    // A loud buffer of pure noise: the gate will not stop it, so YIN's own
    // confidence has to be the thing that refuses it.
    const buf = addNoise(synthString(110, SR), -20, 7);
    const got = yin(frameAt(buf, OFFSET, FRAME), SR);
    if (got) expect(got.confidence).toBeLessThan(0.85);
    expect(detectPitch(frameAt(buf, OFFSET, FRAME), SR)).toBeNull();
  });
});

describe('detectPitch — gate and validation (§3.2)', () => {
  it('gates on RMS below 0.008', () => {
    const quiet = synthString(110, SR).map((v) => v * 0.001) as Float32Array;
    const frame = frameAt(quiet, OFFSET, FRAME);
    expect(rms(frame)).toBeLessThan(RMS_GATE);
    expect(detectPitch(frame, SR)).toBeNull();
  });

  it('passes a signal that clears the gate', () => {
    const frame = frameAt(synthString(146.83, SR), OFFSET, FRAME);
    expect(rms(frame)).toBeGreaterThan(RMS_GATE);
    const got = detectPitch(frame, SR);
    expect(got).not.toBeNull();
    expect(Math.abs(centsOff(got!.frequency, 146.83))).toBeLessThan(2);
  });

  it('rejects pitches outside 70–1400 Hz', () => {
    const tooLow = frameAt(synthString(55, SR), OFFSET, FRAME); // A1
    expect(detectPitch(tooLow, SR)).toBeNull();

    const tooHigh = frameAt(synthString(1600, SR), OFFSET, FRAME);
    expect(detectPitch(tooHigh, SR)).toBeNull();
  });

  it('accepts the extremes of the band it claims', () => {
    for (const f of [82.41, freqFromMidi(88)]) {
      const got = detectPitch(frameAt(synthString(f, SR), OFFSET, FRAME), SR);
      expect(got, `${f.toFixed(1)} Hz was rejected`).not.toBeNull();
    }
  });
});

describe('PitchTracker — the 5-frame stability filter (§3.2)', () => {
  const push = (t: PitchTracker, freqs: Array<number | null>) => {
    let last = t.push(null);
    for (const f of freqs) last = t.push(f === null ? null : { frequency: f, confidence: 0.95 });
    return last;
  };

  it('does not settle before five frames', () => {
    const t = new PitchTracker();
    for (const f of [110, 110, 110]) {
      expect(t.push({ frequency: f, confidence: 0.95 }).settled).toBe(false);
    }
    t.push({ frequency: 110, confidence: 0.95 });
    expect(t.push({ frequency: 110, confidence: 0.95 }).settled).toBe(true);
  });

  it('settles when 4 of the last 5 agree within 30 cents', () => {
    const t = new PitchTracker();
    // One frame is a whole octave out; the other four agree.
    const out = push(t, [110, 110.2, 220, 109.9, 110.1]);
    expect(out.settled).toBe(true);
    expect(Math.abs(centsOff(out.frequency!, 110))).toBeLessThan(5);
  });

  it('does not settle when only 3 of 5 agree', () => {
    const t = new PitchTracker();
    expect(push(t, [110, 110.1, 220, 221, 110.2]).settled).toBe(false);
  });

  it('does not settle when frames drop out', () => {
    const t = new PitchTracker();
    expect(push(t, [110, 110, null, null, 110]).settled).toBe(false);
  });

  it('goes unsettled within two frames of the note stopping', () => {
    const t = new PitchTracker();
    expect(push(t, [110, 110, 110, 110, 110]).settled).toBe(true);
    expect(t.push(null).settled).toBe(true); // 4 of 5 still agree
    expect(t.push(null).settled).toBe(false); // only 3 left
  });

  it('reports a frequency inside the spread it settled on', () => {
    const t = new PitchTracker();
    const out = push(t, [109.8, 110.0, 110.1, 109.9, 110.05]);
    expect(out.settled).toBe(true);
    expect(out.frequency!).toBeGreaterThan(109.8);
    expect(out.frequency!).toBeLessThan(110.1);
  });
});
