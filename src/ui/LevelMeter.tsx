

/**
 * Input level, shown prominently (§12.4). A tuner that goes quiet is useless
 * unless you can see whether it is hearing anything at all, and if the room's
 * noise floor is above the gate the meter is where that becomes obvious.
 */

/** -60 dBFS to 0, so the useful part of a guitar signal fills the bar. */
function percent(rms: number): number {
  if (rms <= 0) return 0;
  const db = 20 * Math.log10(rms);
  return Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
}

export function LevelMeter({
  rms,
  noiseFloor,
  gate,
}: {
  rms: number;
  noiseFloor: number;
  gate: number;
}) {
  const level = percent(rms);
  const floor = percent(noiseFloor);
  // The gate moves with the room, so the mark on the meter moves with it.
  const gateAt = percent(gate);
  const open = rms >= gate;

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="panel-label text-[0.65rem] text-dim">Input</span>
        <span className="numeral text-[0.65rem] text-dim">
          {rms > 0 ? `${(20 * Math.log10(rms)).toFixed(0).padStart(3)} dB` : '  — dB'}
        </span>
      </div>

      <div className="relative mt-1 h-3 overflow-hidden rounded-sm border border-edge bg-chassis">
        {/* Where the room sits when nothing is being played. */}
        <div
          className="absolute inset-y-0 left-0 bg-panel-hi"
          style={{ width: `${floor}%` }}
          aria-hidden
        />
        <div
          className={`absolute inset-y-0 left-0 transition-[width] duration-75 ${
            open ? 'bg-lamp' : 'bg-dim'
          }`}
          style={{ width: `${level}%` }}
        />
        {/* The gate. Below this line the detector refuses to guess. */}
        <div
          className="absolute inset-y-0 w-px bg-silk"
          style={{ left: `${gateAt}%` }}
          aria-hidden
        />
      </div>
    </div>
  );
}
