import { useCallback, useEffect, useState } from 'react';
import { AudioEngine, MicError } from './audio/engine';
import { Tuner } from './games/Tuner';
import { VersionTag } from './ui';

/**
 * Phase 1 is one route: press Start, which is the user gesture the AudioContext
 * has to be created inside, and land in the Tuner.
 */
type State =
  | { name: 'idle' }
  | { name: 'starting' }
  | { name: 'running'; engine: AudioEngine }
  | { name: 'error'; message: string; retryable: boolean };

export default function App() {
  const [state, setState] = useState<State>({ name: 'idle' });

  const start = useCallback(async () => {
    setState({ name: 'starting' });
    try {
      // Everything about the AudioContext lifecycle depends on this call
      // happening inside the click. See engine.ts.
      const engine = await AudioEngine.start();
      setState({ name: 'running', engine });
    } catch (err) {
      const message =
        err instanceof MicError ? err.message : 'The microphone could not be opened.';
      const retryable = !(err instanceof MicError && err.kind === 'unsupported');
      setState({ name: 'error', message, retryable });
    }
  }, []);

  const stop = useCallback(() => {
    setState((s) => {
      if (s.name === 'running') void s.engine.stop();
      return { name: 'idle' };
    });
  }, []);

  // A live microphone must not outlive the app.
  useEffect(() => {
    if (state.name !== 'running') return;
    const engine = state.engine;
    return () => {
      void engine.stop();
    };
  }, [state]);

  if (state.name === 'running') {
    return <Tuner engine={state.engine} onStop={stop} />;
  }

  return (
    <main className="flex min-h-dvh flex-col bg-chassis px-6 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <h1 className="panel-label text-5xl font-semibold text-silk">Fretwork</h1>
        <p className="panel-label text-sm text-dim">Tuner</p>
      </div>

      <div className="flex flex-col items-center gap-4 pb-10">
        {state.name === 'error' && (
          <div
            role="alert"
            className="w-full max-w-sm rounded border border-miss bg-panel px-3 py-2 text-center text-xs leading-snug text-miss"
          >
            {state.message}
          </div>
        )}

        <p className="max-w-sm text-center text-xs leading-relaxed text-dim">
          Fretwork listens through the microphone and asks Android to leave the signal alone. It
          never records, and nothing leaves the phone.
        </p>

        <button
          type="button"
          onClick={() => void start()}
          disabled={state.name === 'starting'}
          className="panel-label min-h-touch w-full max-w-sm rounded-lg border border-edge bg-panel px-8 text-lg font-semibold text-lamp active:bg-edge disabled:text-dim"
        >
          {state.name === 'starting'
            ? 'Opening microphone…'
            : state.name === 'error' && state.retryable
              ? 'Try again'
              : 'Start'}
        </button>

        <VersionTag />
      </div>
    </main>
  );
}
