/**
 * Capture (§2, §2.1).
 *
 * An AudioWorkletProcessor and never a ScriptProcessorNode: ScriptProcessor
 * runs on the main thread, so a React re-render stalls capture and the rhythm
 * game desyncs. This runs on the audio thread at fixed 128-sample quanta.
 *
 * It does one job — accumulate quanta into 512-sample hops and post them —
 * because everything on this thread is a chance to glitch the audio callback.
 * The main thread assembles the overlapping 2048-sample analysis frames from
 * the hop stream. Posting hops rather than whole frames also means each sample
 * crosses the thread boundary once instead of four times.
 *
 * This file must stay self-contained: an AudioWorklet module cannot import.
 */

const HOP = 512;

class CaptureProcessor extends AudioWorkletProcessor {
  #hop = new Float32Array(HOP);
  #filled = 0;

  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0];
    // No input yet, or a disconnected source. Stay alive and wait for one.
    if (!channel || channel.length === 0) return true;

    for (let i = 0; i < channel.length; i++) {
      this.#hop[this.#filled++] = channel[i]!;
      if (this.#filled === HOP) {
        // Transfer rather than copy: 93.75 of these cross per second.
        const out = new Float32Array(this.#hop);
        this.port.postMessage(out, [out.buffer]);
        this.#filled = 0;
      }
    }
    return true;
  }
}

registerProcessor('capture', CaptureProcessor);
