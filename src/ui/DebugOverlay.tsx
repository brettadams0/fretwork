import type { AnalysisFrame, MicReport } from '../audio/engine';
import { DETECT_EVERY_HOPS, FRAME_SAMPLES, HOP_SAMPLES } from '../audio/engine';
import { MIN_CONFIDENCE, RMS_GATE } from '../audio/yin';
import { noteName } from '../audio/notes';

/**
 * The §10.3 live debug overlay. Long-press the version number to open it.
 *
 * Neither of us can hear the output, so this panel is the instrument: every
 * number the audio chain produces, on the device, in real time. Chroma bars and
 * onset marks join it when Phases 4 and 5 add those detectors.
 */
export function DebugOverlay({
  report,
  frame,
  wakeLock,
  onClose,
}: {
  report: MicReport;
  frame: AnalysisFrame | null;
  wakeLock: { held: boolean; supported: boolean };
  onClose: () => void;
}) {
  const pitch = frame?.settled.frequency ?? null;
  const conf = frame?.settled.confidence ?? null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-chassis px-5 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <div className="flex items-center justify-between py-4">
        <h2 className="panel-label text-lg text-silk">Debug</h2>
        <button
          type="button"
          onClick={onClose}
          className="panel-label min-h-touch rounded border border-edge bg-panel px-5 text-sm text-lamp"
        >
          Close
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto pb-6">
        <Section title="Detector">
          <Row k="f0 (settled)" v={pitch ? `${pitch.toFixed(2)} Hz` : '—'} />
          <Row k="note" v={pitch ? nameOf(pitch) : '—'} />
          <Row
            k="confidence"
            v={conf !== null ? conf.toFixed(3) : '—'}
            note={`floor ${MIN_CONFIDENCE}`}
          />
          <Row k="settled" v={frame?.settled.settled ? 'yes' : 'no'} note="4 of 5 within 30¢" />
          <Row
            k="last raw f0"
            v={frame?.lastPitch ? `${frame.lastPitch.frequency.toFixed(2)} Hz` : '—'}
            note="unfiltered"
          />
        </Section>

        <Section title="Level">
          <Row
            k="rms"
            v={frame ? frame.rms.toFixed(5) : '—'}
            note={`gate ${RMS_GATE}${frame && frame.rms >= RMS_GATE ? ' · open' : ' · closed'}`}
          />
          <Row k="noise floor" v={frame ? frame.noiseFloor.toFixed(5) : '—'} note="quietest of 5 s" />
          <Row
            k="dBFS"
            v={frame && frame.rms > 0 ? `${(20 * Math.log10(frame.rms)).toFixed(1)}` : '—'}
          />
        </Section>

        <Section title="Throughput">
          <Row
            k="hops/s"
            v={frame ? frame.hopRate.toFixed(1) : '—'}
            note={`expect ${(48000 / HOP_SAMPLES).toFixed(2)}`}
          />
          <Row
            k="detections/s"
            v={frame ? frame.detectRate.toFixed(1) : '—'}
            note={DETECT_EVERY_HOPS === 1 ? 'every frame' : `every ${DETECT_EVERY_HOPS} frames`}
          />
          <Row
            k="yin cost"
            v={frame ? `${frame.detectMs.toFixed(2)} ms` : '—'}
            note="per analysed frame"
          />
          <Row k="frame / hop" v={`${FRAME_SAMPLES} / ${HOP_SAMPLES}`} />
        </Section>

        <Section title="Microphone">
          <Row
            k="echo cancel"
            v={fmt(report.processing.echoCancellation)}
            bad={report.processing.echoCancellation === true}
          />
          <Row
            k="noise suppress"
            v={fmt(report.processing.noiseSuppression)}
            bad={report.processing.noiseSuppression === true}
          />
          <Row
            k="auto gain"
            v={fmt(report.processing.autoGainControl)}
            bad={report.processing.autoGainControl === true}
          />
          <Row
            k="sample rate"
            v={`${report.sampleRate} Hz`}
            note={`asked ${report.requestedSampleRate}`}
            bad={report.sampleRate !== report.requestedSampleRate}
          />
          <Row k="channels" v={report.channelCount?.toString() ?? 'unreported'} />
          <Row k="base latency" v={`${(report.baseLatencySec * 1000).toFixed(1)} ms`} />
          <Row k="device" v={report.deviceLabel || 'unnamed'} />
        </Section>

        <Section title="Screen">
          <Row
            k="wake lock"
            v={!wakeLock.supported ? 'unsupported' : wakeLock.held ? 'held' : 'not held'}
            bad={wakeLock.supported && !wakeLock.held}
          />
        </Section>

        <p className="text-xs leading-relaxed text-dim">
          Onset marks and chroma bars join this panel with Phases 4 and 5, when those detectors
          exist. Nothing here is inferred — every value is read straight off the running chain.
        </p>
      </div>
    </div>
  );
}

function nameOf(f: number) {
  const n = noteName(f);
  return `${n.name}${n.octave}`;
}

const fmt = (v: boolean | undefined) => (v === undefined ? 'unreported' : v ? 'ON' : 'off');

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="panel-label mb-1 text-xs text-lamp">{title}</h3>
      <div className="rounded border border-edge bg-panel">{children}</div>
    </section>
  );
}

function Row({ k, v, note, bad }: { k: string; v: string; note?: string; bad?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-edge px-3 py-1.5 last:border-b-0">
      <span className="panel-label text-[0.65rem] text-dim">{k}</span>
      <span className="flex items-baseline gap-2 text-right">
        {note && <span className="numeral text-[0.6rem] text-dim">{note}</span>}
        <span className={`numeral text-sm ${bad ? 'text-miss' : 'text-silk'}`}>{v}</span>
      </span>
    </div>
  );
}
