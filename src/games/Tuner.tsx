import { useCallback, useEffect, useRef, useState } from 'react';
import type { AnalysisFrame, AudioEngine } from '../audio/engine';
import { STANDARD_TUNING, noteName } from '../audio/notes';
import { GATE_MAX, gateFor } from '../audio/yin';
import { Banner, DebugOverlay, LevelMeter, Needle, StringDots, VersionTag, useWakeLock } from '../ui';
import { readBestTuneMs, recordTuneMs } from '../store';
import { STAGE0_LIMIT_MS, TunerRun, clock, type TunerView } from './tunerRun';

/**
 * Tuner (§6.1).
 *
 * Six dots across the top, a needle, green at ±5 cents held for 1.5 s before a
 * string counts, and the Stage 0 exit check — all six under 2:00 — timed by the
 * app rather than self-reported. The run logic lives in tunerRun.ts so it can
 * be asserted; this file is the face of it.
 */
export function Tuner({ engine, onStop }: { engine: AudioEngine; onStop: () => void }) {
  const runRef = useRef(new TunerRun());
  const frameRef = useRef<AnalysisFrame | null>(null);
  const keyRef = useRef('');

  const [view, setView] = useState<TunerView>(() => runRef.current.view());
  const [level, setLevel] = useState({ rms: 0, noiseFloor: 0, gate: gateFor(0) });
  const [debugFrame, setDebugFrame] = useState<AnalysisFrame | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [best, setBest] = useState<number | null>(() => readBestTuneMs());
  const [recorded, setRecorded] = useState(false);

  const wakeLock = useWakeLock(true);

  useEffect(() => {
    runRef.current.start(performance.now());
    const unsubscribe = engine.subscribe((f) => {
      frameRef.current = f;
    });

    // The engine delivers 93.75 frames a second; the screen cannot use them all.
    // Step the run and repaint on the animation frame instead, and only call
    // setState when something that is actually drawn has changed — a phone
    // re-rendering this tree 60 times a second for nothing is CPU the detector
    // needs.
    let raf = 0;
    const tick = () => {
      const f = frameRef.current;
      if (f) {
        const next = runRef.current.step({
          nowMs: performance.now(),
          settled: f.settled.settled,
          frequency: f.settled.frequency,
        });

        const key = [
          next.done.map((d) => (d ? 1 : 0)).join(''),
          next.activeIndex,
          next.settled ? 1 : 0,
          next.cents === null ? 'x' : next.cents.toFixed(1),
          Math.round(next.holdProgress * 50),
          Math.round(next.elapsedMs / 250),
          next.finishedMs === null ? 'x' : 'done',
          Math.round(f.rms * 500),
          Math.round(f.noiseFloor * 500),
          Math.round(f.gate * 500),
        ].join('|');

        if (key !== keyRef.current) {
          keyRef.current = key;
          setView(next);
          setLevel({ rms: f.rms, noiseFloor: f.noiseFloor, gate: f.gate });
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      unsubscribe();
      cancelAnimationFrame(raf);
    };
  }, [engine]);

  // The overlay needs raw numbers at a readable rate, and only while it is open.
  useEffect(() => {
    if (!showDebug) return;
    const id = window.setInterval(() => setDebugFrame(frameRef.current), 100);
    return () => window.clearInterval(id);
  }, [showDebug]);

  useEffect(() => {
    if (view.finishedMs === null || recorded) return;
    setRecorded(true);
    if (recordTuneMs(view.finishedMs)) setBest(view.finishedMs);
  }, [view.finishedMs, recorded]);

  const reset = useCallback(() => {
    engine.resetTracker();
    runRef.current.start(performance.now());
    keyRef.current = '';
    setRecorded(false);
    setView(runRef.current.view());
  }, [engine]);

  const active = view.activeIndex === null ? null : STANDARD_TUNING[view.activeIndex];
  const note = view.frequency !== null ? nameOf(view.frequency) : active ? active.label : '—';
  const overTime = view.finishedMs === null && view.elapsedMs > STAGE0_LIMIT_MS;

  // The gate tracks the room, so a loud room is not "the room is above the
  // gate" any more — it is a room loud enough that the gate had to clamp, and
  // the string can no longer be asked to get above it. §12.4 says to say so.
  const noisyRoom = level.gate >= GATE_MAX;

  return (
    <main className="flex min-h-dvh flex-col bg-chassis px-5 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <header className="pt-4">
        <StringDots done={view.done} activeIndex={view.activeIndex} />
      </header>

      <div className="mt-3 space-y-2">
        {!engine.report.clean && (
          <Banner tone={engine.report.unverified ? 'warn' : 'bad'}>
            {engine.report.unverified
              ? 'This browser will not say whether it is processing the microphone. Detection may be degraded.'
              : `Android kept ${listOf(engine.report.stillOn)} on. Detection will be degraded but usable.`}
          </Banner>
        )}
        {noisyRoom && (
          <Banner tone="warn">
            This room is loud enough that the string has to fight it. It will keep working, but a
            clip-on tuner will beat it here &mdash; it reads vibration, not air.
          </Banner>
        )}
      </div>

      {/* The dial, given the space it deserves. */}
      <div className="flex flex-1 flex-col justify-center py-6">
        <Needle
          cents={view.cents}
          settled={view.settled}
          note={note}
          holdProgress={view.holdProgress}
          done={view.activeIndex !== null && view.done[view.activeIndex] === true}
        />

        <p className="mt-6 min-h-[2.5rem] text-center text-sm leading-snug text-dim">
          {instruction(view, level.rms, level.gate)}
        </p>
      </div>

      {/* Bottom third: the numbers that matter, then the controls. */}
      <div className="space-y-4 pb-6">
        <LevelMeter rms={level.rms} noiseFloor={level.noiseFloor} gate={level.gate} />

        <div className="flex items-center justify-between rounded border border-edge bg-panel px-3 py-2">
          <div>
            <p className="panel-label text-[0.65rem] text-dim">Stage 0 · all six under 2:00</p>
            <p className="text-xs text-dim">
              {view.finishedMs !== null
                ? view.passed
                  ? 'Passed — measured, not self-reported.'
                  : 'Over two minutes. The time still counts.'
                : `${view.done.filter(Boolean).length} of 6 in tune`}
            </p>
          </div>
          <div className="text-right">
            <p
              className={`numeral text-2xl leading-none ${
                view.finishedMs !== null
                  ? view.passed
                    ? 'text-hit'
                    : 'text-miss'
                  : overTime
                    ? 'text-miss'
                    : 'text-silk'
              }`}
            >
              {clock(view.finishedMs ?? view.elapsedMs)}
            </p>
            {best !== null && (
              <p className="numeral text-[0.6rem] text-dim">best {clock(best)}</p>
            )}
          </div>
        </div>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={reset}
            className="panel-label min-h-touch flex-1 rounded-lg border border-edge bg-panel text-base text-lamp active:bg-edge"
          >
            {view.finishedMs !== null ? 'Run again' : 'Restart'}
          </button>
          <button
            type="button"
            onClick={onStop}
            className="panel-label min-h-touch flex-1 rounded-lg border border-edge bg-panel text-base text-dim active:bg-edge"
          >
            Stop
          </button>
        </div>

        <div className="space-y-1 text-center">
          {/* §12.6. Trust is worth more than a feature claim. */}
          <p className="text-[0.7rem] leading-snug text-dim">
            In a loud room a clip-on tuner beats this — it reads the string&rsquo;s vibration, this
            reads the air.
          </p>
          <VersionTag onReveal={() => setShowDebug(true)} />
        </div>
      </div>

      {showDebug && (
        <DebugOverlay
          report={engine.report}
          frame={debugFrame}
          wakeLock={wakeLock}
          onClose={() => setShowDebug(false)}
        />
      )}
    </main>
  );
}

function nameOf(f: number) {
  const n = noteName(f);
  return `${n.name}${n.octave}`;
}

function listOf(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function instruction(view: TunerView, rms: number, gate: number): string {
  if (view.finishedMs !== null) {
    return view.passed
      ? 'All six inside ±5 cents. Stage 0 tuning check passed.'
      : 'All six are in tune. The clock went past two minutes — run it again when you want the check.';
  }
  if (rms < gate) return 'Pick any string. The tuner works out which one it is.';
  if (!view.settled) return 'Heard something, but nothing steady enough to trust yet. Let it ring.';
  if (view.cents === null) return 'Let it ring.';
  const a = Math.abs(view.cents);
  if (a <= 5) return 'In tune. Hold it there.';
  if (view.cents < 0) return a > 15 ? 'Flat. Tighten it.' : 'Slightly flat.';
  return a > 15 ? 'Sharp. Loosen it.' : 'Slightly sharp.';
}
