/**
 * MediaPipe Selfie Segmentation as a swappable inferencer for the matting
 * engine: v1's segmenter (`segmentation.ts`) minus the mask-canvas conversion,
 * which now lives in the engine's refinement stage. Fully local: the wasm
 * runtime and the ~250 KB model are bundled and loaded on demand. The GPU
 * delegate backs the balanced tier; the CPU delegate (multithreaded WASM where
 * COOP/COEP grants SharedArrayBuffer) backs lite/floor.
 */
import type { ImageSegmenter } from '@mediapipe/tasks-vision';
// Resolve the wasm runtime through Vite (works in dev AND build) rather than
// from /public, which Vite's dev server refuses to let source code import.
import wasmLoaderUrl from '@mediapipe/tasks-vision/vision_wasm_internal.js?url';
import wasmBinaryUrl from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url';
import type { Inferencer, RawMask } from './types';

const MODEL_PATH = `${import.meta.env.BASE_URL}mediapipe/models/selfie_segmenter.tflite`;

export type { Inferencer } from './types';

/**
 * MediaPipe's wasm loader is a classic (non-module) script that defines a
 * top-level `var ModuleFactory`. In an ES-module worker — which the
 * compositor worker is — tasks-vision falls back to `import(loaderUrl)`,
 * where that `var` stays module-scoped and never reaches the worker global,
 * and init dies with "ModuleFactory not set". (This silently broke ALL
 * worker-side segmentation in v1: recordings fell back to the raw camera
 * while the main-thread preview segmented happily.)
 *
 * Fix: fetch our own same-origin, hash-pinned loader once and evaluate it
 * with classic-script semantics (indirect eval runs in global scope), which
 * plants `ModuleFactory` on the worker global before tasks-vision looks for
 * it. Trust-equivalent to the `importScripts(loaderUrl)` MediaPipe itself
 * uses in classic workers. Main thread is untouched (script-tag path works).
 */
let loaderReady: Promise<void> | null = null;
function ensureWasmLoaderGlobal(): Promise<void> {
  if (typeof document !== 'undefined') return Promise.resolve();
  const g = globalThis as { ModuleFactory?: unknown };
  if (g.ModuleFactory) return Promise.resolve();
  loaderReady ??= fetch(wasmLoaderUrl)
    .then((r) => r.text())
    .then((src) => {
      (0, eval)(src);
    });
  return loaderReady;
}

class MediaPipeInferencer implements Inferencer {
  ready = false;
  failed = false;

  private seg: ImageSegmenter | null = null;
  private closed = false;
  private ts = 0;
  private onReady: (() => void) | null;

  constructor(delegate: 'GPU' | 'CPU', onReady?: () => void) {
    this.onReady = onReady ?? null;
    void this.init(delegate);
  }

  private async init(delegate: 'GPU' | 'CPU'): Promise<void> {
    try {
      await ensureWasmLoaderGlobal();
      const { ImageSegmenter: Segmenter } = await import('@mediapipe/tasks-vision');
      const fileset = { wasmLoaderPath: wasmLoaderUrl, wasmBinaryPath: wasmBinaryUrl };
      const seg = await Segmenter.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_PATH, delegate },
        canvas: delegate === 'GPU' ? new OffscreenCanvas(256, 256) : undefined,
        runningMode: 'VIDEO',
        outputCategoryMask: false,
        outputConfidenceMasks: true,
      });
      if (this.closed) {
        seg.close();
        return;
      }
      this.seg = seg;
      this.ready = true;
      this.onReady?.();
    } catch (err) {
      // Deliberate field diagnostic (fires once, only on failure): this is
      // how a "backgrounds do nothing on my machine" report becomes debuggable.
      console.info('[framecast matting] MediaPipe init failed (delegate:', delegate, '):', err);
      // No WebGL, blocked model fetch, unsupported browser: give up quietly;
      // the engine falls back a tier or lets the caller keep the raw camera.
      this.failed = true;
    }
  }

  async run(input: OffscreenCanvas): Promise<RawMask | null> {
    if (!this.seg || this.closed) return null;
    try {
      this.ts += 33;
      const result = this.seg.segmentForVideo(input, this.ts);
      const resolved = result instanceof Promise ? await result : result;
      const confidence = resolved.confidenceMasks?.[0];
      const mask = confidence
        ? { data: confidence.getAsFloat32Array(), w: confidence.width, h: confidence.height }
        : null;
      resolved.close();
      return mask;
    } catch {
      // Transient inference error — drop this frame, keep the last good mask.
      return null;
    }
  }

  close(): void {
    this.closed = true;
    this.onReady = null;
    this.seg?.close();
    this.seg = null;
    this.ready = false;
  }
}

export function createMediaPipeInferencer(
  delegate: 'GPU' | 'CPU',
  onReady?: () => void,
): Inferencer {
  return new MediaPipeInferencer(delegate, onReady);
}
