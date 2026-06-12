import type { BubbleGeometry } from '../types';

export interface RectPx {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Corner radius in px (= w/2 for a circle). */
  r: number;
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

/** Normalized center position for a snap corner, accounting for bubble size. */
export function cornerPosition(
  corner: SnapCorner,
  geom: BubbleGeometry,
  outW: number,
  outH: number,
): { cx: number; cy: number } {
  const minDim = Math.min(outW, outH);
  const d = geom.size * minDim;
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
 * center; otherwise null. Distances are measured in pixels.
 */
export function snapTarget(
  geom: BubbleGeometry,
  outW: number,
  outH: number,
): { corner: SnapCorner; cx: number; cy: number } | null {
  const minDim = Math.min(outW, outH);
  let best: { corner: SnapCorner; cx: number; cy: number; dist: number } | null = null;
  for (const corner of SNAP_CORNERS) {
    const pos = cornerPosition(corner, geom, outW, outH);
    const dx = (pos.cx - geom.cx) * outW;
    const dy = (pos.cy - geom.cy) * outH;
    const dist = Math.hypot(dx, dy);
    if (dist <= SNAP_THRESHOLD * minDim && (!best || dist < best.dist)) {
      best = { corner, ...pos, dist };
    }
  }
  return best ? { corner: best.corner, cx: best.cx, cy: best.cy } : null;
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
  zoom: 1.4,
  mirror: true,
  border: true,
  shadow: true,
  visible: true,
};
