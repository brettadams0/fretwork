/**
 * Synthesised test signals (§10.1).
 *
 * Neither of us can hear the output, so every DSP claim has to be provable
 * against a signal whose true f0 we know exactly. A plucked string is well
 * modelled as a harmonic series under an exponential decay.
 */

/** Deterministic PRNG so the noise fixture can never flake between runs. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A harmonic series with explicit per-harmonic amplitudes, so a fixture can
 * deliberately make harmonic 2 louder than the fundamental.
 * `amps[0]` is harmonic 1.
 */
export function synthHarmonics(
  f0: number,
  amps: readonly number[],
  sr = 48000,
  dur = 0.5,
  decay = 3,
): Float32Array {
  const n = Math.floor(sr * dur);
  const out = new Float32Array(n);
  for (let h = 1; h <= amps.length; h++) {
    const amp = amps[h - 1] ?? 0;
    if (amp === 0) continue;
    const w = (2 * Math.PI * f0 * h) / sr;
    for (let i = 0; i < n; i++) {
      out[i] = out[i]! + amp * Math.sin(w * i) * Math.exp((-decay * i) / sr);
    }
  }
  return out;
}

/** §10.1's plucked string: 1/h² rolloff over `harmonics` partials. */
export function synthString(f0: number, sr = 48000, dur = 0.5, harmonics = 8): Float32Array {
  const amps = Array.from({ length: harmonics }, (_, i) => 1 / ((i + 1) * (i + 1)));
  return synthHarmonics(f0, amps, sr, dur);
}

/**
 * Additive white noise at a given signal-to-noise ratio, in dB.
 *
 * `ref` names the window the ratio is measured against. It matters: the signal
 * decays exponentially, so "20 dB SNR" over a whole 0.5 s pluck is a different
 * amount of noise from 20 dB at the frame actually under analysis. Pass the
 * analysis window and the claim in the test name is true of what was measured.
 */
export function addNoise(
  buf: Float32Array,
  snrDb: number,
  seed = 1,
  ref?: { offset: number; length: number },
): Float32Array {
  const rand = mulberry32(seed);
  const from = ref?.offset ?? 0;
  const to = Math.min(buf.length, from + (ref?.length ?? buf.length));
  let power = 0;
  for (let i = from; i < to; i++) power += buf[i]! * buf[i]!;
  power /= Math.max(1, to - from);

  const noisePower = power / Math.pow(10, snrDb / 10);
  const sigma = Math.sqrt(noisePower);

  const out = new Float32Array(buf.length);
  for (let i = 0; i < buf.length; i++) {
    // Box-Muller, one draw per sample.
    const u1 = Math.max(rand(), 1e-12);
    const u2 = rand();
    const gauss = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    out[i] = buf[i]! + sigma * gauss;
  }
  return out;
}

/** A 2048-sample analysis frame taken `offset` samples into a signal. */
export function frameAt(buf: Float32Array, offset: number, length = 2048): Float32Array {
  return buf.slice(offset, offset + length);
}
