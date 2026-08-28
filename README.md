# Fretwork

A free, offline PWA that listens to an electric guitar and teaches a complete
beginner. No backend, no accounts, all DSP client-side.

The full build specification is [docs/SPEC.md](docs/SPEC.md). [CLAUDE.md](CLAUDE.md)
distils it into the rules that are expensive to get wrong, and is what each
working session reads.

```sh
npm install
npm run dev      # dev server
npm run test     # DSP assertions (§10.1)
npm run build    # typecheck + production build into dist/
npm run preview  # serve the production build
npm run icons    # regenerate the launcher icons from the §9 palette
```

## Where it is

Phase 1: microphone permission, AudioWorklet capture, a level meter and the
Tuner. Press Start — that click is the user gesture the AudioContext has to be
created inside — and the tuner works out which string you are playing.

The audio chain is `getUserMedia` (with Android's echo cancellation, noise
suppression and auto gain explicitly off, and verified afterwards) into an
AudioWorklet that posts 512-sample hops, into a 2048-sample rolling frame that
is high-passed at 65 Hz, gated on RMS, and read by YIN.

Long-press the version number for the §10.3 debug overlay: live f0, confidence,
RMS, throughput, and exactly what the microphone reported about itself.

The tuner is a first-cut of the pitch detector. Phase 2 hardens it against the
full §10.1 suite; what exists now is asserted in `tests/`, including the fixture
that must not octave-error.
