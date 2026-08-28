/**
 * Local persistence.
 *
 * §1 puts Zustand and Dexie here, and neither is installed yet — Phase 7 owns
 * progression, and adding either now would be building the store before there
 * is anything to store. Until then the one result Phase 1 produces, the Stage 0
 * tuner time, lives in localStorage behind this module, so Phase 7 has one
 * place to migrate.
 */

const KEY = 'fretwork.stage0.bestTuneMs';

export function readBestTuneMs(): number | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    // Private browsing, or storage disabled. A missing best time is not worth
    // interrupting anyone over.
    return null;
  }
}

/** Keeps the fastest run. Returns true when this run was a new best. */
export function recordTuneMs(ms: number): boolean {
  const best = readBestTuneMs();
  if (best !== null && best <= ms) return false;
  try {
    localStorage.setItem(KEY, String(Math.round(ms)));
  } catch {
    /* nothing to do — the run still counted on screen */
  }
  return true;
}
