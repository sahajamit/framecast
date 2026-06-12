import { describe, expect, it } from 'vitest';
import {
  BUBBLE_MAX_SIZE,
  bubbleRectPx,
  cameraSrcRect,
  clampBubble,
  containRect,
  cornerPosition,
  DEFAULT_BUBBLE,
  hitTest,
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
