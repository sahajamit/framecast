import { useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react';
import { useStore } from '../state/store';
import { resetFocus, updateBubble, updateFocus } from '../app/controller';
import {
  clamp,
  clampBubble,
  FOCUS_ZOOM_MAX,
  focusForZoom,
  focusZoomFactor,
  hitTest,
  normalizeFocusRect,
  screenContentRect,
  snapTarget,
  ZOOM_MAX,
  ZOOM_MIN,
} from '../compositor/layout';
import type { Box } from '../compositor/layout';
import { mapPointerToContent } from './pointerMap';

/** The armed focus drawing tool on a stage. */
export type FocusTool = 'off' | 'zoom' | 'spotlight';

export interface MarqueeRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface Opts {
  /** Camera bubble can be grabbed/dragged. */
  bubbleEnabled: boolean;
  /** Focus boxes can be drawn (during a take, or rehearsing with a live screen). */
  focusEnabled: boolean;
  getTool: () => FocusTool;
  /** Inset screen frame (content px) for bubble snap, when scene framing is on. */
  getFrame?: () => Box | undefined;
}

const DEGENERATE = 0.03; // a box smaller than this in both axes is a click
const DEFAULT_SPOTLIGHT = 0.4;

/**
 * Pointer behavior for the preview stage, shared by the deck and preflight:
 * drag the camera bubble (grab it), or draw a focus region (zoom / spotlight)
 * anywhere else, plus scroll-to-zoom. A click (degenerate drag) punches in
 * centered on the point. Commits on pointer-up so the recording doesn't lurch
 * mid-drag; a marquee shows the box while drawing.
 */
export function useStageGestures(getContent: () => { w: number; h: number }, opts: Opts) {
  const [hovering, setHovering] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [marquee, setMarquee] = useState<MarqueeRect | null>(null);
  const grab = useRef<{ dx: number; dy: number } | null>(null);
  const focusStart = useRef<{ x: number; y: number } | null>(null);
  const lastZoom = useRef(2);

  const bubble = () => useStore.getState().settings.bubble;
  const pad = () => useStore.getState().settings.frame.pad;

  function elPoint(e: ReactPointerEvent): { x: number; y: number } {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function contentPoint(e: ReactPointerEvent | ReactWheelEvent) {
    const { w, h } = getContent();
    return { point: mapPointerToContent(e, e.currentTarget as HTMLElement, w, h), w, h };
  }

  /** Element px → screen-content normalized (0..1), clamped onto the screen. */
  function toScreenNorm(elx: number, ely: number, el: HTMLElement): { nx: number; ny: number } {
    const { w, h } = getContent();
    const r = el.getBoundingClientRect();
    const scale = Math.min(r.width / w, r.height / h);
    const ox = (r.width - w * scale) / 2;
    const oy = (r.height - h * scale) / 2;
    const cxPx = clamp((elx - ox) / scale, 0, w);
    const cyPx = clamp((ely - oy) / scale, 0, h);
    const sc = screenContentRect(pad(), w, h);
    return { nx: clamp((cxPx - sc.x) / sc.w, 0, 1), ny: clamp((cyPx - sc.y) / sc.h, 0, 1) };
  }

  function onPointerDown(e: ReactPointerEvent) {
    const { point, w, h } = contentPoint(e);
    if (opts.bubbleEnabled && point && hitTest(point.x, point.y, bubble(), w, h)) {
      grab.current = { dx: point.x - bubble().cx * w, dy: point.y - bubble().cy * h };
      setDragging(true);
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    if (opts.focusEnabled && opts.getTool() !== 'off') {
      const p = elPoint(e);
      focusStart.current = p;
      setMarquee({ left: p.x, top: p.y, width: 0, height: 0 });
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      e.preventDefault();
    }
  }

  function onPointerMove(e: ReactPointerEvent) {
    if (dragging && grab.current) {
      const { point, w, h } = contentPoint(e);
      if (!point) return;
      const next = clampBubble(
        { ...bubble(), cx: (point.x - grab.current.dx) / w, cy: (point.y - grab.current.dy) / h },
        w,
        h,
      );
      updateBubble({ cx: next.cx, cy: next.cy });
      return;
    }
    if (focusStart.current) {
      const p = elPoint(e);
      const s = focusStart.current;
      setMarquee({
        left: Math.min(s.x, p.x),
        top: Math.min(s.y, p.y),
        width: Math.abs(p.x - s.x),
        height: Math.abs(p.y - s.y),
      });
      return;
    }
    const { point, w, h } = contentPoint(e);
    setHovering(opts.bubbleEnabled && !!point && hitTest(point.x, point.y, bubble(), w, h));
  }

  function onPointerUp(e: ReactPointerEvent) {
    if (dragging) {
      setDragging(false);
      grab.current = null;
      const { w, h } = getContent();
      const snapped = snapTarget(bubble(), w, h, opts.getFrame?.());
      if (snapped) updateBubble({ cx: snapped.cx, cy: snapped.cy });
      return;
    }
    if (!focusStart.current) return;
    const tool = opts.getTool();
    const el = e.currentTarget as HTMLElement;
    const s = focusStart.current;
    const p = elPoint(e);
    focusStart.current = null;
    setMarquee(null);
    if (tool === 'off') return;

    const a = toScreenNorm(s.x, s.y, el);
    const b = toScreenNorm(p.x, p.y, el);
    const raw = {
      cx: (a.nx + b.nx) / 2,
      cy: (a.ny + b.ny) / 2,
      w: Math.abs(b.nx - a.nx),
      h: Math.abs(b.ny - a.ny),
    };
    if (raw.w < DEGENERATE && raw.h < DEGENERATE) {
      // A click: punch in (or spotlight a default region) centered on the point.
      if (tool === 'zoom') {
        updateFocus(focusForZoom(lastZoom.current, raw.cx, raw.cy));
      } else {
        updateFocus(
          normalizeFocusRect(
            { cx: raw.cx, cy: raw.cy, w: DEFAULT_SPOTLIGHT, h: DEFAULT_SPOTLIGHT },
            'spotlight',
          ),
        );
      }
      return;
    }
    const f = normalizeFocusRect(raw, tool);
    updateFocus(f);
    if (tool === 'zoom') lastZoom.current = focusZoomFactor(f);
  }

  function onWheel(e: ReactWheelEvent) {
    const { point, w, h } = contentPoint(e);
    if (!point) return;
    if (opts.bubbleEnabled && hitTest(point.x, point.y, bubble(), w, h)) {
      updateBubble({ zoom: clamp(bubble().zoom - e.deltaY * 0.0016, ZOOM_MIN, ZOOM_MAX) });
      return;
    }
    if (!opts.focusEnabled) return;
    const sc = screenContentRect(pad(), w, h);
    const nx = clamp((point.x - sc.x) / sc.w, 0, 1);
    const ny = clamp((point.y - sc.y) / sc.h, 0, 1);
    const cur = focusZoomFactor(useStore.getState().focus);
    const next = clamp(cur - e.deltaY * 0.0016, 1, FOCUS_ZOOM_MAX);
    if (next <= 1.001) {
      resetFocus();
    } else {
      updateFocus(focusForZoom(next, nx, ny));
      lastZoom.current = next;
    }
  }

  const armed = opts.focusEnabled && opts.getTool() !== 'off';
  const cursor = dragging
    ? 'grabbing'
    : marquee || armed
      ? 'crosshair'
      : hovering
        ? 'grab'
        : 'default';

  return {
    handlers: { onPointerDown, onPointerMove, onPointerUp, onWheel },
    cursor,
    marquee,
  };
}
