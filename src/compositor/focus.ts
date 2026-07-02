import type { FocusMode, ScreenFocus } from '../types';

const easeOut = (t: number): number => 1 - Math.pow(1 - t, 3);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * Eases a ScreenFocus toward a target. Used both in the compositor worker (for
 * the recorded output, frame-driven so it runs even when the tab is hidden) and
 * in the preflight preview's rAF loop, so rehearsal matches the take.
 *
 * Mode can't be interpolated, so it snaps. The one subtlety is exiting: gliding
 * to mode:'none' must keep showing the OUTGOING mode while the region glides
 * back to full, then settle to 'none' — otherwise the screen would jump to
 * full-bleed instantly instead of pulling out smoothly.
 */
export class FocusAnimator {
  current: ScreenFocus;
  private from: ScreenFocus;
  private to: ScreenFocus;
  private settleMode: FocusMode;
  private start = 0;
  private dur = 0;

  constructor(initial: ScreenFocus) {
    this.current = { ...initial };
    this.from = { ...initial };
    this.to = { ...initial };
    this.settleMode = initial.mode;
  }

  /** Retarget. `dur` ms; 0 snaps (reduced motion). `now` = performance.now(). */
  setTarget(target: ScreenFocus, dur: number, now: number): void {
    if (dur <= 0) {
      this.from = { ...target };
      this.to = { ...target };
      this.current = { ...target };
      this.settleMode = target.mode;
      this.dur = 0;
      return;
    }
    this.from = { ...this.current };
    this.settleMode = target.mode;
    // Hold the outgoing mode through a pull-out glide; otherwise snap the mode.
    const glideMode = target.mode === 'none' ? this.from.mode : target.mode;
    this.to = { ...target, mode: glideMode };
    this.start = now;
    this.dur = dur;
  }

  /** Advance to `now`; returns true while still animating. */
  tick(now: number): boolean {
    if (this.dur <= 0 || now >= this.start + this.dur) {
      this.current = { ...this.to, mode: this.settleMode };
      this.dur = 0;
      return false;
    }
    const t = easeOut((now - this.start) / this.dur);
    this.current = {
      mode: this.to.mode,
      cx: lerp(this.from.cx, this.to.cx, t),
      cy: lerp(this.from.cy, this.to.cy, t),
      w: lerp(this.from.w, this.to.w, t),
      h: lerp(this.from.h, this.to.h, t),
    };
    return true;
  }
}
