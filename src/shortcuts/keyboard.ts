import type { SnapCorner } from '../compositor/layout';
import { SNAP_CORNERS } from '../compositor/layout';

export interface ShortcutHandlers {
  togglePause?: () => void;
  stop?: () => void;
  toggleMic?: () => void;
  toggleCamera?: () => void;
  snap?: (corner: SnapCorner) => void;
  resetFocus?: () => void;
}

/**
 * Space = pause/resume · S = stop · M = mic mute · C = camera bubble · 1–4 = snap
 * corners · 0 or Esc = exit the screen zoom/spotlight.
 * Registered on the app window and the PiP deck window.
 */
export function registerShortcuts(win: Window, handlers: ShortcutHandlers): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
    ) {
      return;
    }
    const key = event.key.toLowerCase();
    if (key === ' ') {
      handlers.togglePause?.();
      event.preventDefault();
    } else if (key === 's') {
      handlers.stop?.();
    } else if (key === 'm') {
      handlers.toggleMic?.();
    } else if (key === 'c') {
      handlers.toggleCamera?.();
    } else if (key === '0' || key === 'escape') {
      handlers.resetFocus?.();
    } else if (key >= '1' && key <= '4') {
      const corner = SNAP_CORNERS[Number(key) - 1];
      if (corner) handlers.snap?.(corner);
    }
  };
  win.addEventListener('keydown', onKeyDown);
  return () => win.removeEventListener('keydown', onKeyDown);
}
