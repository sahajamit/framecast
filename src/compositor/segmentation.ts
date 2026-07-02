/**
 * Person segmentation for the camera background, running fully locally via
 * MediaPipe's Selfie Segmentation model (WebAssembly + GPU delegate). Nothing
 * leaves the machine: the wasm runtime and the ~250 KB model are bundled under
 * `public/mediapipe/` and loaded on demand only when a background mode is on.
 *
 * Decoupled from the draw loop by design. Callers `push()` the latest camera
 * frame (cheap: one synchronous downscale-draw) and read `getMask()` whenever
 * they paint. Inference runs on its own async cadence — a mask that lags the
 * camera by a frame is imperceptible, and a slow model never stalls the
 * compositor's frame pump (invariant #2). Everything degrades to `null` on any
 * failure (no WebGL, model load error), so the caller falls back to the raw
 * camera and a recording is never blanked out.
 */
import type { ImageSegmenter } from '@mediapipe/tasks-vision';
// Resolve the wasm runtime through Vite (works in dev AND build) rather than
// from /public, which Vite's dev server refuses to let source code import.
import wasmLoaderUrl from '@mediapipe/tasks-vision/vision_wasm_internal.js?url';
import wasmBinaryUrl from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url';

/** Foreground alpha mask, normalized to the source camera frame. */
export interface MaskSource {
  img: CanvasImageSource;
  w: number;
  h: number;
}

export interface CameraSegmenter {
  /** Hand the segmenter the newest camera frame. Non-blocking. */
  push(source: CanvasImageSource, srcW: number, srcH: number): void;
  /** Latest foreground mask, or null until the first inference lands / on failure. */
  getMask(): MaskSource | null;
  /** True once the model is loaded and inference is running. */
  readonly ready: boolean;
  /** True if init failed permanently (caller should stop pushing). */
  readonly failed: boolean;
  close(): void;
}

const MODEL_PATH = `${import.meta.env.BASE_URL}mediapipe/models/selfie_segmenter.tflite`;
/** Inference input height; the model resizes internally so this just caps cost. */
const SEG_HEIGHT = 256;

class MediaPipeCameraSegmenter implements CameraSegmenter {
  ready = false;
  failed = false;

  private seg: ImageSegmenter | null = null;
  private closed = false;
  private busy = false;
  private ts = 0;

  /** Downscaled copy of the latest pushed frame; segmented off the draw path. */
  private input: OffscreenCanvas | null = null;
  private inputCtx: OffscreenCanvasRenderingContext2D | null = null;
  private hasPending = false;

  /** White + per-pixel-alpha foreground mask, sized to the model output. */
  private mask: OffscreenCanvas | null = null;
  private maskCtx: OffscreenCanvasRenderingContext2D | null = null;

  constructor() {
    void this.init();
  }

  private async init(): Promise<void> {
    if (typeof OffscreenCanvas === 'undefined') {
      this.failed = true;
      return;
    }
    try {
      const { ImageSegmenter: Segmenter } = await import('@mediapipe/tasks-vision');
      const fileset = { wasmLoaderPath: wasmLoaderUrl, wasmBinaryPath: wasmBinaryUrl };
      const seg = await Segmenter.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'GPU' },
        canvas: new OffscreenCanvas(SEG_HEIGHT, SEG_HEIGHT),
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
      if (this.hasPending) void this.run();
    } catch {
      // No WebGL, blocked model fetch, unsupported browser: give up quietly and
      // let the caller keep recording the raw camera.
      this.failed = true;
    }
  }

  push(source: CanvasImageSource, srcW: number, srcH: number): void {
    if (this.failed || this.closed || srcW === 0 || srcH === 0) return;
    const h = SEG_HEIGHT;
    const w = Math.max(1, Math.round((h * srcW) / srcH));
    if (!this.input || this.input.width !== w || this.input.height !== h) {
      this.input = new OffscreenCanvas(w, h);
      this.inputCtx = this.input.getContext('2d');
    }
    if (!this.inputCtx) return;
    // Capture the pixels synchronously so a VideoFrame closing after this call
    // cannot race the async inference below.
    this.inputCtx.drawImage(source, 0, 0, w, h);
    this.hasPending = true;
    if (this.ready && !this.busy) void this.run();
  }

  private async run(): Promise<void> {
    if (!this.seg || !this.input || this.busy || this.closed) return;
    this.busy = true;
    this.hasPending = false;
    try {
      this.ts += 33;
      const result = this.seg.segmentForVideo(this.input, this.ts);
      const resolved = result instanceof Promise ? await result : result;
      const confidence = resolved.confidenceMasks?.[0];
      if (confidence) this.writeMask(confidence.getAsFloat32Array(), confidence.width, confidence.height);
      resolved.close();
    } catch {
      // Transient inference error — drop this frame, keep the last good mask.
    }
    this.busy = false;
    if (this.hasPending && !this.closed) void this.run();
  }

  private writeMask(data: Float32Array, w: number, h: number): void {
    if (!this.mask || this.mask.width !== w || this.mask.height !== h) {
      this.mask = new OffscreenCanvas(w, h);
      this.maskCtx = this.mask.getContext('2d');
    }
    if (!this.maskCtx) return;
    const img = this.maskCtx.createImageData(w, h);
    const px = img.data;
    for (let i = 0; i < data.length; i++) {
      const a = data[i] ?? 0;
      const j = i * 4;
      px[j] = 255;
      px[j + 1] = 255;
      px[j + 2] = 255;
      px[j + 3] = a >= 1 ? 255 : a <= 0 ? 0 : (a * 255) | 0;
    }
    this.maskCtx.putImageData(img, 0, 0);
  }

  getMask(): MaskSource | null {
    if (!this.mask) return null;
    return { img: this.mask, w: this.mask.width, h: this.mask.height };
  }

  close(): void {
    this.closed = true;
    this.seg?.close();
    this.seg = null;
    this.ready = false;
  }
}

/**
 * Creates a camera segmenter. Returns null when the platform can't run it
 * (no OffscreenCanvas, e.g. jsdom), so callers can skip straight to raw camera.
 */
export function createCameraSegmenter(): CameraSegmenter | null {
  if (typeof OffscreenCanvas === 'undefined') return null;
  return new MediaPipeCameraSegmenter();
}
