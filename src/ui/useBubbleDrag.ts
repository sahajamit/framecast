import { useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react';
import { useStore } from '../state/store';
import { updateBubble } from '../app/controller';
import { clampBubble, hitTest, snapTarget, ZOOM_MAX, ZOOM_MIN, clamp } from '../compositor/layout';
import { mapPointerToContent } from './pointerMap';

/**
 * Drag + scroll-to-zoom behavior for the camera bubble, shared by the
 * preflight stage and the recording deck. The element renders content of
 * size `getContent()` letterboxed inside itself.
 */
export function useBubbleDrag(getContent: () => { w: number; h: number }, enabled: boolean) {
  const [hovering, setHovering] = useState(false);
  const [dragging, setDragging] = useState(false);
  const grab = useRef<{ dx: number; dy: number } | null>(null);

  const bubble = () => useStore.getState().settings.bubble;

  function locate(e: ReactPointerEvent | ReactWheelEvent) {
    const { w, h } = getContent();
    return { point: mapPointerToContent(e, e.currentTarget as HTMLElement, w, h), w, h };
  }

  function onPointerDown(e: ReactPointerEvent) {
    if (!enabled) return;
    const { point, w, h } = locate(e);
    if (!point || !hitTest(point.x, point.y, bubble(), w, h)) return;
    grab.current = { dx: point.x - bubble().cx * w, dy: point.y - bubble().cy * h };
    setDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function onPointerMove(e: ReactPointerEvent) {
    if (!enabled) return;
    const { point, w, h } = locate(e);
    if (!dragging || !grab.current) {
      setHovering(!!point && hitTest(point?.x ?? -1, point?.y ?? -1, bubble(), w, h));
      return;
    }
    if (!point) return;
    const next = clampBubble(
      { ...bubble(), cx: (point.x - grab.current.dx) / w, cy: (point.y - grab.current.dy) / h },
      w,
      h,
    );
    updateBubble({ cx: next.cx, cy: next.cy });
  }

  function onPointerUp() {
    if (!dragging) return;
    setDragging(false);
    grab.current = null;
    const { w, h } = getContent();
    const snapped = snapTarget(bubble(), w, h);
    if (snapped) updateBubble({ cx: snapped.cx, cy: snapped.cy });
  }

  function onWheel(e: ReactWheelEvent) {
    if (!enabled) return;
    const { point, w, h } = locate(e);
    if (!point || !hitTest(point.x, point.y, bubble(), w, h)) return;
    const zoom = clamp(bubble().zoom - e.deltaY * 0.0016, ZOOM_MIN, ZOOM_MAX);
    updateBubble({ zoom });
  }

  return {
    handlers: { onPointerDown, onPointerMove, onPointerUp, onWheel },
    cursor: dragging ? 'grabbing' : hovering ? 'grab' : 'default',
  };
}
