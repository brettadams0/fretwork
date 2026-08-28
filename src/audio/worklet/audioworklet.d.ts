/**
 * The AudioWorklet global scope is not in TypeScript's DOM library, so the
 * handful of names capture.worklet.ts needs are declared here.
 */
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}

declare function registerProcessor(
  name: string,
  processorCtor: new () => AudioWorkletProcessor,
): void;
