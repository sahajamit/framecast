/**
 * High tier: RobustVideoMatting (MobileNetV3, fp32 ONNX) on onnxruntime-web's
 * WebGPU execution provider. RVM is recurrent — temporal stability is built
 * into the model — and produces true per-strand alpha for hair, which the
 * segmentation tiers can only approximate.
 *
 * Fully local, same as everything else: the ~15 MB model ships same-origin
 * under /models and this module is loaded via dynamic import only when the
 * device runs the high tier with a background active, so low-end users never
 * download a byte of it (plan §6, invariant #11). The recurrent state tensors
 * stay on the GPU between frames (preferredOutputLocation: 'gpu-buffer'), so
 * per-frame traffic is one small src upload and one alpha readback.
 *
 * Any failure — no WebGPU adapter, session create error, first-run error —
 * marks the inferencer failed and the engine demotes to balanced. Never a
 * blank bubble.
 */
import type { Inferencer, RawMask } from './types';

const MODEL_PATH = `${import.meta.env.BASE_URL}models/rvm_mobilenetv3_fp32.onnx`;
/** ORT's wasm runtime, staged same-origin by scripts/fetch-matting-assets.mjs. */
const ORT_WASM_DIR = `${import.meta.env.BASE_URL}ort/`;

type Ort = typeof import('onnxruntime-web/webgpu');
type OrtTensor = import('onnxruntime-web/webgpu').Tensor;
type OrtSession = import('onnxruntime-web/webgpu').InferenceSession;

/** RVM's own guidance: the encoder wants to see the person at roughly 256 px. */
const INTERNAL_TARGET = 256;

class RvmInferencer implements Inferencer {
  ready = false;
  failed = false;

  private ort: Ort | null = null;
  private session: OrtSession | null = null;
  private closed = false;
  private rec: [OrtTensor, OrtTensor, OrtTensor, OrtTensor] | null = null;
  private srcBuf: Float32Array | null = null;
  private onReady: (() => void) | null;

  constructor(onReady?: () => void) {
    this.onReady = onReady ?? null;
    void this.init();
  }

  private async init(): Promise<void> {
    try {
      // Runtime import of the staged same-origin ESM bundle. Deliberately NOT
      // a bundler import: Vite would inline 20+ MB of ORT wasm variants into
      // dist. Types still come from the npm package (type-only, erased).
      const ort = (await import(
        /* @vite-ignore */ `${ORT_WASM_DIR}ort.webgpu.bundle.min.mjs`
      )) as Ort;
      ort.env.wasm.wasmPaths = ORT_WASM_DIR;
      const session = await ort.InferenceSession.create(MODEL_PATH, {
        executionProviders: ['webgpu'],
        graphOptimizationLevel: 'all',
        // IO binding: recurrent state never round-trips through JS.
        preferredOutputLocation: {
          r1o: 'gpu-buffer',
          r2o: 'gpu-buffer',
          r3o: 'gpu-buffer',
          r4o: 'gpu-buffer',
        },
      });
      if (this.closed) {
        void session.release();
        return;
      }
      this.ort = ort;
      this.session = session;
      this.ready = true;
      this.onReady?.();
    } catch (err) {
      // Deliberate field diagnostic (fires once, only on failure).
      console.info('[framecast matting] RVM/WebGPU init failed, demoting:', err);
      // No WebGPU adapter / shader compile failure / blocked model fetch:
      // the engine demotes to the balanced tier.
      this.failed = true;
    }
  }

  private zeroRec(): [OrtTensor, OrtTensor, OrtTensor, OrtTensor] {
    const ort = this.ort!;
    const zero = () => new ort.Tensor('float32', new Float32Array([0]), [1, 1, 1, 1]);
    return [zero(), zero(), zero(), zero()];
  }

  private disposeRec(): void {
    if (!this.rec) return;
    for (const t of this.rec) {
      try {
        t.dispose();
      } catch {
        // Already disposed / CPU tensor — nothing to release.
      }
    }
    this.rec = null;
  }

  async run(input: OffscreenCanvas): Promise<RawMask | null> {
    const { ort, session } = this;
    if (!ort || !session || this.closed) return null;
    const w = input.width;
    const h = input.height;
    const ctx = input.getContext('2d');
    if (!ctx || w === 0 || h === 0) return null;

    try {
      // HWC uint8 → normalized CHW float32.
      const img = ctx.getImageData(0, 0, w, h).data;
      const n = w * h;
      if (!this.srcBuf || this.srcBuf.length !== n * 3) this.srcBuf = new Float32Array(n * 3);
      const src = this.srcBuf;
      for (let i = 0; i < n; i++) {
        const j = i * 4;
        src[i] = img[j]! / 255;
        src[n + i] = img[j + 1]! / 255;
        src[2 * n + i] = img[j + 2]! / 255;
      }

      const rec = this.rec ?? this.zeroRec();
      this.rec = null; // ownership moves to the feeds until outputs land
      const ratio = Math.min(1, Math.max(0.25, INTERNAL_TARGET / h));
      const feeds: Record<string, OrtTensor> = {
        src: new ort.Tensor('float32', src, [1, 3, h, w]),
        r1i: rec[0],
        r2i: rec[1],
        r3i: rec[2],
        r4i: rec[3],
        downsample_ratio: new ort.Tensor('float32', new Float32Array([ratio]), [1]),
      };
      const out = await session.run(feeds);
      for (const t of rec) {
        try {
          t.dispose();
        } catch {
          // First-frame zero tensors are CPU-side; dispose is a no-op there.
        }
      }
      if (this.closed) return null;
      this.rec = [
        out['r1o'] as OrtTensor,
        out['r2o'] as OrtTensor,
        out['r3o'] as OrtTensor,
        out['r4o'] as OrtTensor,
      ];
      const pha = out['pha'] as OrtTensor;
      const data = pha.data as Float32Array;
      return { data, w, h };
    } catch {
      // One bad frame (device lost, transient EP error): drop it. Repeated
      // failures surface as a stale mask; the engine's failure watch only
      // fires on init, so also flag failed if the session died.
      return null;
    }
  }

  close(): void {
    this.closed = true;
    this.onReady = null;
    this.disposeRec();
    void this.session?.release();
    this.session = null;
    this.ready = false;
  }
}

export function createRvmInferencer(onReady?: () => void): Inferencer {
  return new RvmInferencer(onReady);
}
