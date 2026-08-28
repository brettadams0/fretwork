import { accuracy } from '../audio/notes';

/**
 * The tuner needle (§6.1).
 *
 * Scale is ±50 cents, so half a semitone fills the dial and a string that is a
 * whole semitone flat pins to the end rather than pretending to be in range.
 * Green at ±5 cents, amber to ±15, coral beyond — the §3.3 thresholds, shown
 * as the same three colours the rest of the app uses for right and wrong.
 */
export function Needle({
  cents,
  settled,
  note,
  holdProgress,
  done,
}: {
  cents: number | null;
  settled: boolean;
  note: string;
  holdProgress: number;
  done: boolean;
}) {
  const live = settled && cents !== null;
  const clamped = Math.max(-50, Math.min(50, cents ?? 0));
  const band = live ? accuracy(cents!) : 'off';

  const colour = !live
    ? 'text-dim'
    : band === 'in-tune'
      ? 'text-hit'
      : band === 'close'
        ? 'text-lamp'
        : 'text-miss';
  const fill = !live
    ? 'bg-dim'
    : band === 'in-tune'
      ? 'bg-hit'
      : band === 'close'
        ? 'bg-lamp'
        : 'bg-miss';

  return (
    <div>
      {/* Readout. The note name is the big thing; the number is the truth. */}
      <div className="flex items-end justify-center gap-4">
        <span className={`panel-label text-7xl leading-none ${live ? 'text-silk' : 'text-dim'}`}>
          {live ? note : '—'}
        </span>
        <span className={`numeral pb-1 text-3xl leading-none ${colour}`}>
          {live ? `${cents! > 0 ? '+' : ''}${cents!.toFixed(1)}` : '  · '}
        </span>
        <span className="panel-label pb-2 text-xs text-dim">cents</span>
      </div>

      {/* Dial. */}
      <div className="relative mt-5 h-16 rounded border border-edge bg-panel">
        {/* ±15 cents — "close". */}
        <div className="absolute inset-y-0 left-[35%] w-[30%] bg-panel-hi" aria-hidden />
        {/* ±5 cents — in tune. */}
        <div
          className="absolute inset-y-0 left-[45%] w-[10%] border-x border-edge bg-chassis"
          aria-hidden
        />
        {/* Centre line. */}
        <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-silk" aria-hidden />

        {/* The needle. */}
        <div
          className={`absolute inset-y-1 w-1 -translate-x-1/2 rounded-full transition-[left] duration-75 ${fill} ${
            live ? '' : 'opacity-40'
          }`}
          style={{ left: `${50 + clamped}%` }}
        />

        <span className="panel-label absolute bottom-1 left-2 text-[0.6rem] text-dim">Flat</span>
        <span className="panel-label absolute right-2 bottom-1 text-[0.6rem] text-dim">Sharp</span>
      </div>

      {/* The 1.5 s green hold. Visible progress, so nobody wonders why a green
          needle has not ticked the string off yet. */}
      <div className="mt-2 flex items-center gap-3">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-panel">
          <div
            className={`h-full ${done ? 'bg-hit' : 'bg-hit'}`}
            style={{ width: `${(done ? 1 : holdProgress) * 100}%` }}
          />
        </div>
        <span className="panel-label w-24 text-right text-[0.6rem] text-dim">
          {done ? 'String done' : holdProgress > 0 ? 'Hold it…' : 'Hold 1.5 s'}
        </span>
      </div>
    </div>
  );
}
