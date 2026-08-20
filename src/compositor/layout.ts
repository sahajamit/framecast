import type { BubbleGeometry, CameraBackground, FrameSettings, ScreenFocus } from '../types';

export interface RectPx {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Corner radius in px (= w/2 for a circle). */
  r: number;
}

/** A plain box in output pixels (the screen frame, the canvas, …). */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SrcRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

export const BUBBLE_MIN_SIZE = 0.12;
export const BUBBLE_MAX_SIZE = 0.45;
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 3;
/** Scene padding: inset as a fraction of output height. */
export const PAD_MAX = 0.12;
/** Scene corner radius, in px at a 1080p-height reference. */
export const RADIUS_MAX = 24;
/** Reference output height the scene radius / shadow sizes are authored against. */
export const FRAME_REF_H = 1080;

/** Live screen-zoom (punch-in) ceiling, and the matching minimum region size. */
export const FOCUS_ZOOM_MAX = 4;
export const FOCUS_W_MIN = 1 / FOCUS_ZOOM_MAX;
/** Quick centered-zoom levels offered as deck/preflight presets. */
export const FOCUS_PRESET_ZOOMS = [1, 1.5, 2] as const;
/** Opacity of the scrim painted outside a spotlight region. */
export const SPOTLIGHT_DIM = 0.45;
/** Spotlight edge feather, as a fraction of the region's smaller side. */
export const FOCUS_FEATHER = 0.05;
/** Punch-in / pull-out glide duration (ms); reduced-motion snaps instead. */
export const FOCUS_GLIDE_MS = 380;
/** Distance of snap anchors from the canvas edge, as a fraction of min(outW, outH). */
export const SNAP_EDGE_MARGIN = 0.03;
/** Drag-end distance (fraction of min dim) within which the bubble snaps to a corner. */
export const SNAP_THRESHOLD = 0.08;

export type SnapCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
export const SNAP_CORNERS: SnapCorner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

/** Bubble square in output pixels. */
export function bubbleRectPx(geom: BubbleGeometry, outW: number, outH: number): RectPx {
  const d = geom.size * Math.min(outW, outH);
  return {
    x: geom.cx * outW - d / 2,
    y: geom.cy * outH - d / 2,
    w: d,
    h: d,
    r: geom.shape === 'circle' ? d / 2 : d * 0.1,
  };
}

/**
 * Source crop rectangle inside a camera frame for a given digital zoom and a
 * target aspect ratio (1 for the square bubble, outW/outH for camera-only).
 * Crop is centered; zoom shrinks it.
 */
export function cameraSrcRect(
  zoom: number,
  frameW: number,
  frameH: number,
  targetAspect = 1,
): SrcRect {
  const z = clamp(zoom, ZOOM_MIN, ZOOM_MAX);
  let sw: number;
  let sh: number;
  if (frameW / frameH > targetAspect) {
    sh = frameH;
    sw = frameH * targetAspect;
  } else {
    sw = frameW;
    sh = frameW / targetAspect;
  }
  sw /= z;
  sh /= z;
  return {
    sx: (frameW - sw) / 2,
    sy: (frameH - sh) / 2,
    sw,
    sh,
  };
}

/**
 * Normalized center position for a snap corner, accounting for bubble size.
 *
 * Without a `frame`, anchors sit a small margin inside the canvas corners (the
 * default, unframed behavior). With a `frame` (the inset screen rect when scene
 * framing is on), the bubble centers on the frame corner — clamped to stay
 * on-canvas — so it straddles the border: the headshot-breaking-the-frame look.
 */
export function cornerPosition(
  corner: SnapCorner,
  geom: BubbleGeometry,
  outW: number,
  outH: number,
  frame?: Box,
): { cx: number; cy: number } {
  const minDim = Math.min(outW, outH);
  const d = geom.size * minDim;
  if (frame) {
    const isLeft = corner === 'top-left' || corner === 'bottom-left';
    const isTop = corner === 'top-left' || corner === 'top-right';
    const cxPx = isLeft ? frame.x : frame.x + frame.w;
    const cyPx = isTop ? frame.y : frame.y + frame.h;
    return {
      cx: clamp(cxPx, d / 2, outW - d / 2) / outW,
      cy: clamp(cyPx, d / 2, outH - d / 2) / outH,
    };
  }
  const m = SNAP_EDGE_MARGIN * minDim;
  const left = (m + d / 2) / outW;
  const right = 1 - (m + d / 2) / outW;
  const top = (m + d / 2) / outH;
  const bottom = 1 - (m + d / 2) / outH;
  switch (corner) {
    case 'top-left':
      return { cx: left, cy: top };
    case 'top-right':
      return { cx: right, cy: top };
    case 'bottom-left':
      return { cx: left, cy: bottom };
    case 'bottom-right':
      return { cx: right, cy: bottom };
  }
}

/**
 * If the bubble center is close enough to a snap anchor, returns the snapped
 * center; otherwise null. Distances are measured in pixels. Pass `frame` (the
 * inset screen rect) to snap relative to the screen frame instead of the canvas.
 */
export function snapTarget(
  geom: BubbleGeometry,
  outW: number,
  outH: number,
  frame?: Box,
): { corner: SnapCorner; cx: number; cy: number } | null {
  const minDim = Math.min(outW, outH);
  let best: { corner: SnapCorner; cx: number; cy: number; dist: number } | null = null;
  for (const corner of SNAP_CORNERS) {
    const pos = cornerPosition(corner, geom, outW, outH, frame);
    const dx = (pos.cx - geom.cx) * outW;
    const dy = (pos.cy - geom.cy) * outH;
    const dist = Math.hypot(dx, dy);
    if (dist <= SNAP_THRESHOLD * minDim && (!best || dist < best.dist)) {
      best = { corner, ...pos, dist };
    }
  }
  return best ? { corner: best.corner, cx: best.cx, cy: best.cy } : null;
}

/**
 * The inset box the screen is framed within for a given padding. Padding is a
 * fraction of output height applied as an equal pixel border on all sides, so
 * the frame reads uniformly regardless of aspect ratio.
 */
export function screenFrameRect(pad: number, outW: number, outH: number): Box {
  const inset = clamp(pad, 0, PAD_MAX) * outH;
  return {
    x: inset,
    y: inset,
    w: Math.max(1, outW - inset * 2),
    h: Math.max(1, outH - inset * 2),
  };
}

/** Scene corner radius in output px, scaled from the 1080p-reference setting. */
export function frameRadiusPx(radius: number, outH: number): number {
  return Math.max(0, radius) * (outH / FRAME_REF_H);
}

/**
 * Where the screen image is drawn within the output, in output px: the framed
 * card (screenFrameRect) with the source contain-fitted inside it. The output
 * follows the source aspect, so the output ratio is used as the source ratio.
 * Lets the UI map a pointer/box on the preview into screen-content coordinates.
 */
export function screenContentRect(pad: number, outW: number, outH: number): Box {
  const card = screenFrameRect(pad, outW, outH);
  const dst = containRect(outW, outH, card.w, card.h);
  return { x: card.x + dst.x, y: card.y + dst.y, w: dst.w, h: dst.h };
}

/** Smallest spotlight region (fraction of a side); spotlights can be tighter than zooms. */
export const FOCUS_SPOTLIGHT_MIN = 0.1;

/**
 * Source-crop rectangle for a screen-zoom focus. `focus.w/h` are fractions of
 * the source image; the crop is centered on (cx,cy) and clamped so it never
 * leaves the source. At w=h=1 this is the whole image (identity), so a
 * mode:'none' / full focus draws exactly as before.
 *
 * For an undistorted punch the caller keeps w === h: the displayed screen rect
 * is a contain-fit of the source (same aspect), so an equal width/height
 * fraction crops a source-aspect rectangle that fills the frame without stretch.
 */
export function screenSrcRect(focus: ScreenFocus, srcW: number, srcH: number): SrcRect {
  const sw = clamp(focus.w, FOCUS_W_MIN, 1) * srcW;
  const sh = clamp(focus.h, FOCUS_W_MIN, 1) * srcH;
  const cx = clamp(focus.cx * srcW, sw / 2, srcW - sw / 2);
  const cy = clamp(focus.cy * srcH, sh / 2, srcH - sh / 2);
  return { sx: cx - sw / 2, sy: cy - sh / 2, sw, sh };
}

/**
 * Snaps a raw drawn box (already normalized to the screen content) to a valid
 * focus. Zoom locks to a square (w === h) by expanding to the larger side, so
 * the punch fills the frame undistorted and nothing the user boxed is cut off;
 * spotlight keeps the drawn shape. Both clamp to min size and inside [0,1]².
 */
export function normalizeFocusRect(
  raw: { cx: number; cy: number; w: number; h: number },
  mode: 'zoom' | 'spotlight',
): ScreenFocus {
  let w = Math.abs(raw.w);
  let h = Math.abs(raw.h);
  if (mode === 'zoom') {
    w = h = clamp(Math.max(w, h), FOCUS_W_MIN, 1);
  } else {
    w = clamp(w, FOCUS_SPOTLIGHT_MIN, 1);
    h = clamp(h, FOCUS_SPOTLIGHT_MIN, 1);
  }
  return {
    mode,
    w,
    h,
    cx: clamp(raw.cx, w / 2, 1 - w / 2),
    cy: clamp(raw.cy, h / 2, 1 - h / 2),
  };
}

/** A centered zoom focus for a given factor (presets, scroll, click-to-punch). */
export function focusForZoom(zoom: number, cx = 0.5, cy = 0.5): ScreenFocus {
  const s = 1 / clamp(zoom, 1, FOCUS_ZOOM_MAX);
  return {
    mode: 'zoom',
    w: s,
    h: s,
    cx: clamp(cx, s / 2, 1 - s / 2),
    cy: clamp(cy, s / 2, 1 - s / 2),
  };
}

/** The implied magnification of a focus (1 = full frame). */
export function focusZoomFactor(focus: ScreenFocus): number {
  return clamp(1 / focus.w, 1, FOCUS_ZOOM_MAX);
}

/** Keeps the bubble fully inside the canvas. */
export function clampBubble(geom: BubbleGeometry, outW: number, outH: number): BubbleGeometry {
  const d = geom.size * Math.min(outW, outH);
  const hx = d / 2 / outW;
  const hy = d / 2 / outH;
  return {
    ...geom,
    size: clamp(geom.size, BUBBLE_MIN_SIZE, BUBBLE_MAX_SIZE),
    zoom: clamp(geom.zoom, ZOOM_MIN, ZOOM_MAX),
    cx: clamp(geom.cx, hx, 1 - hx),
    cy: clamp(geom.cy, hy, 1 - hy),
  };
}

/** True if a point (px, py, in output pixels) lands on the bubble. */
export function hitTest(
  px: number,
  py: number,
  geom: BubbleGeometry,
  outW: number,
  outH: number,
): boolean {
  if (!geom.visible) return false;
  const rect = bubbleRectPx(geom, outW, outH);
  if (geom.shape === 'circle') {
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;
    return Math.hypot(px - cx, py - cy) <= rect.w / 2;
  }
  return px >= rect.x && px <= rect.x + rect.w && py >= rect.y && py <= rect.y + rect.h;
}

/** Contain-fit a source into a destination box, centered. */
export function containRect(
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): { x: number; y: number; w: number; h: number } {
  const scale = Math.min(dstW / srcW, dstH / srcH);
  const w = srcW * scale;
  const h = srcH * scale;
  return { x: (dstW - w) / 2, y: (dstH - h) / 2, w, h };
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export const DEFAULT_BUBBLE: BubbleGeometry = {
  shape: 'circle',
  cx: 0.86,
  cy: 0.82,
  size: 0.24,
  // Full frame by default: no surprise crop on first run. Head-framing is a
  // deliberate opt-in via the Zoom fader (was 1.4 before settings v7).
  zoom: 1,
  mirror: true,
  border: true,
  shadow: true,
  visible: true,
};

/**
 * Framed-by-default: a subtle charcoal backdrop with light padding, soft
 * rounding and a shadow, so the first recording looks produced. `backdrop:
 * 'none'` with pad 0 and radius 0 reproduces the original full-bleed output.
 */
export const DEFAULT_FRAME: FrameSettings = {
  backdrop: 'charcoal',
  pad: 0.04,
  radius: 12,
  shadow: true,
};

/** Blur strength bounds for the camera room-blur, in px at the 1080p reference. */
export const CAMERA_BLUR_MIN = 4;
export const CAMERA_BLUR_MAX = 40;

/**
 * Camera background off by default: the raw camera records exactly as before
 * until the user opts into blur or a built-in from the Camera module.
 */
export const DEFAULT_CAMERA_BACKGROUND: CameraBackground = {
  mode: 'none',
  blur: 18,
  // A mid-tone monochrome: instant (no decode) as the first Backdrop pick.
  builtinId: 'slate',
  quality: 'auto',
};

/** No punch-in: full screen. A take always arms at this. */
export const DEFAULT_FOCUS: ScreenFocus = { mode: 'none', cx: 0.5, cy: 0.5, w: 1, h: 1 };
