import type { BackdropId } from '../types';

/**
 * Scene backdrops, painted as code (gradients / static grain / live blur) so
 * the PWA ships no image assets and every backdrop is theme-invariant — colors
 * are hardcoded here, never pulled from CSS tokens, because the backdrop is
 * part of the recording, not the app chrome. The same `paintBackdrop` fills the
 * preflight preview, the worker output and the picker swatches, so they match.
 *
 * Palette is framecast's Console identity: warm-charcoal neutrals, daylight
 * paper, a restrained LED-green tint.
 */

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Just enough of a drawable screen source for the blur backdrop. */
interface ScreenSrc {
  img: CanvasImageSource;
  w: number;
  h: number;
}

/** Picker order: raw first, the showpiece blur next, then gradients, grain, solids. */
export const BACKDROPS: { id: BackdropId; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'blur', label: 'Blur' },
  { id: 'charcoal', label: 'Charcoal' },
  { id: 'paper', label: 'Paper' },
  { id: 'led', label: 'Studio' },
  { id: 'charcoal-grain', label: 'Char grain' },
  { id: 'paper-grain', label: 'Paper grain' },
  { id: 'ink', label: 'Ink' },
  { id: 'slate', label: 'Slate' },
  { id: 'bone', label: 'Bone' },
];

const SOLID: Partial<Record<BackdropId, string>> = {
  none: '#000000',
  ink: '#0a0908',
  slate: '#2b2722',
  bone: '#efe7d8',
};

const GRADIENT: Partial<Record<BackdropId, [string, string]>> = {
  charcoal: ['#2e2820', '#14110e'],
  paper: ['#f3ead8', '#e3d4bb'],
  led: ['#10231a', '#1c3a2b'],
};

const GRAIN_BASE: Partial<Record<BackdropId, string>> = {
  'charcoal-grain': '#221f1a',
  'paper-grain': '#ece3d2',
};

/**
 * Paints the full backdrop. `screenSrc` is only needed for the content-aware
 * `blur` backdrop; everything else ignores it.
 */
export function paintBackdrop(
  ctx: Ctx2D,
  id: BackdropId,
  outW: number,
  outH: number,
  screenSrc?: ScreenSrc | null,
): void {
  if (id === 'blur') {
    paintBlur(ctx, outW, outH, screenSrc ?? null);
    return;
  }

  const grad = GRADIENT[id];
  if (grad) {
    const g = ctx.createLinearGradient(0, 0, outW, outH);
    g.addColorStop(0, grad[0]);
    g.addColorStop(1, grad[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, outW, outH);
    return;
  }

  const grainBase = GRAIN_BASE[id];
  if (grainBase) {
    ctx.fillStyle = grainBase;
    ctx.fillRect(0, 0, outW, outH);
    applyGrain(ctx, outW, outH);
    return;
  }

  // Solids (and `none` → black).
  ctx.fillStyle = SOLID[id] ?? '#000000';
  ctx.fillRect(0, 0, outW, outH);
}

/* ---------- blur backdrop ---------- */

let blurScratch: OffscreenCanvas | null = null;

function paintBlur(ctx: Ctx2D, outW: number, outH: number, screenSrc: ScreenSrc | null): void {
  if (!screenSrc || screenSrc.w === 0 || screenSrc.h === 0) {
    // Nothing to sample yet (no screen picked) — fall back to the charcoal ramp.
    const g = ctx.createLinearGradient(0, 0, outW, outH);
    g.addColorStop(0, '#2e2820');
    g.addColorStop(1, '#14110e');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, outW, outH);
    return;
  }

  // Downscale the screen into a small scratch buffer, then upscale it blurred to
  // fill the canvas. Blurring ~200px-tall pixels each frame is cheap; the 7-8x
  // upscale plus a modest blur hides any blockiness.
  const dh = 200;
  const dw = Math.max(1, Math.round((dh * outW) / outH));
  const scratch = getBlurScratch(dw, dh);
  let drewScratch = false;
  if (scratch) {
    const sctx = scratch.getContext('2d');
    if (sctx) {
      drawCover(sctx, screenSrc.img, screenSrc.w, screenSrc.h, 0, 0, dw, dh);
      drewScratch = true;
    }
  }

  ctx.save();
  ctx.filter = `blur(${Math.max(8, outH * 0.014)}px)`;
  if (drewScratch && scratch) {
    drawCover(ctx, scratch, dw, dh, 0, 0, outW, outH);
  } else {
    // OffscreenCanvas unavailable (e.g. jsdom): blur the source directly.
    drawCover(ctx, screenSrc.img, screenSrc.w, screenSrc.h, 0, 0, outW, outH);
  }
  ctx.restore();

  // A faint dark scrim so the inset screen and its shadow read above the blur.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
  ctx.fillRect(0, 0, outW, outH);
}

function getBlurScratch(w: number, h: number): OffscreenCanvas | null {
  if (typeof OffscreenCanvas === 'undefined') return null;
  if (!blurScratch || blurScratch.width !== w || blurScratch.height !== h) {
    blurScratch = new OffscreenCanvas(w, h);
  }
  return blurScratch;
}

/** Draws `img` (intrinsic sw×sh) to cover the dst box, center-cropped. */
function drawCover(
  ctx: Ctx2D,
  img: CanvasImageSource,
  sw: number,
  sh: number,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
): void {
  const scale = Math.max(dw / sw, dh / sh);
  const w = sw * scale;
  const h = sh * scale;
  ctx.drawImage(img, dx + (dw - w) / 2, dy + (dh - h) / 2, w, h);
}

/* ---------- grain ---------- */

let grainTile: OffscreenCanvas | null = null;
let grainTried = false;

/** A static monochrome speckle, generated once and tiled (so it never shimmers). */
function applyGrain(ctx: Ctx2D, outW: number, outH: number): void {
  const tile = getGrainTile();
  if (!tile) return;
  const pattern = ctx.createPattern(tile, 'repeat');
  if (!pattern) return;
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, outW, outH);
}

function getGrainTile(): OffscreenCanvas | null {
  if (grainTried) return grainTile;
  grainTried = true;
  if (typeof OffscreenCanvas === 'undefined') return null;
  const size = 128;
  const c = new OffscreenCanvas(size, size);
  const g = c.getContext('2d');
  if (!g) return null;
  const img = g.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.floor(Math.random() * 255);
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = Math.floor(Math.random() * 16); // very faint
  }
  g.putImageData(img, 0, 0);
  grainTile = c;
  return c;
}
