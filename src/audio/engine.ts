/**
 * Mic capture, AudioContext lifecycle, permission (§2, §3.1).
 *
 * The whole Phase 1 claim — "the audio chain works on Android" — is this file.
 * Three things here are not negotiable:
 *
 *  1. getUserMedia asks for echoCancellation, noiseSuppression and
 *     autoGainControl off, and then VERIFIES with getSettings(), because
 *     Android sometimes ignores the request. Noise suppression treats a
 *     sustained harmonic tone as noise; AGC pumps the envelope and breaks
 *     onset detection. If they are still on we say so in one line rather than
 *     failing, and never proceed silently.
 *  2. AudioWorklet, never ScriptProcessorNode (§2.1).
 *  3. The AudioContext is created and resumed inside the user gesture.
 */

import workletUrl from './worklet/capture.worklet.ts?worker&url';
import {
  createHighPass,
  createNoiseFloor,
  detectPitch,
  gateFor,
  rms,
  PitchTracker,
  type Pitch,
  type Settled,
} from './yin';

/** §2: 2048-sample frames on a 512-sample hop, so windows overlap 75%. */
export const FRAME_SAMPLES = 2048;
export const HOP_SAMPLES = 512;
export const TARGET_SAMPLE_RATE = 48000;

/**
 * How many hops pass between YIN runs. 1 is every frame, as §2's pipeline
 * specifies, and the measurements say we can afford it.
 *
 * YIN is O(W · maxTau) — about 700k inner iterations per frame — and costs
 * 1.04 ms on a desktop core, 1.10 ms measured in a browser. At 93.75 frames a
 * second that is 103 ms of work per second of audio: a tenth of one core, so
 * perhaps a fifth to a quarter on an S20 FE. There is no reason to skip frames,
 * and skipping them would slow the stability filter from 53 ms to 213 ms.
 *
 * The knob stays because the device is the authority, not this comment: the
 * debug overlay reports the real cost and the real detection rate, and if the
 * phone cannot hold 93.75 this becomes a 2 with no other change.
 */
export const DETECT_EVERY_HOPS = 1;

export type MicProcessing = {
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
};

export type MicReport = {
  /** What the AudioContext actually runs at, which may not be 48 kHz. */
  sampleRate: number;
  requestedSampleRate: number;
  channelCount?: number;
  processing: MicProcessing;
  /** Every processor the browser confirmed as off. */
  clean: boolean;
  /** The ones still on, by name, for the banner. */
  stillOn: string[];
  /** The browser reported nothing, so we cannot claim either way. */
  unverified: boolean;
  deviceLabel: string;
  baseLatencySec: number;
};

export type AnalysisFrame = {
  /** AudioContext.currentTime when this hop was handled. */
  time: number;
  /** Level of the current 2048-sample frame, post high-pass. */
  rms: number;
  /** A rolling estimate of the room, for the §12.4 honesty about noise. */
  noiseFloor: number;
  /** The gate this frame was judged against — the room plus headroom. */
  gate: number;
  /** This frame's validated pitch, or null. Only set on detection frames. */
  pitch: Pitch | null;
  /** The most recent raw reading, held so the debug overlay is never blank. */
  lastPitch: Pitch | null;
  /** The 5-frame stability filter's verdict. */
  settled: Settled;
  /** Whether YIN ran on this frame. */
  analysed: boolean;
  /** Milliseconds YIN took, when it ran. The device's own answer on cost. */
  detectMs: number;
  /** Hops delivered per second, measured. Should sit near 93.75. */
  hopRate: number;
  /**
   * Frames per second YIN actually ran on. Zero while the gate is closed, which
   * is the point: a rate counted before the gate reports full throughput while
   * doing no work at all, and then proves nothing about CPU headroom.
   */
  detectRate: number;
};

export type MicErrorKind =
  | 'insecure-context'
  | 'unsupported'
  | 'permission-denied'
  | 'no-device'
  | 'device-busy'
  | 'failed';

export class MicError extends Error {
  readonly kind: MicErrorKind;
  constructor(kind: MicErrorKind, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'MicError';
    this.kind = kind;
  }
}

const MESSAGES: Record<MicErrorKind, string> = {
  'insecure-context':
    'The microphone needs HTTPS. Open the installed app, or an https:// address.',
  unsupported: 'This browser has no AudioWorklet. Fretwork needs Chrome or a recent browser.',
  'permission-denied':
    'Microphone permission was refused. Allow it in the address bar, or in site settings.',
  'no-device': 'No microphone was found.',
  'device-busy': 'Another app is holding the microphone. Close it and try again.',
  failed: 'The microphone could not be opened.',
};

function classify(err: unknown): MicError {
  const name = err instanceof Error ? err.name : '';
  const kind: MicErrorKind =
    name === 'NotAllowedError' || name === 'SecurityError'
      ? 'permission-denied'
      : name === 'NotFoundError' || name === 'OverconstrainedError'
        ? 'no-device'
        : name === 'NotReadableError'
          ? 'device-busy'
          : 'failed';
  return new MicError(kind, MESSAGES[kind], { cause: err });
}

export type FrameListener = (frame: AnalysisFrame) => void;

export class AudioEngine {
  readonly ctx: AudioContext;
  readonly report: MicReport;

  #stream: MediaStream;
  #source: MediaStreamAudioSourceNode;
  #node: AudioWorkletNode;
  #sink: GainNode;

  #listeners = new Set<FrameListener>();
  #ring = new Float32Array(FRAME_SAMPLES);
  #frame = new Float32Array(FRAME_SAMPLES);
  #highPass: (block: Float32Array) => Float32Array;
  #tracker = new PitchTracker();

  #hops = 0;
  #settledState: Settled = { settled: false, frequency: null, confidence: null };
  #lastPitch: Pitch | null = null;
  #detectMs = 0;

  // Rolling rate measurement, so the overlay reports what happened rather than
  // what was intended.
  #rateWindowStart = 0;
  #hopsInWindow = 0;
  #detectsInWindow = 0;
  #hopRate = 0;
  #detectRate = 0;

  // The room. See createNoiseFloor — the gate is derived from this, so an
  // estimator that measured the note instead would shut the gate on the note.
  #noiseFloorOf: (level: number) => number;
  #noiseFloor = 0;

  #stopped = false;

  private constructor(
    ctx: AudioContext,
    stream: MediaStream,
    source: MediaStreamAudioSourceNode,
    node: AudioWorkletNode,
    sink: GainNode,
    report: MicReport,
  ) {
    this.ctx = ctx;
    this.report = report;
    this.#stream = stream;
    this.#source = source;
    this.#node = node;
    this.#sink = sink;
    this.#highPass = createHighPass(ctx.sampleRate);
    this.#noiseFloorOf = createNoiseFloor(Math.round(ctx.sampleRate / HOP_SAMPLES));
    this.#rateWindowStart = performance.now();
    node.port.onmessage = (e: MessageEvent<Float32Array>) => this.#onHop(e.data);
  }

  static supported(): boolean {
    return (
      typeof window !== 'undefined' &&
      typeof navigator?.mediaDevices?.getUserMedia === 'function' &&
      typeof AudioWorkletNode === 'function'
    );
  }

  /** Must be called from inside a user gesture — the Start button is it. */
  static async start(): Promise<AudioEngine> {
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      throw new MicError('insecure-context', MESSAGES['insecure-context']);
    }
    if (!AudioEngine.supported()) {
      throw new MicError('unsupported', MESSAGES.unsupported);
    }

    // Created and resumed before any await, while the gesture is still live.
    let ctx: AudioContext;
    try {
      ctx = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE, latencyHint: 'interactive' });
    } catch {
      // Some devices refuse an explicit rate. Take whatever they give and
      // report it — every calculation downstream reads ctx.sampleRate.
      ctx = new AudioContext({ latencyHint: 'interactive' });
    }
    const resuming = ctx.resume();

    // §3.1. Android's voice-call DSP eats sustained guitar notes.
    const audio: MediaTrackConstraints = {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
      sampleRate: TARGET_SAMPLE_RATE,
    };
    // `latency` is in the Media Capture spec but missing from this TypeScript
    // lib, so it is set on the side rather than dropped.
    (audio as Record<string, unknown>).latency = 0;

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio });
    } catch (err) {
      await ctx.close().catch(() => {});
      throw classify(err);
    }

    try {
      await resuming;
      await ctx.audioWorklet.addModule(workletUrl);

      const track = stream.getAudioTracks()[0];
      const settings: MediaTrackSettings = track?.getSettings() ?? {};
      const report = describe(ctx, settings, track?.label ?? '');

      const source = ctx.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(ctx, 'capture', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: 1,
        channelCountMode: 'explicit',
      });

      // The worklet emits silence, but a node with nothing downstream is not
      // guaranteed to be pulled. A muted sink keeps the graph alive without
      // putting a sound anywhere near the speaker.
      const sink = ctx.createGain();
      sink.gain.value = 0;
      source.connect(node);
      node.connect(sink);
      sink.connect(ctx.destination);

      return new AudioEngine(ctx, stream, source, node, sink, report);
    } catch (err) {
      stream.getTracks().forEach((t) => t.stop());
      await ctx.close().catch(() => {});
      throw classify(err);
    }
  }

  subscribe(listener: FrameListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Forget the settle history — used when the tuner restarts a run. */
  resetTracker() {
    this.#tracker.reset();
    this.#settledState = { settled: false, frequency: null, confidence: null };
    this.#lastPitch = null;
  }

  async stop() {
    if (this.#stopped) return;
    this.#stopped = true;
    this.#node.port.onmessage = null;
    this.#listeners.clear();
    try {
      this.#source.disconnect();
      this.#node.disconnect();
      this.#sink.disconnect();
    } catch {
      /* already torn down */
    }
    this.#stream.getTracks().forEach((t) => t.stop());
    await this.ctx.close().catch(() => {});
  }

  #onHop(hop: Float32Array) {
    if (this.#stopped) return;

    // The high-pass runs once over the continuous stream (§3.2), not per frame,
    // so it carries no restart transient into the overlapping windows.
    this.#highPass(hop);

    this.#ring.copyWithin(0, HOP_SAMPLES);
    this.#ring.set(hop, FRAME_SAMPLES - HOP_SAMPLES);
    this.#hops++;

    this.#hopsInWindow++;
    const now = performance.now();
    const elapsed = now - this.#rateWindowStart;
    if (elapsed >= 1000) {
      this.#hopRate = (this.#hopsInWindow * 1000) / elapsed;
      this.#detectRate = (this.#detectsInWindow * 1000) / elapsed;
      this.#hopsInWindow = 0;
      this.#detectsInWindow = 0;
      this.#rateWindowStart = now;
    }

    // Until four hops have landed the frame is still part zero-padding.
    const primed = this.#hops >= FRAME_SAMPLES / HOP_SAMPLES;
    this.#frame.set(this.#ring);
    const level = primed ? rms(this.#frame) : 0;

    if (primed) this.#noiseFloor = this.#noiseFloorOf(level);

    // The room decides the gate, not a constant: a string has to be louder than
    // the room it is being played in, whichever room that is.
    const gate = gateFor(this.#noiseFloor);

    let pitch: Pitch | null = null;
    const analysed = primed && this.#hops % DETECT_EVERY_HOPS === 0;
    if (analysed) {
      if (level < gate) {
        this.#detectMs = 0;
      } else {
        this.#detectsInWindow++;
        const t0 = performance.now();
        pitch = detectPitch(this.#frame, this.ctx.sampleRate, gate);
        this.#detectMs = performance.now() - t0;
        if (pitch) this.#lastPitch = pitch;
      }
      this.#settledState = this.#tracker.push(pitch);
    }

    const frame: AnalysisFrame = {
      time: this.ctx.currentTime,
      rms: level,
      noiseFloor: this.#noiseFloor,
      gate,
      pitch,
      lastPitch: this.#lastPitch,
      settled: this.#settledState,
      analysed,
      detectMs: this.#detectMs,
      hopRate: this.#hopRate,
      detectRate: this.#detectRate,
    };
    for (const l of this.#listeners) l(frame);
  }
}

function describe(ctx: AudioContext, s: MediaTrackSettings, label: string): MicReport {
  const processing: MicProcessing = {
    echoCancellation: s.echoCancellation,
    noiseSuppression: s.noiseSuppression,
    autoGainControl: s.autoGainControl,
  };

  const stillOn: string[] = [];
  if (processing.echoCancellation === true) stillOn.push('echo cancellation');
  if (processing.noiseSuppression === true) stillOn.push('noise suppression');
  if (processing.autoGainControl === true) stillOn.push('auto gain');

  // A browser that reports none of the three has told us nothing. That is not
  // the same as confirming they are off, and the UI says so.
  const unverified =
    processing.echoCancellation === undefined &&
    processing.noiseSuppression === undefined &&
    processing.autoGainControl === undefined;

  return {
    sampleRate: ctx.sampleRate,
    requestedSampleRate: TARGET_SAMPLE_RATE,
    channelCount: s.channelCount,
    processing,
    clean: stillOn.length === 0 && !unverified,
    stillOn,
    unverified,
    deviceLabel: label,
    baseLatencySec: ctx.baseLatency ?? 0,
  };
}
