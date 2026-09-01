import type { ChordShape, StringNumber } from '../content/chords';
import type { Verdict } from '../content/diagnosis';

/**
 * The fretboard renderer (§9) — the signature element, and the one component
 * that will drive chord diagrams, the fret trainer and the Riff Runner highway.
 * This phase needs the chord diagram; the geometry is built so the others are a
 * change of viewport rather than a second renderer.
 *
 * Strings are drawn at true relative gauge, low E thickest, because that is
 * what the instrument looks like and the whole design direction is that the
 * instrument is the interface.
 */

/** Light-gauge electric set, .010–.046, as relative line widths. */
const GAUGE: Record<StringNumber, number> = {
  6: 2.4,
  5: 2.0,
  4: 1.6,
  3: 1.2,
  2: 1.0,
  1: 0.85,
};

const FRETS = 4;
const STRING_GAP = 20;
const FRET_GAP = 26;
const LEFT = 22;
const TOP = 34;
const W = LEFT * 2 + STRING_GAP * 5;
const H = TOP + FRET_GAP * FRETS + 16;

/** String 6 on the left, the way a chord diagram is always drawn. */
const xOf = (s: StringNumber) => LEFT + (6 - s) * STRING_GAP;
const yOf = (fret: number) => TOP + (fret - 0.5) * FRET_GAP;

const VERDICT_FILL: Record<Verdict, string> = {
  correct: 'var(--color-hit)',
  wrong: 'var(--color-miss)',
  dead: 'var(--color-miss)',
  buzz: 'var(--color-lamp)',
};

export function Fretboard({
  chord,
  activeString = null,
  verdicts = {},
}: {
  chord: ChordShape;
  /** Highlighted while the checker is waiting for this string. */
  activeString?: StringNumber | null;
  /** Per-string result, once judged. */
  verdicts?: Partial<Record<StringNumber, Verdict>>;
}) {
  // The window starts at the lowest fretted position, so barre shapes further
  // up the neck will render without changing this component.
  const frets = chord.strings.map((s) => s.fret).filter((f): f is number => f !== 'x' && f > 0);
  const lowest = frets.length ? Math.min(...frets) : 1;
  const base = lowest > FRETS ? lowest : 1;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="mx-auto w-full max-w-[280px]"
      role="img"
      aria-label={`${chord.name} chord diagram`}
    >
      {/* Nut, or the fret number when the window starts up the neck. */}
      {base === 1 ? (
        <rect x={LEFT - 3} y={TOP - 5} width={STRING_GAP * 5 + 6} height={5} fill="var(--color-silk)" />
      ) : (
        <text
          x={LEFT - 10}
          y={TOP + FRET_GAP * 0.6}
          textAnchor="end"
          className="numeral"
          fontSize="11"
          fill="var(--color-dim)"
        >
          {base}
        </text>
      )}

      {/* Frets. */}
      {Array.from({ length: FRETS }, (_, i) => (
        <line
          key={i}
          x1={LEFT}
          y1={TOP + (i + 1) * FRET_GAP}
          x2={LEFT + STRING_GAP * 5}
          y2={TOP + (i + 1) * FRET_GAP}
          stroke="var(--color-edge)"
          strokeWidth="1.5"
        />
      ))}

      {/* Inlay dots, at their real positions on the neck. */}
      {[3, 5, 7, 9].map((f) => {
        const rel = f - base + 1;
        if (rel < 1 || rel > FRETS) return null;
        return (
          <circle
            key={f}
            cx={LEFT + STRING_GAP * 2.5}
            cy={yOf(rel)}
            r="3.5"
            fill="var(--color-edge)"
          />
        );
      })}

      {/* Strings, at relative gauge. */}
      {chord.strings.map((s) => (
        <line
          key={s.string}
          x1={xOf(s.string)}
          y1={TOP}
          x2={xOf(s.string)}
          y2={TOP + FRET_GAP * FRETS}
          stroke={activeString === s.string ? 'var(--color-lamp)' : 'var(--color-dim)'}
          strokeWidth={GAUGE[s.string]}
        />
      ))}

      {/* Open / muted markers above the nut. */}
      {chord.strings.map((s) => {
        const v = verdicts[s.string];
        const colour = v ? VERDICT_FILL[v] : activeString === s.string ? 'var(--color-lamp)' : 'var(--color-dim)';
        if (s.fret === 'x') {
          return (
            <g key={s.string} stroke="var(--color-dim)" strokeWidth="1.6">
              <line x1={xOf(s.string) - 4} y1={TOP - 18} x2={xOf(s.string) + 4} y2={TOP - 10} />
              <line x1={xOf(s.string) - 4} y1={TOP - 10} x2={xOf(s.string) + 4} y2={TOP - 18} />
            </g>
          );
        }
        if (s.fret === 0) {
          return (
            <circle
              key={s.string}
              cx={xOf(s.string)}
              cy={TOP - 14}
              r="4.5"
              fill="none"
              stroke={colour}
              strokeWidth="1.6"
            />
          );
        }
        return null;
      })}

      {/* Fingers. */}
      {chord.strings.map((s) => {
        if (s.fret === 'x' || s.fret === 0) return null;
        const rel = s.fret - base + 1;
        if (rel < 1 || rel > FRETS) return null;
        const v = verdicts[s.string];
        return (
          <g key={s.string}>
            <circle
              cx={xOf(s.string)}
              cy={yOf(rel)}
              r="8"
              fill={v ? VERDICT_FILL[v] : activeString === s.string ? 'var(--color-lamp)' : 'var(--color-silk)'}
            />
            <text
              x={xOf(s.string)}
              y={yOf(rel) + 3.5}
              textAnchor="middle"
              className="numeral"
              fontSize="10"
              fill="var(--color-chassis)"
            >
              {s.finger}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
