import { useCallback, useEffect, useRef, useState } from 'react';
import type { AnalysisFrame, AudioEngine } from '../audio/engine';
import { CHORDS, type ChordShape, type StringNumber } from '../content/chords';
import type { Verdict } from '../content/diagnosis';
import {
  Banner,
  DebugOverlay,
  Fretboard,
  LevelMeter,
  VersionTag,
  useWakeLock,
} from '../ui';
import { GATE_MAX, gateFor } from '../audio/yin';
import { ChordCheckRun, type CheckView } from './chordCheck';

/**
 * Chord Check (§4.1, §6.4) — the flagship.
 *
 * One string at a time, so detection is monophonic and therefore the reliable
 * case. The six-row strip is the point: not "that was not an Em" but "string 2
 * is muted, the finger on string 3 is lying flat".
 */
export function ChordCheck({
  engine,
  onStop,
  onSwitch,
}: {
  engine: AudioEngine;
  onStop: () => void;
  onSwitch: () => void;
}) {
  const [chord, setChord] = useState<ChordShape>(CHORDS[0]!);
  const runRef = useRef(new ChordCheckRun(chord));
  const frameRef = useRef<AnalysisFrame | null>(null);
  const keyRef = useRef('');

  const [view, setView] = useState<CheckView>(() => runRef.current.view());
  const [level, setLevel] = useState({ rms: 0, noiseFloor: 0, gate: gateFor(0) });
  const [debugFrame, setDebugFrame] = useState<AnalysisFrame | null>(null);
  const [showDebug, setShowDebug] = useState(false);

  const wakeLock = useWakeLock(true);

  useEffect(() => {
    const run = new ChordCheckRun(chord);
    runRef.current = run;
    run.start(performance.now());
    keyRef.current = '';
    setView(run.view());
    engine.resetTracker();
  }, [chord, engine]);

  useEffect(() => {
    const unsubscribe = engine.subscribe((f) => {
      frameRef.current = f;
    });

    let raf = 0;
    const tick = () => {
      const f = frameRef.current;
      if (f) {
        const next = runRef.current.step({
          nowMs: performance.now(),
          rms: f.rms,
          gate: f.gate,
          settled: f.settled,
          raw: f.raw,
        });
        const key = [
          next.index,
          next.phase,
          next.results.length,
          next.results.map((r) => r.verdict).join(''),
          Math.round(next.listenProgress * 20),
          Math.round(f.rms * 500),
          Math.round(f.gate * 5000),
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

  useEffect(() => {
    if (!showDebug) return;
    const id = window.setInterval(() => setDebugFrame(frameRef.current), 100);
    return () => window.clearInterval(id);
  }, [showDebug]);

  const restart = useCallback(() => {
    runRef.current.start(performance.now());
    engine.resetTracker();
    keyRef.current = '';
    setView(runRef.current.view());
  }, [engine]);

  const redo = useCallback(() => {
    runRef.current.redoLast();
    engine.resetTracker();
    keyRef.current = '';
    setView(runRef.current.view());
  }, [engine]);

  const verdicts: Partial<Record<StringNumber, Verdict>> = {};
  for (const r of view.results) verdicts[r.string] = r.verdict;

  const noisyRoom = level.gate >= GATE_MAX;

  return (
    <main className="flex min-h-dvh flex-col bg-chassis px-5 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      {/* Chord picker. */}
      <div className="-mx-5 overflow-x-auto px-5 pt-4">
        <div className="flex gap-2">
          {CHORDS.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setChord(c)}
              className={`panel-label shrink-0 rounded border px-4 py-2 text-sm ${
                c.id === chord.id
                  ? 'border-lamp bg-panel-hi text-lamp'
                  : 'border-edge bg-panel text-dim'
              }`}
            >
              {c.id}
            </button>
          ))}
        </div>
      </div>

      {noisyRoom && (
        <div className="mt-3">
          <Banner tone="warn">
            This room is loud enough that quiet strings will read as muted. Diagnoses here are less
            trustworthy than usual.
          </Banner>
        </div>
      )}

      <div className="mt-4">
        <Fretboard
          chord={chord}
          activeString={view.target?.string ?? null}
          verdicts={verdicts}
        />
      </div>

      {/* What to do, right now. */}
      <p className="mt-4 min-h-[3rem] text-center text-sm leading-snug text-silk">
        {view.complete
          ? view.summary.text
          : view.target
            ? `Hold the shape. Pick string ${view.target.string} only.`
            : 'Pick a chord.'}
      </p>

      {/* The six-row strip — the actual product. */}
      <div className="mt-3 flex-1 space-y-1 overflow-y-auto">
        {chord.strings.map((s) => {
          const r = view.results.find((x) => x.string === s.string);
          const active = view.target?.string === s.string;
          const muted = s.fret === 'x';
          return (
            <div
              key={s.string}
              className={`flex items-start gap-3 rounded border px-3 py-2 ${
                active ? 'border-lamp bg-panel-hi' : 'border-edge bg-panel'
              }`}
            >
              <span className="numeral w-4 shrink-0 pt-0.5 text-sm text-dim">{s.string}</span>
              <div className="min-w-0 flex-1">
                {muted ? (
                  <p className="text-xs text-dim">Not played in this shape.</p>
                ) : r ? (
                  <p
                    className={`text-xs leading-snug ${
                      r.verdict === 'correct'
                        ? 'text-hit'
                        : r.verdict === 'buzz'
                          ? 'text-lamp'
                          : 'text-miss'
                    }`}
                  >
                    {r.diagnosis}
                  </p>
                ) : active ? (
                  <p className="text-xs text-lamp">Listening…</p>
                ) : (
                  <p className="text-xs text-dim">Waiting.</p>
                )}
              </div>
              {r?.cents != null && r.verdict === 'correct' && (
                <span className="numeral shrink-0 pt-0.5 text-[0.65rem] text-dim">
                  {r.cents > 0 ? '+' : ''}
                  {r.cents.toFixed(0)}¢
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div className="space-y-3 pt-3 pb-6">
        <LevelMeter rms={level.rms} noiseFloor={level.noiseFloor} gate={level.gate} />

        <div className="flex gap-2">
          <button
            type="button"
            onClick={view.complete ? restart : redo}
            disabled={!view.complete && view.results.length === 0}
            className="panel-label min-h-touch flex-1 rounded-lg border border-edge bg-panel text-sm text-lamp active:bg-edge disabled:text-dim"
          >
            {view.complete ? 'Again' : 'Redo last'}
          </button>
          <button
            type="button"
            onClick={onSwitch}
            className="panel-label min-h-touch flex-1 rounded-lg border border-edge bg-panel text-sm text-silk active:bg-edge"
          >
            Tuner
          </button>
          <button
            type="button"
            onClick={onStop}
            className="panel-label min-h-touch flex-1 rounded-lg border border-edge bg-panel text-sm text-dim active:bg-edge"
          >
            Stop
          </button>
        </div>

        <div className="space-y-1 text-center">
          {/* §12.1. This mode is the accurate one, and the UI should say so. */}
          <p className="text-[0.7rem] leading-snug text-dim">
            One string at a time is the only thing this app diagnoses reliably. It cannot hear a
            full strum note by note.
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
