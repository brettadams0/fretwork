# Fretwork

A free, offline PWA that listens to an electric guitar and teaches a complete
beginner. No backend, no paid services, all DSP client-side. Full spec:
docs/SPEC.md — read the section named here rather than re-reading the whole file.

## Stack
Vite · React 18 · TypeScript · Tailwind · Zustand · Dexie · vite-plugin-pwa ·
Vitest. No audio libraries — the DSP is written by hand (§1).

## Layout (§1 — do not reorganise)
```
src/audio/    engine · yin · chroma · onset · notes · worklet/capture.worklet
src/engine/   scheduler · scoring · progression
src/content/  chords · curriculum · riffs/ · songs/
src/games/    one component per mode (§6)
src/ui/       shared components + the fretboard renderer
src/store/    zustand slices        src/db/  Dexie schema
tests/fixtures/
```

## Rules that are expensive to get wrong

Microphone (§3.1)
- getUserMedia MUST set echoCancellation, noiseSuppression and autoGainControl
  to false. Android's voice processing eats sustained guitar notes.
- Verify with getSettings() after acquiring the track. If processing is still
  on, show a one-line banner — degraded but usable. Never fail silently, never
  silently proceed.

Capture (§2)
- AudioWorklet only. Never ScriptProcessorNode — it runs on the main thread, so
  a React re-render stalls capture and the rhythm game desyncs.
- 48 kHz mono, 2048-sample frames on a 512-sample hop (75% overlap).

Pitch (§3.2)
- YIN with parabolic interpolation. Never FFT peak-picking or raw
  autocorrelation — on a plucked string the 2nd harmonic often exceeds the
  fundamental, so both octave-error constantly on the low E.
- threshold 0.12. Reject confidence < 0.85, or f0 outside 70–1400 Hz.
- Before YIN: gate on RMS < 0.008, high-pass at 65 Hz, and do **not** window —
  a Hann window biases the difference function.
- Report "settled" only when 4 of the last 5 frames agree within 30 cents.
  In tune = ±5 cents; close = ±15.

Chords (§4)
- Arpeggio mode is monophonic and is the only source of truth for diagnosis.
- Strum mode uses chroma, accepts cosine similarity ≥ 0.80, and is advisory.
  Below that, say it did not recognise the chord. Never present a chroma guess
  as a diagnosis — a confidently wrong answer destroys trust faster than a miss.

Timing (§5)
- Schedule against AudioContext.currentTime with a 25 ms lookahead loop and a
  0.15 s horizon. Never setInterval or setTimeout for note timing.
- Visuals pop from a queue in requestAnimationFrame against the same clock.
  Never derive audio from video or video from audio.
- Onset: flux > median(last 24) × 1.6 + 0.01, 60 ms refractory.
- Latency calibration is mandatory before scoring, or every hit reads late and
  the user is told they have bad timing when they don't. Expect 60–150 ms on
  Android. Hit windows: ±30 ms perfect, ±60 good, ±110 late/early.

Content (§8)
- Never ship copyrighted tab, lyrics, or recordings. Public domain, original,
  or user-imported only. A chord progression is not copyrightable; a song title
  attached to it is a licensing problem.

Honesty (§12)
- State the known limitations in the app. No polyphonic transcription, ghost
  strums are inferred from their effect on later timing, no tone judgement, a
  clip-on tuner beats this in a loud room. Say so where it matters.

## Working agreement (§11, §13)
- One phase per session. Never start the next phase unprompted.
- Phase 2 onward: write the §10.1 assertions **before** the implementation.
  They are the specification of correct behaviour and the only thing standing
  between us and audio code that silently reports the wrong octave.
- No new dependencies without asking. No refactoring outside the phase.
- The user tests on a Samsung S20 FE in Chrome. Neither of us can hear the
  output — behaviour must be verifiable by assertion or by a number on screen.
- Commit at every phase boundary.

Phases: 0 scaffold · 1 mic + worklet + tuner · 2 YIN + notes + tests, Sniper,
Fret Trainer · 3 Chord Check · 4 scheduler + onset + latency + Ghost Strum ·
5 chroma, Change Race, Power Blitz · 6 Riff Runner + importer + songs ·
7 progression · 8 polish.

## Design (§9)
Amplifier faceplate, not a dashboard. Tokens live in src/styles/theme.css as
Tailwind theme tokens; a hex code in a component is a bug:
chassis #1B211F, panel #262E2B, panel-hi #313B37, silk #EAE4D2, dim #8E9891,
lamp #F0A868, hit #7FD1B9, miss #C4614A, edge #3A4441.
Barlow Condensed uppercase for panel labels, IBM Plex Mono for all numerals,
system sans for body. Touch targets 56px minimum, primary controls in the
bottom third, never require two hands.
The fretboard renderer is the signature element and drives chord diagrams, the
fret trainer and the Riff Runner highway. Everything else stays quiet.
Feedback flashes only — no page transitions, no decorative motion. Under
prefers-reduced-motion, reduce to colour-only. Hold a screen wake lock during
any active game; release on unmount, re-acquire on visibilitychange.

## Tuned constants
Record any value discovered by testing on the real device here, with the reason.

### Confirmed on the S20 FE, Chrome (2026-08-28, §10.3 overlay)

- **Android honours the §3.1 constraints.** echoCancellation, noiseSuppression
  and autoGainControl all reported off by getSettings(); sampleRate 48000 as
  asked, channelCount 1, base latency 4.0 ms. This was the largest unknown in
  the spec. It does not generalise to other Android devices, so the check and
  the banner stay.
- **Capture keeps up.** 93.6 hops/s against an expected 93.75, no drops. The
  AudioWorklet path is sound on this phone.
- Screen wake lock: held.
- Idle room level: RMS 0.00005, -85 dBFS — far under the 0.008 gate, so the
  gate correctly stays closed on silence.

### Open — needs a reading taken while a string is ringing

1. **Does a played string clear `RMS_GATE = 0.008` on this mic?** Untested. If
   it does not, the gate is the first genuinely device-tuned constant and the
   tuner cannot work until it changes. Nothing else on this list matters until
   this one is answered.
2. **YIN's real cost on the device, and therefore `DETECT_EVERY_HOPS`.** Still
   unknown — see the defect below.
3. **Does the low E read E2 and not E3** through a real phone mic, with its
   rolloff below 100 Hz? The synthesised and fake-device fixtures both say yes;
   neither has a phone mic in the path.

### Known defect, deferred (Phase 1)

- The overlay's **detections/s counts analysis ticks, not YIN runs.**
  `engine.ts` increments `#detectsInWindow` before the RMS gate is tested, so
  with the gate closed it reports a full 93.6/s while `yin cost` correctly reads
  0.00 ms. The row therefore proves nothing about CPU headroom when the room is
  quiet — it only means something while the gate is open. Fix: increment only on
  frames where YIN actually ran. One line; deferred deliberately, not forgotten.

### Bench values, still unconfirmed on the device

Measured in Chromium on the build machine, driving the app through a fake audio
device playing synthesised open strings. These are the numbers the phone has to
agree with, not phone numbers.

- `DETECT_EVERY_HOPS = 1` (src/audio/engine.ts) — YIN on every frame, as §2's
  pipeline specifies. YIN costs 1.0–1.5 ms per 2048-sample frame; at 93.75
  frames/s that is 100–140 ms of work per second of audio, a tenth to a seventh
  of one core. Measured in-browser: 93.8 hops/s in, 93.8 detections/s out, no
  drops — the gate was open throughout, so that detections figure was real. If
  the phone cannot hold the rate this becomes 2 with no other change, but the
  counter defect above has to be fixed before the overlay can tell us.
- Low E accuracy floor: YIN integrates its difference function over
  buf.length / 2 = 1024 samples, only 1.76 periods of an 82 Hz E. Clean signal
  error 0.62 cents; at 20 dB SNR the error is a systematic 6.3 cents sharp
  (13.2 worst) that the stability filter cannot average away. Every other string
  is inside 5 cents. Asserted as a per-string budget in tests/yin.test.ts. A
  Phase 2 candidate — integrating each tau over all N - tau available samples
  measures 0.10 cents clean and 5.2 at 20 dB, for 1.66x the cost.
- Noise floor = median of the quietest frame in each of the last five seconds.
  A percentile of recent levels measures the ringing note, not the room.
