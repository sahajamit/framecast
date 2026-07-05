/**
 * The tiered camera matting engine (issue #11) — v2 of `segmentation.ts`,
 * behind the identical push()/getMask() surface so the compositor worker and
 * the preflight preview upgrade without touching `scene.ts`.
 *
 * Per inference (never per composited frame): raw confidence from the tier's
 * inferencer → motion-aware temporal EMA → sigmoid shaping → GPU joint-
 * bilateral upsample against the camera frame → published as a MaskSource
 * normalized to the camera frame. Inference stays decoupled from the draw
 * path (invariant #2): callers push() frames and read getMask() when they
 * paint; a slow model can never stall the frame pump.
 *
 * Tiers degrade gracefully and only gracefully (invariant #11): high →
 * balanced → lite → floor → mask off (raw camera). The QualityGovernor
 * watches smoothed timings and drives transitions; a swap builds the new
 * inferencer in the background while the old one keeps serving masks, so
 * there is never a gap, let alone a stall.
 */
import { emaBlend, shapeToBytes } from './maskMath';
import { createMediaPipeInferencer, type Inferencer } from './mediapipe';
import { createMaskRefiner, type MaskRefiner } from './refine';
import {
  detectCapabilities,
  pickTier,
  QualityGovernor,
  TIER_CONFIG,
  tierAbove,
  tierBelow,
  capTier,
} from './tiers';
import type {
  MaskSource,
  MattingEngine,
  MattingQuality,
  MattingStats,
  MattingTier,
} from './types';
import type { CameraBackground } from '../../types';

export type { MattingEngine, MattingQuality, MattingTier, MaskSource } from './types';

/** Governor evaluation cadence — decisions are cheap but need not run per frame. */
const GOVERN_EVERY_MS = 250;

type InferencerKind = 'rvm' | 'mediapipe-GPU' | 'mediapipe-CPU';

function kindFor(tier: MattingTier): InferencerKind {
  if (tier === 'high') return 'rvm';
  return TIER_CONFIG[tier].delegate === 'GPU' ? 'mediapipe-GPU' : 'mediapipe-CPU';
}

export interface MattingEngineOptions {
  quality?: MattingQuality;
  /** Cap the tier (the preflight preview caps at 'balanced' — plan Q6). */
  maxTier?: MattingTier;
}

class TieredMattingEngine implements MattingEngine {
  ready = false;
  failed = false;

  private quality: MattingQuality;
  /** Best tier this device + quality setting allows. */
  private ceilTier: MattingTier;
  private curTier: MattingTier;
  private maskOff = false;

  private inferencer: Inferencer | null = null;
  private pendingInferencer: Inferencer | null = null;
  private refiner: MaskRefiner | null;
  private governor = new QualityGovernor();

  private closed = false;
  private busy = false;
  private hasPending = false;
  private lastInferStart = 0;
  private lastGovernAt = 0;
  private lastFrameBudget = 33.3;
  private inferIntervalEma = 0;
  private refineEma = 0;
  /** Inferences since the active model last changed (warm-up detection). */
  private inferSinceSwap = 0;

  /** Downscaled copies of the latest pushed frame (model res + guide res). */
  private input: OffscreenCanvas | null = null;
  private inputCtx: OffscreenCanvasRenderingContext2D | null = null;
  private guideHi: OffscreenCanvas | null = null;
  private guideHiCtx: OffscreenCanvasRenderingContext2D | null = null;

  /** Temporal EMA state + shaped byte buffer, at model res. */
  private emaPrev: Float32Array | null = null;
  private shaped: Uint8Array | null = null;

  /** 2D fallback mask (v1 path) when the WebGL2 refiner is unavailable. */
  private maskCanvas: OffscreenCanvas | null = null;
  private maskCtx: OffscreenCanvasRenderingContext2D | null = null;

  private published: MaskSource | null = null;

  constructor(opts: MattingEngineOptions) {
    this.quality = opts.quality ?? 'auto';
    const caps = detectCapabilities();
    this.ceilTier = pickTier(this.quality, caps, opts.maxTier ?? 'high');
    this.curTier = this.ceilTier;
    this.refiner = createMaskRefiner();
    this.governor.configure(TIER_CONFIG[this.curTier], this.lastFrameBudget);
    this.spawnInferencer(this.curTier);
  }

  get tier(): MattingTier {
    return this.curTier;
  }

  /* ---------- inferencer lifecycle ---------- */

  private spawnInferencer(tier: MattingTier): void {
    const cfg = TIER_CONFIG[tier];
    // A transition arriving while a previous swap is still loading replaces it.
    if (this.pendingInferencer) {
      this.pendingInferencer.close();
      this.pendingInferencer = null;
    }
    this.spawnEpoch++;
    const epoch = this.spawnEpoch;

    const attach = (make: (onReady: () => void) => Inferencer): void => {
      const inf: Inferencer = make(() => {
        if (this.closed) return;
        if (this.pendingInferencer === inf) {
          // Background swap finished: retire the old model without a mask gap.
          this.inferencer?.close();
          this.inferencer = inf;
          this.pendingInferencer = null;
          this.emaPrev = null; // model res may change — restart temporal state
        }
        this.inferSinceSwap = 0;
        this.inferIntervalEma = 0;
        this.ready = true;
        if (this.hasPending) void this.run();
      });
      this.kinds.set(inf, kindFor(tier));
      this.spawnTiers.set(inf, tier);
      if (this.inferencer) this.pendingInferencer = inf;
      else this.inferencer = inf;
      this.watchFailure(inf, tier);
    };

    if (tier === 'high') {
      // The high-tier matting model (and the whole ORT runtime) load lazily
      // and only here — no other tier ever downloads them (invariant #11).
      void import('./rvm')
        .then((m) => {
          if (this.closed || this.spawnEpoch !== epoch) return;
          attach((onReady) => m.createRvmInferencer(onReady));
        })
        .catch(() => {
          if (this.closed || this.spawnEpoch !== epoch) return;
          this.transitionTo('balanced');
        });
    } else {
      attach((onReady) => createMediaPipeInferencer(cfg.delegate, onReady));
    }
  }

  /** Init failure of a tier's model demotes instead of giving up (until floor). */
  private watchFailure(inf: Inferencer, tier: MattingTier): void {
    const check = (): void => {
      if (this.closed || (inf !== this.inferencer && inf !== this.pendingInferencer)) return;
      if (inf.ready) return;
      if (inf.failed) {
        // A tier whose model can't init is off the menu for this session, so
        // the governor never upshift-retries into a known-bad tier.
        this.ceilTier = capTier(this.ceilTier, tierBelow(tier) ?? 'floor');
        if (inf === this.pendingInferencer) {
          // Failed background swap (upshift attempt): keep the working model
          // and roll the tier state back to what is actually running —
          // otherwise stats/budgets/canvas sizes all describe a phantom tier.
          this.pendingInferencer = null;
          const activeTier = this.inferencer ? this.spawnTiers.get(this.inferencer) : undefined;
          if (activeTier && activeTier !== this.curTier) {
            this.curTier = activeTier;
            this.governor.configure(TIER_CONFIG[activeTier], this.lastFrameBudget);
          }
          return;
        }
        this.handleActiveFailure();
        return;
      }
      setTimeout(check, 250);
    };
    setTimeout(check, 250);
  }

  /**
   * The serving model died (init failure, or a ready model that stopped
   * working). Demote from the CURRENT tier — not the spawn-time tier, which
   * can be stale after a governor demotion and would no-op transitionTo,
   * stranding the engine with no model, no pending spawn and failed=false.
   * Below floor there is nothing left: flag failed and drop the published
   * mask so callers fall back to the raw camera instead of a frozen cutout.
   */
  private handleActiveFailure(): void {
    this.inferencer?.close();
    this.inferencer = null;
    this.ready = false;
    const below = tierBelow(this.curTier);
    if (below) {
      this.transitionTo(below);
      // transitionTo no-ops on same tier and may skip spawning for same-kind
      // models — but there is no model at all now, so force one.
      if (!this.inferencer && !this.pendingInferencer) this.spawnInferencer(this.curTier);
    } else {
      this.failed = true;
      this.published = null;
    }
  }

  private transitionTo(tier: MattingTier): void {
    if (this.closed || tier === this.curTier) return;
    this.curTier = tier;
    this.governor.configure(TIER_CONFIG[tier], this.lastFrameBudget);
    this.inferIntervalEma = 0;
    const cur = this.inferencer;
    // Same model kind ⇒ the loaded instance keeps working; only resolutions
    // change (canvases resize on the next push). A different kind swaps in
    // the background while the old model keeps serving masks.
    if (!cur || this.kinds.get(cur) !== kindFor(tier)) this.spawnInferencer(tier);
  }

  /** Which model an inferencer instance is (for swap decisions). */
  private kinds = new WeakMap<Inferencer, InferencerKind>();
  /** Which tier each instance was spawned for (rollback on failed swaps). */
  private spawnTiers = new WeakMap<Inferencer, MattingTier>();
  /** Invalidates in-flight async spawns when a newer transition supersedes them. */
  private spawnEpoch = 0;

  /* ---------- frame intake ---------- */

  push(source: CanvasImageSource, srcW: number, srcH: number): void {
    if (this.failed || this.closed || this.maskOff || srcW === 0 || srcH === 0) return;
    const cfg = TIER_CONFIG[this.curTier];

    const ih = cfg.inferHeight;
    const iw = Math.max(1, Math.round((ih * srcW) / srcH));
    if (!this.input || this.input.width !== iw || this.input.height !== ih) {
      this.input = new OffscreenCanvas(iw, ih);
      // willReadFrequently: the high tier reads this canvas back with
      // getImageData every inference; a GPU-backed canvas would stall the
      // pipeline ~1-4ms per readback, exactly the budget the governor watches.
      this.inputCtx = this.input.getContext('2d', { willReadFrequently: true });
    }
    const gh = cfg.guideHeight;
    const gw = Math.max(1, Math.round((gh * srcW) / srcH));
    if (!this.guideHi || this.guideHi.width !== gw || this.guideHi.height !== gh) {
      this.guideHi = new OffscreenCanvas(gw, gh);
      this.guideHiCtx = this.guideHi.getContext('2d');
    }
    if (!this.inputCtx || !this.guideHiCtx) return;
    // Capture pixels synchronously so a VideoFrame closing after this call
    // cannot race the async inference below (same contract as v1).
    this.inputCtx.drawImage(source, 0, 0, iw, ih);
    this.guideHiCtx.drawImage(source, 0, 0, gw, gh);
    this.hasPending = true;
    if (this.ready && !this.busy) void this.run();
  }

  /* ---------- inference + refinement ---------- */

  private async run(): Promise<void> {
    const inf = this.inferencer;
    if (!inf || !inf.ready || !this.input || this.busy || this.closed || this.maskOff) return;
    const cfg = TIER_CONFIG[this.curTier];
    const now = performance.now();
    const wait = this.lastInferStart + cfg.minInferIntervalMs - now;
    if (wait > 0) {
      // Lite/floor cadence: hold inference to its budgeted rate; the composite
      // keeps running at full fps reusing the last published mask.
      setTimeout(() => {
        if (!this.closed && this.hasPending && !this.busy) void this.run();
      }, wait);
      return;
    }

    this.busy = true;
    this.hasPending = false;
    if (this.lastInferStart > 0) {
      const interval = now - this.lastInferStart;
      this.inferIntervalEma =
        this.inferIntervalEma === 0
          ? interval
          : this.inferIntervalEma + (interval - this.inferIntervalEma) * 0.2;
    }
    this.lastInferStart = now;

    try {
      const raw = await inf.run(this.input);
      if (!this.closed && raw) {
        // The first inferences after a model (re)load include shader compiles /
        // graph warm-up — orders of magnitude above steady state. Feeding them
        // to the governor would demote a perfectly capable tier instantly.
        this.inferSinceSwap++;
        if (this.inferSinceSwap > 2) this.governor.noteInfer(performance.now() - now);
        this.publish(raw);
      } else if (!this.closed && inf.failed && inf === this.inferencer) {
        // A model that died AFTER becoming ready (e.g. WebGPU device loss):
        // demote rather than serving the last mask as a frozen cutout forever.
        this.handleActiveFailure();
      }
    } catch {
      // An inferencer broke its never-rejects contract — never let that wedge
      // the busy flag (which would silently disable matting for good).
    } finally {
      this.busy = false;
    }
    if (this.hasPending && !this.closed) void this.run();
  }

  private publish(raw: { data: Float32Array; w: number; h: number }): void {
    // Temporal EMA at model res, in the float domain.
    if (!this.emaPrev || this.emaPrev.length !== raw.data.length) {
      this.emaPrev = raw.data.slice();
    } else {
      emaBlend(this.emaPrev, raw.data);
    }
    // Sigmoid shaping → bytes for texture / ImageData.
    if (!this.shaped || this.shaped.length !== raw.data.length) {
      this.shaped = new Uint8Array(raw.data.length);
    }
    shapeToBytes(this.emaPrev, this.shaped);

    // GPU guided upsample; falls back to the v1 model-res mask on any failure.
    if (this.refiner && this.input && this.guideHi) {
      const t0 = performance.now();
      const refined = this.refiner.render({
        mask: this.shaped,
        maskW: raw.w,
        maskH: raw.h,
        guideLo: this.input,
        guideHi: this.guideHi,
      });
      if (refined) {
        const dt = performance.now() - t0;
        this.refineEma = this.refineEma === 0 ? dt : this.refineEma + (dt - this.refineEma) * 0.2;
        this.published = { img: refined, w: refined.width, h: refined.height };
        return;
      }
      this.refiner.close();
      this.refiner = null;
    }
    this.publishFallback(raw.w, raw.h);
  }

  /** v1 path: white + per-pixel-alpha mask at model res, bilinear-feathered downstream. */
  private publishFallback(w: number, h: number): void {
    if (!this.shaped) return;
    if (!this.maskCanvas || this.maskCanvas.width !== w || this.maskCanvas.height !== h) {
      this.maskCanvas = new OffscreenCanvas(w, h);
      this.maskCtx = this.maskCanvas.getContext('2d');
    }
    if (!this.maskCtx) return;
    const img = this.maskCtx.createImageData(w, h);
    const px = img.data;
    for (let i = 0; i < this.shaped.length; i++) {
      const j = i * 4;
      px[j] = 255;
      px[j + 1] = 255;
      px[j + 2] = 255;
      px[j + 3] = this.shaped[i]!;
    }
    this.maskCtx.putImageData(img, 0, 0);
    this.published = { img: this.maskCanvas, w, h };
  }

  getMask(): MaskSource | null {
    return this.maskOff ? null : this.published;
  }

  /* ---------- governor ---------- */

  noteDrawTime(ms: number, frameBudgetMs: number): void {
    if (this.closed || this.failed) return;
    this.lastFrameBudget = frameBudgetMs;
    this.governor.noteDraw(ms);
    const now = performance.now();
    if (now - this.lastGovernAt < GOVERN_EVERY_MS) return;
    this.lastGovernAt = now;
    const decision = this.governor.decide(now, frameBudgetMs);
    if (decision === 'down') {
      if (this.curTier === 'floor') {
        // Below floor: stop publishing masks; the compositor renders the raw
        // camera. Never a janky recording (plan §5 graceful floor).
        this.maskOff = true;
        this.published = null;
        this.governor.reset();
      } else {
        this.transitionTo(tierBelow(this.curTier)!);
      }
    } else if (decision === 'up') {
      if (this.maskOff) {
        this.maskOff = false;
        this.governor.reset();
      } else {
        const up = tierAbove(this.curTier);
        if (up && capTier(up, this.ceilTier) === up) this.transitionTo(up);
      }
    }
  }

  setRecording(active: boolean): void {
    this.governor.setRecording(active);
  }

  stats(): MattingStats {
    return {
      tier: this.maskOff ? 'floor' : this.curTier,
      inferMs: this.governor.inferMs,
      refineMs: this.refineEma,
      inferFps: this.inferIntervalEma > 0 ? 1000 / this.inferIntervalEma : 0,
      demoted: this.maskOff || this.curTier !== this.ceilTier,
    };
  }

  close(): void {
    this.closed = true;
    this.inferencer?.close();
    this.pendingInferencer?.close();
    this.inferencer = null;
    this.pendingInferencer = null;
    this.refiner?.close();
    this.refiner = null;
    this.published = null;
    this.ready = false;
  }
}

/**
 * Creates a matting engine, or null when the platform can't run it (no
 * OffscreenCanvas, e.g. jsdom) so callers skip straight to the raw camera.
 */
export function createMattingEngine(opts: MattingEngineOptions = {}): MattingEngine | null {
  if (typeof OffscreenCanvas === 'undefined') return null;
  return new TieredMattingEngine(opts);
}

/**
 * The floor tier renders a blur instead of a replacement image: terrible mask
 * edges are far less visible against a blurred room than a crisp backdrop.
 * Callers pass the user's setting through this before drawing.
 */
export function effectiveCameraBackground(
  bg: CameraBackground,
  tier: MattingTier,
): CameraBackground {
  if (tier === 'floor' && bg.mode === 'builtin') {
    return { ...bg, mode: 'blur', blur: Math.max(bg.blur, 24) };
  }
  return bg;
}
