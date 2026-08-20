/**
 * Pure mask post-processing math, shared by every tier and unit-tested in
 * isolation (DOM-free). Two stages run on each raw confidence mask, at model
 * resolution, once per inference (never per composited frame):
 *
 * 1. Motion-aware temporal EMA — kills frame-to-frame boundary shimmer (the
 *    #12-class flicker) while letting fast movement through un-smeared.
 * 2. Confidence shaping — a sigmoid around 0.5 that tightens the model's
 *    uncertain grey band into a crisp-but-still-soft edge, removing the
 *    translucent halo v1 passed straight through.
 */

/** Base blend factor toward the new mask when nothing moves (lower = smoother). */
export const EMA_BASE = 0.35;
/** How strongly per-pixel change accelerates the blend (motion awareness). */
export const EMA_MOTION_GAIN = 2.5;
/** Blend ceiling so even fast motion keeps a trace of smoothing. */
export const EMA_MAX = 0.92;
/** Sigmoid steepness for confidence shaping. */
export const SHAPE_K = 10;

/**
 * Blends `cur` into `prev` in place (prev becomes the smoothed result).
 * Per-pixel blend factor rises with the local change, so a moving arm follows
 * instantly while a static hairline stops shimmering.
 */
export function emaBlend(
  prev: Float32Array,
  cur: Float32Array,
  base: number = EMA_BASE,
  motionGain: number = EMA_MOTION_GAIN,
  max: number = EMA_MAX,
): void {
  for (let i = 0; i < prev.length; i++) {
    const p = prev[i]!;
    const c = cur[i]!;
    const d = c - p;
    const a = Math.min(max, base + Math.abs(d) * motionGain);
    prev[i] = p + a * d;
  }
}

/**
 * Shapes confidence through a sigmoid centered at 0.5 and quantizes to bytes
 * for texture upload / ImageData. Values already near 0/1 barely move; the
 * uncertain middle is compressed toward a decisive edge.
 *
 * The sigmoid is renormalized so confidence 0 and 1 map to EXACTLY 0 and 255
 * (the raw curve plateaus at ~2 and ~253, which would blend ~1% of the real
 * room over every backdrop and make the person's core faintly translucent —
 * v1 clamped these endpoints and so do we).
 */
export function shapeToBytes(src: Float32Array, out: Uint8ClampedArray | Uint8Array, k: number = SHAPE_K): void {
  const lo = 1 / (1 + Math.exp(k * 0.5));
  const hi = 1 / (1 + Math.exp(-k * 0.5));
  const scale = 255 / (hi - lo);
  for (let i = 0; i < src.length; i++) {
    const s = 1 / (1 + Math.exp(-k * (src[i]! - 0.5)));
    const v = ((s - lo) * scale + 0.5) | 0;
    out[i] = v < 0 ? 0 : v > 255 ? 255 : v;
  }
}
