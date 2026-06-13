import { describe, expect, it } from 'vitest';
import {
  BUBBLE_MAX_SIZE,
  bubbleRectPx,
  cameraSrcRect,
  clampBubble,
  containRect,
  cornerPosition,
  DEFAULT_BUBBLE,
  frameRadiusPx,
  hitTest,
  PAD_MAX,
  screenFrameRect,
  snapTarget,
} from '../src/compositor/layout';
import type { BubbleGeometry } from '../src/types';

const OUT_W = 2560;
const OUT_H = 1440;

const bubble = (patch: Partial<BubbleGeometry> = {}): BubbleGeometry => ({
  ...DEFAULT_BUBBLE,
  ...patch,
});

describe('bubbleRectPx', () => {
  it('sizes the bubble from the smaller output dimension', () => {
    const rect = bubbleRectPx(bubble({ cx: 0.5, cy: 0.5, size: 0.25 }), OUT_W, OUT_H);
    expect(rect.w).toBeCloseTo(0.25 * OUT_H);
    expect(rect.h).toBeCloseTo(rect.w);
    expect(rect.x).toBeCloseTo(OUT_W / 2 - rect.w / 2);
    expect(rect.y).toBeCloseTo(OUT_H / 2 - rect.h / 2);
  });

  it('uses a full corner radius for circles and 10% for rounded rects', () => {
    const circle = bubbleRectPx(bubble({ shape: 'circle', size: 0.2 }), OUT_W, OUT_H);
    expect(circle.r).toBeCloseTo(circle.w / 2);
    const rounded = bubbleRectPx(bubble({ shape: 'roundedRect', size: 0.2 }), OUT_W, OUT_H);
    expect(rounded.r).toBeCloseTo(rounded.w * 0.1);
  });
});

describe('cameraSrcRect', () => {
  it('crops a centered square from a 16:9 frame at zoom 1', () => {
    const src = cameraSrcRect(1, 1920, 1080, 1);
    expect(src.sw).toBe(1080);
    expect(src.sh).toBe(1080);
    expect(src.sx).toBe((1920 - 1080) / 2);
    expect(src.sy).toBe(0);
  });

  it('zoom 2 halves the crop and keeps it centered', () => {
    const src = cameraSrcRect(2, 1920, 1080, 1);
    expect(src.sw).toBe(540);
    expect(src.sh).toBe(540);
    expect(src.sx).toBe((1920 - 540) / 2);
    expect(src.sy).toBe((1080 - 540) / 2);
  });

  it('matches a target aspect for camera-only layouts', () => {
    const src = cameraSrcRect(1, 1920, 1080, 16 / 9);
    expect(src.sw).toBe(1920);
    expect(src.sh).toBe(1080);
    const tall = cameraSrcRect(1, 1080, 1920, 16 / 9);
    expect(tall.sw).toBe(1080);
    expect(tall.sh).toBeCloseTo(1080 / (16 / 9));
  });

  it('clamps zoom to the supported range', () => {
    const src = cameraSrcRect(99, 1920, 1080, 1);
    expect(src.sw).toBe(1080 / 3);
  });
});

describe('snapTarget + cornerPosition', () => {
  it('snaps when the bubble is near a corner anchor', () => {
    const anchor = cornerPosition('bottom-right', bubble(), OUT_W, OUT_H);
    const near = bubble({ cx: anchor.cx - 0.01, cy: anchor.cy + 0.01 });
    const snapped = snapTarget(near, OUT_W, OUT_H);
    expect(snapped?.corner).toBe('bottom-right');
    expect(snapped?.cx).toBeCloseTo(anchor.cx);
    expect(snapped?.cy).toBeCloseTo(anchor.cy);
  });

  it('does not snap from the middle of the canvas', () => {
    expect(snapTarget(bubble({ cx: 0.5, cy: 0.5 }), OUT_W, OUT_H)).toBeNull();
  });

  it('keeps every corner anchor fully on canvas', () => {
    for (const corner of ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const) {
      const pos = cornerPosition(corner, bubble({ size: BUBBLE_MAX_SIZE }), OUT_W, OUT_H);
      const clamped = clampBubble(
        bubble({ size: BUBBLE_MAX_SIZE, cx: pos.cx, cy: pos.cy }),
        OUT_W,
        OUT_H,
      );
      expect(clamped.cx).toBeCloseTo(pos.cx);
      expect(clamped.cy).toBeCloseTo(pos.cy);
    }
  });
});

describe('clampBubble', () => {
  it('pulls an off-canvas bubble back inside', () => {
    const clamped = clampBubble(bubble({ cx: 1.2, cy: -0.4, size: 0.3 }), OUT_W, OUT_H);
    const rect = bubbleRectPx(clamped, OUT_W, OUT_H);
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.y).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.w).toBeLessThanOrEqual(OUT_W);
    expect(rect.y + rect.h).toBeLessThanOrEqual(OUT_H);
  });
});

describe('hitTest', () => {
  it('hits inside the circle, misses its bounding-box corner', () => {
    const geom = bubble({ shape: 'circle', cx: 0.5, cy: 0.5, size: 0.2 });
    const rect = bubbleRectPx(geom, OUT_W, OUT_H);
    expect(hitTest(OUT_W / 2, OUT_H / 2, geom, OUT_W, OUT_H)).toBe(true);
    expect(hitTest(rect.x + 2, rect.y + 2, geom, OUT_W, OUT_H)).toBe(false);
  });

  it('never hits a hidden bubble', () => {
    const geom = bubble({ visible: false, cx: 0.5, cy: 0.5 });
    expect(hitTest(OUT_W / 2, OUT_H / 2, geom, OUT_W, OUT_H)).toBe(false);
  });
});

describe('containRect', () => {
  it('letterboxes a wide source into a square box', () => {
    const r = containRect(1920, 1080, 1000, 1000);
    expect(r.w).toBeCloseTo(1000);
    expect(r.h).toBeCloseTo(562.5);
    expect(r.y).toBeCloseTo((1000 - 562.5) / 2);
  });
});

describe('screenFrameRect', () => {
  it('insets by an equal pixel border on all sides (fraction of height)', () => {
    const box = screenFrameRect(0.05, OUT_W, OUT_H);
    const inset = 0.05 * OUT_H; // 72
    expect(box.x).toBeCloseTo(inset);
    expect(box.y).toBeCloseTo(inset);
    expect(box.w).toBeCloseTo(OUT_W - inset * 2);
    expect(box.h).toBeCloseTo(OUT_H - inset * 2);
  });

  it('is the full canvas at pad 0 (the raw, byte-identical case)', () => {
    const box = screenFrameRect(0, OUT_W, OUT_H);
    expect(box).toEqual({ x: 0, y: 0, w: OUT_W, h: OUT_H });
  });

  it('clamps padding to PAD_MAX', () => {
    const box = screenFrameRect(1, OUT_W, OUT_H);
    const inset = PAD_MAX * OUT_H;
    expect(box.x).toBeCloseTo(inset);
  });
});

describe('frameRadiusPx', () => {
  it('scales the 1080p-reference radius by output height', () => {
    expect(frameRadiusPx(12, 1080)).toBeCloseTo(12);
    expect(frameRadiusPx(12, 2160)).toBeCloseTo(24);
    expect(frameRadiusPx(12, 540)).toBeCloseTo(6);
  });
});

describe('frame-relative snapping', () => {
  const frame = screenFrameRect(0.05, OUT_W, OUT_H);

  it('snaps the bubble onto the screen-frame corner so it straddles the border', () => {
    const b = bubble({ size: 0.24 });
    const d = 0.24 * Math.min(OUT_W, OUT_H);
    const framed = cornerPosition('bottom-right', b, OUT_W, OUT_H, frame);
    const canvas = cornerPosition('bottom-right', b, OUT_W, OUT_H);
    // The framed anchor sits further toward the edge than the canvas-inset one.
    expect(framed.cx).toBeGreaterThan(canvas.cx);
    expect(framed.cy).toBeGreaterThan(canvas.cy);
    // The bubble extends past the screen-frame edge (overlap onto the backdrop)…
    expect(framed.cx * OUT_W + d / 2).toBeGreaterThan(frame.x + frame.w);
    // …but stays on canvas.
    expect(framed.cx * OUT_W + d / 2).toBeLessThanOrEqual(OUT_W + 1e-6);
    expect(framed.cy * OUT_H + d / 2).toBeLessThanOrEqual(OUT_H + 1e-6);
  });

  it('snapTarget uses the frame anchors when a frame is passed', () => {
    const b = bubble({ size: 0.24 });
    const anchor = cornerPosition('bottom-right', b, OUT_W, OUT_H, frame);
    const near = bubble({ size: 0.24, cx: anchor.cx - 0.005, cy: anchor.cy - 0.005 });
    const snapped = snapTarget(near, OUT_W, OUT_H, frame);
    expect(snapped?.corner).toBe('bottom-right');
    expect(snapped?.cx).toBeCloseTo(anchor.cx);
    expect(snapped?.cy).toBeCloseTo(anchor.cy);
  });
});
