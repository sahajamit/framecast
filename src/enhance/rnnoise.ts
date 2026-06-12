import { loadRnnoise, RnnoiseWorkletNode } from '@sapphi-red/web-noise-suppressor';
import rnnoiseWorkletPath from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url';
import rnnoiseWasmPath from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url';
import rnnoiseSimdWasmPath from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url';

let wasmBinaryPromise: Promise<ArrayBuffer> | null = null;

function rnnoiseBinary(): Promise<ArrayBuffer> {
  wasmBinaryPromise ??= loadRnnoise({ url: rnnoiseWasmPath, simdUrl: rnnoiseSimdWasmPath });
  return wasmBinaryPromise;
}

/**
 * Offline RNNoise pass over a full recording's audio. Renders through an
 * OfflineAudioContext so the worklet's internal 480-sample framing is handled
 * for us, much faster than real time. RNNoise expects 48 kHz input — which is
 * what framecast records.
 */
export async function denoiseAudioBuffer(input: AudioBuffer): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(input.numberOfChannels, input.length, input.sampleRate);
  const [binary] = await Promise.all([
    rnnoiseBinary(),
    ctx.audioWorklet.addModule(rnnoiseWorkletPath),
  ]);
  const source = new AudioBufferSourceNode(ctx, { buffer: input });
  // Typed against AudioContext but works on any BaseAudioContext.
  const rnnoise = new RnnoiseWorkletNode(ctx as unknown as AudioContext, {
    wasmBinary: binary,
    maxChannels: input.numberOfChannels,
  });
  source.connect(rnnoise);
  rnnoise.connect(ctx.destination);
  source.start();
  const rendered = await ctx.startRendering();
  rnnoise.destroy();
  return rendered;
}
