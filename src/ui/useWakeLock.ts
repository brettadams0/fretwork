import { useEffect, useState } from 'react';

/**
 * Hold a screen wake lock while a game is active (§9).
 *
 * The phone is in a guitar stand and the user's hands are on the instrument, so
 * the screen going dark mid-drill is a real failure. Released on unmount and
 * re-acquired on visibilitychange, because Android drops the lock every time
 * the screen blanks or the app goes to the background.
 */
export function useWakeLock(active: boolean): { held: boolean; supported: boolean } {
  const supported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  const [held, setHeld] = useState(false);

  useEffect(() => {
    if (!active || !supported) {
      setHeld(false);
      return;
    }

    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    const acquire = async () => {
      if (cancelled || document.visibilityState !== 'visible') return;
      try {
        sentinel = await navigator.wakeLock.request('screen');
        if (cancelled) {
          await sentinel.release().catch(() => {});
          sentinel = null;
          return;
        }
        setHeld(true);
        sentinel.addEventListener('release', () => setHeld(false));
      } catch {
        // Denied, or the battery saver refused it. Not worth a dialog.
        setHeld(false);
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible' && !sentinel) void acquire();
    };

    void acquire();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      setHeld(false);
      void sentinel?.release().catch(() => {});
      sentinel = null;
    };
  }, [active, supported]);

  return { held, supported };
}
