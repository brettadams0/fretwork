import { useRef } from 'react';

export const VERSION = '0.1.0';
export const PHASE = 'phase 1';

/**
 * The version number, and the way into the §10.3 debug overlay: long-press it.
 * Hidden rather than secret — it is how "why won't it hear my low E" gets
 * diagnosed from a number instead of a guess.
 */
export function VersionTag({ onReveal }: { onReveal?: () => void }) {
  const timer = useRef<number | null>(null);

  const cancel = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const begin = () => {
    if (!onReveal) return;
    cancel();
    timer.current = window.setTimeout(() => {
      timer.current = null;
      onReveal();
    }, 600);
  };

  return (
    <p
      className="numeral cursor-default text-xs text-dim select-none"
      onPointerDown={begin}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onContextMenu={(e) => e.preventDefault()}
    >
      v{VERSION} · {PHASE}
    </p>
  );
}
