import { STANDARD_TUNING } from '../audio/notes';

/**
 * Six dots across the top, filling in as each string passes (§6.1).
 * Left to right is string 6 to string 1 — low to high, the way a chord diagram
 * and every tab in existence reads.
 */
export function StringDots({
  done,
  activeIndex,
}: {
  done: readonly boolean[];
  activeIndex: number | null;
}) {
  return (
    <div className="flex items-start justify-between gap-1">
      {STANDARD_TUNING.map((s, i) => {
        const isDone = done[i] === true;
        const isActive = activeIndex === i;
        return (
          <div key={s.string} className="flex flex-1 flex-col items-center gap-1.5">
            <div
              className={`h-4 w-4 rounded-full border-2 ${
                isDone
                  ? 'border-hit bg-hit'
                  : isActive
                    ? 'border-lamp bg-transparent'
                    : 'border-edge bg-transparent'
              }`}
            />
            <span
              className={`panel-label text-xs ${
                isDone ? 'text-hit' : isActive ? 'text-lamp' : 'text-dim'
              }`}
            >
              {s.label.replace(/\d/, '')}
            </span>
            <span className="numeral text-[0.6rem] text-dim">{s.string}</span>
          </div>
        );
      })}
    </div>
  );
}
