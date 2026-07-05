import type { MattingQuality, MattingTier } from './types';

/**
 * Tier selection + the adaptive quality governor. Pure and DOM-free so the
 * whole decision surface is unit-testable; the engine feeds in capabilities
 * and timings, this module answers "which tier" and "shift now?".
 */

export interface Capabilities {
  webgpu: boolean;
  webgl2: boolean;
}

/** Reads real capabilities. Split from pickTier so tests can inject. */
export function detectCapabilities(): Capabilities {
  let webgl2 = false;
  try {
    if (typeof OffscreenCanvas !== 'undefined') {
      const gl = new OffscreenCanvas(1, 1).getContext('webgl2');
      webgl2 = !!gl;
      (gl?.getExtension('WEBGL_lose_context') as { loseContext(): void } | null)?.loseContext();
    }
  } catch {
    webgl2 = false;
  }
  const webgpu = typeof navigator !== 'undefined' && 'gpu' in navigator && !!navigator.gpu;
  return { webgpu, webgl2 };
}

const ORDER: MattingTier[] = ['high', 'balanced', 'lite', 'floor'];

export function tierBelow(tier: MattingTier): MattingTier | null {
  const i = ORDER.indexOf(tier);
  return i < 0 || i === ORDER.length - 1 ? null : ORDER[i + 1]!;
}

export function tierAbove(tier: MattingTier): MattingTier | null {
  const i = ORDER.indexOf(tier);
  return i <= 0 ? null : ORDER[i - 1]!;
}

export function capTier(tier: MattingTier, max: MattingTier): MattingTier {
  return ORDER.indexOf(tier) < ORDER.indexOf(max) ? max : tier;
}

/**
 * Maps the user's quality setting + device capabilities to the requested tier.
 * `high` is only honored where WebGPU exists (it gates the matting model);
 * everywhere else it means "the best this device has", i.e. balanced.
 * `maxTier` lets the preflight preview cap itself at balanced (the High-tier
 * model runs in the recording worker only — accepted plan Q6).
 */
export function pickTier(
  quality: MattingQuality,
  caps: Capabilities,
  maxTier: MattingTier = 'high',
): MattingTier {
  let tier: MattingTier;
  if (quality === 'auto') {
    tier = caps.webgpu ? 'high' : caps.webgl2 ? 'balanced' : 'lite';
  } else if (quality === 'high') {
    tier = caps.webgpu ? 'high' : caps.webgl2 ? 'balanced' : 'lite';
  } else if (quality === 'balanced') {
    tier = caps.webgl2 ? 'balanced' : 'lite';
  } else {
    tier = 'lite';
  }
  return capTier(tier, maxTier);
}

export interface TierConfig {
  /** Inference input height in px (width follows the camera aspect). */
  inferHeight: number;
  /** Refined mask height in px (the guided-upsample output). */
  guideHeight: number;
  /** MediaPipe delegate for this tier ('high' uses it as warm fallback). */
  delegate: 'GPU' | 'CPU';
  /** Minimum ms between inference starts (0 = as fast as frames arrive). */
  minInferIntervalMs: number;
}

export const TIER_CONFIG: Record<MattingTier, TierConfig> = {
  // high: RVM reads the src at 288 (its internal downsample_ratio takes the
  // encoder to ~256) and emits alpha at src res; delegate is the warm-fallback
  // MediaPipe config should RVM ever fail after init.
  // 40 ms cadence: RVM at 25 fps inference with mask reuse composites at a
  // full 30 fps and is visually indistinguishable, while giving the governor
  // an honest budget on GPUs that can't push the matting model at 30.
  high: { inferHeight: 288, guideHeight: 512, delegate: 'GPU', minInferIntervalMs: 40 },
  balanced: { inferHeight: 256, guideHeight: 512, delegate: 'GPU', minInferIntervalMs: 0 },
  lite: { inferHeight: 176, guideHeight: 384, delegate: 'CPU', minInferIntervalMs: 66 },
  floor: { inferHeight: 128, guideHeight: 256, delegate: 'CPU', minInferIntervalMs: 125 },
};

/** Sustained overrun needed before a downshift (ms). Spikes/GC must not demote. */
const DOWNSHIFT_AFTER_MS = 1500;
/** Sustained headroom needed before stepping back up (ms). */
const UPSHIFT_AFTER_MS = 20_000;
/** Fraction of the frame budget the draw may use before counting as overrun. */
const DRAW_BUDGET_FRACTION = 0.7;
/** Fraction of the inference cadence the inference may use. */
const INFER_BUDGET_FRACTION = 0.85;
/** Headroom margin: only upshift when comfortably under budget. */
const HEADROOM_FRACTION = 0.5;
/** EMA smoothing for timing samples. */
const TIMING_EMA = 0.15;

export type GovernorDecision = 'hold' | 'down' | 'up';

/**
 * Watches smoothed inference + draw timings and decides tier transitions.
 * Time is injected (never read) so transitions are deterministic under test.
 *
 * Rules (plan §5): downshift after ~1.5 s of sustained overrun; upshift only
 * after ~20 s of clear headroom and never during a recording (visible quality
 * pops mid-take are worse than staying a tier low); downshift is always
 * allowed, recording or not.
 */
export class QualityGovernor {
  private inferEma = 0;
  private drawEma = 0;
  private overrunSince: number | null = null;
  private headroomSince: number | null = null;
  private recording = false;
  /** Budgets for the current tier; set via configure(). */
  private inferBudgetMs = Infinity;

  configure(cfg: TierConfig, inferFallbackIntervalMs: number): void {
    const cadence = cfg.minInferIntervalMs || inferFallbackIntervalMs;
    this.inferBudgetMs = cadence * INFER_BUDGET_FRACTION;
    this.reset();
  }

  reset(): void {
    this.inferEma = 0;
    this.drawEma = 0;
    this.overrunSince = null;
    this.headroomSince = null;
  }

  setRecording(active: boolean): void {
    this.recording = active;
    if (active) this.headroomSince = null;
  }

  noteInfer(ms: number): void {
    this.inferEma = this.inferEma === 0 ? ms : this.inferEma + (ms - this.inferEma) * TIMING_EMA;
  }

  noteDraw(ms: number): void {
    this.drawEma = this.drawEma === 0 ? ms : this.drawEma + (ms - this.drawEma) * TIMING_EMA;
  }

  get inferMs(): number {
    return this.inferEma;
  }

  get drawMs(): number {
    return this.drawEma;
  }

  /** Evaluate at any cadence; returns the transition to apply (if any). */
  decide(now: number, frameBudgetMs: number): GovernorDecision {
    const drawBudget = frameBudgetMs * DRAW_BUDGET_FRACTION;
    const over =
      (this.drawEma > 0 && this.drawEma > drawBudget) ||
      (this.inferEma > 0 && this.inferEma > this.inferBudgetMs);
    const clear =
      (this.drawEma === 0 || this.drawEma < drawBudget * HEADROOM_FRACTION) &&
      (this.inferEma === 0 || this.inferEma < this.inferBudgetMs * HEADROOM_FRACTION);

    if (over) {
      this.headroomSince = null;
      this.overrunSince ??= now;
      if (now - this.overrunSince >= DOWNSHIFT_AFTER_MS) {
        this.overrunSince = null;
        return 'down';
      }
      return 'hold';
    }

    this.overrunSince = null;
    if (clear && !this.recording) {
      this.headroomSince ??= now;
      if (now - this.headroomSince >= UPSHIFT_AFTER_MS) {
        this.headroomSince = null;
        return 'up';
      }
    } else if (!clear) {
      this.headroomSince = null;
    }
    return 'hold';
  }
}
