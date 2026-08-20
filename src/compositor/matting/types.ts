/**
 * Shared types for the tiered camera matting engine (issue #11). The engine
 * replaces v1's single-path segmenter behind the same push()/getMask() surface,
 * so the compositor worker and the preflight preview upgrade without changes
 * to `scene.ts` or the preview==recording guarantee.
 */

/** Foreground alpha mask, normalized to the source camera frame. */
export interface MaskSource {
  img: CanvasImageSource;
  w: number;
  h: number;
}

/** Raw float confidence mask straight from an inferencer, at model resolution. */
export interface RawMask {
  data: Float32Array;
  w: number;
  h: number;
}

/** A swappable segmentation/matting model behind one contract. */
export interface Inferencer {
  /** True once the model is loaded and inference can run. */
  readonly ready: boolean;
  /** True if init failed permanently. */
  readonly failed: boolean;
  /** One inference on the given frame. Resolves null on transient failure. */
  run(input: OffscreenCanvas): Promise<RawMask | null>;
  close(): void;
}

/**
 * User-facing quality setting. `auto` lets capability detection and the
 * governor pick; the rest pin a tier (the governor may still emergency-
 * downshift below a pinned tier — jank protection beats the pin).
 */
export type MattingQuality = 'auto' | 'high' | 'balanced' | 'lite';

/**
 * Runtime tier actually in effect. Ordered: quality only ever degrades
 * gracefully (high → balanced → lite → floor), never jumps to broken.
 * `floor` = minimum-cost inference, callers render blur instead of a
 * replacement image; below floor the engine stops publishing masks and the
 * compositor falls back to the raw camera (v1 behavior).
 */
export type MattingTier = 'high' | 'balanced' | 'lite' | 'floor';

/** Live measurements for the ?dbg=seg overlay and the governor. */
export interface MattingStats {
  tier: MattingTier;
  /** EMA of one inference, ms. */
  inferMs: number;
  /** EMA of one refinement pass, ms. */
  refineMs: number;
  /** Measured inference cadence, fps. */
  inferFps: number;
  /** True while the governor holds the engine below the requested tier. */
  demoted: boolean;
}

export interface MattingEngine {
  /** Hand the engine the newest camera frame. Non-blocking. */
  push(source: CanvasImageSource, srcW: number, srcH: number): void;
  /** Latest refined foreground mask, or null until ready / on failure. */
  getMask(): MaskSource | null;
  /** True once a model is loaded and inference is running. */
  readonly ready: boolean;
  /** True if init failed permanently (caller should stop pushing). */
  readonly failed: boolean;
  /** Tier currently in effect (may differ from requested while demoted). */
  readonly tier: MattingTier;
  /** Caller-side frame cost, fed to the governor (whole draw, ms). */
  noteDrawTime(ms: number, frameBudgetMs: number): void;
  /** Recording active: governor may downshift but never upshift mid-take. */
  setRecording(active: boolean): void;
  stats(): MattingStats;
  close(): void;
}
