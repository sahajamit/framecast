/**
 * Camera lighting / colour grading for the headshot. This is framecast's answer
 * to "my room has one yellow ceiling bulb and I can't afford a ring light": a
 * handful of one-click looks that brighten, warm/cool and add contrast, plus
 * three manual sliders to nudge from there.
 *
 * Deliberately Tier A — pure Canvas 2D, no new dependency. The grade is two
 * cheap in-place passes over the camera box: a `ctx.filter` tonal pass
 * (brightness / contrast / saturate) and a soft-light warmth wash. It runs in
 * the same `drawScene` the recording uses, so the preview is exactly what gets
 * baked into the MP4. `off` (and neutral values) is a strict no-op, so a
 * disabled grade records byte-identically to before this feature existed.
 *
 * WebGL 3D-LUTs and neural relighting are explicitly out of scope here; see the
 * feature issue for the deferred Tier B / C.
 */
import type { CameraLighting, CameraLightingPresetId } from '../types';

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** A drawable box in output pixels (the framed-camera card or the bubble). */
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The full look a preset stamps into the settings. */
interface Grade {
  brightness: number;
  contrast: number;
  saturate: number;
  /** -1 (cool) .. 0 (neutral) .. +1 (warm). */
  warmth: number;
}

export interface LightingPreset {
  id: CameraLightingPresetId;
  label: string;
  grade: Grade;
}

/**
 * Presets are tuned to FIX a dim room, not to stylise a studio: every non-off
 * look lifts brightness first. `neutral` is the gentle "just make me look
 * normal" default; `warm`/`cool` pull the white balance to counter a tungsten
 * or fluorescent cast; `soft` tames harsh overhead glare; `punch` is for an
 * already-decent light that just needs crispness.
 */
export const LIGHTING_PRESETS: LightingPreset[] = [
  { id: 'off', label: 'Off', grade: { brightness: 1, contrast: 1, saturate: 1, warmth: 0 } },
  { id: 'neutral', label: 'Neutral+', grade: { brightness: 1.12, contrast: 1.06, saturate: 1.05, warmth: 0.12 } },
  { id: 'warm', label: 'Warm', grade: { brightness: 1.14, contrast: 1.08, saturate: 1.08, warmth: 0.38 } },
  { id: 'cool', label: 'Cool', grade: { brightness: 1.1, contrast: 1.06, saturate: 1.02, warmth: -0.3 } },
  { id: 'soft', label: 'Soft', grade: { brightness: 1.16, contrast: 0.94, saturate: 0.96, warmth: 0.08 } },
  { id: 'punch', label: 'Punch', grade: { brightness: 1.05, contrast: 1.18, saturate: 1.22, warmth: 0.02 } },
];

const OFF_PRESET: LightingPreset = LIGHTING_PRESETS[0]!;
const PRESET_BY_ID = new Map(LIGHTING_PRESETS.map((p) => [p.id, p]));

/** Look up a preset, falling back to `off` for an unknown id. */
export function lightingPreset(id: CameraLightingPresetId): LightingPreset {
  return PRESET_BY_ID.get(id) ?? OFF_PRESET;
}

// Manual-slider bounds. Only brightness / warmth / contrast are user-facing in
// v1; saturation stays preset-driven.
export const BRIGHTNESS_MIN = 0.6;
export const BRIGHTNESS_MAX = 1.6;
export const CONTRAST_MIN = 0.7;
export const CONTRAST_MAX = 1.5;
export const WARMTH_MIN = -1;
export const WARMTH_MAX = 1;

/** Grade off by default: the raw camera records exactly as before until opted in. */
export const DEFAULT_CAMERA_LIGHTING: CameraLighting = {
  preset: 'off',
  brightness: 1,
  contrast: 1,
  saturate: 1,
  warmth: 0,
};

const EPS = 0.001;

/** The full lighting for a preset id (used when the user picks a preset chip). */
export function lightingFromPreset(id: CameraLightingPresetId): CameraLighting {
  const { grade } = lightingPreset(id);
  return { preset: id, ...grade };
}

/** True only when the grade would visibly change pixels, so `off` stays a no-op. */
export function lightingActive(l?: CameraLighting | null): boolean {
  if (!l || l.preset === 'off') return false;
  return (
    Math.abs(l.brightness - 1) > EPS ||
    Math.abs(l.contrast - 1) > EPS ||
    Math.abs(l.saturate - 1) > EPS ||
    Math.abs(l.warmth) > EPS
  );
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Colour-grade the camera pixels already painted inside `box`, in place. Called
 * at the end of the camera paint, inside the caller's rounded-rect clip, so the
 * grade never spills past the card / bubble edge.
 *
 * Pass 1 (tonal): redraw the box region through a `brightness/contrast/saturate`
 * filter. Drawing the canvas onto itself at 1:1 snapshots the source first, so
 * this is a safe in-place transform. Pass 2 (warmth): a soft-light wash toward
 * orange (warm) or blue (cool) to shift the white balance.
 *
 * No-op unless the grade is active — see `lightingActive`.
 */
export function applyCameraGrade(ctx: Ctx2D, box: Box, lighting?: CameraLighting | null): void {
  if (!lightingActive(lighting)) return;
  const l = lighting!;
  const x = Math.floor(box.x);
  const y = Math.floor(box.y);
  const w = Math.ceil(box.w);
  const h = Math.ceil(box.h);
  if (w <= 0 || h <= 0) return;

  const tonal =
    Math.abs(l.brightness - 1) > EPS ||
    Math.abs(l.contrast - 1) > EPS ||
    Math.abs(l.saturate - 1) > EPS;
  if (tonal) {
    ctx.save();
    ctx.filter = `brightness(${round(l.brightness)}) contrast(${round(l.contrast)}) saturate(${round(l.saturate)})`;
    ctx.drawImage(ctx.canvas, x, y, w, h, x, y, w, h);
    ctx.restore();
  }

  if (Math.abs(l.warmth) > EPS) {
    const a = Math.min(0.5, Math.abs(l.warmth) * 0.45);
    ctx.save();
    ctx.globalCompositeOperation = 'soft-light';
    ctx.fillStyle = l.warmth >= 0 ? `rgba(255, 147, 41, ${round(a)})` : `rgba(41, 150, 255, ${round(a)})`;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  }
}
