import { describe, expect, it } from 'vitest';
import { FocusAnimator } from '../src/compositor/focus';
import { DEFAULT_FOCUS } from '../src/compositor/layout';
import type { ScreenFocus } from '../src/types';

const zoomTo: ScreenFocus = { mode: 'zoom', cx: 0.3, cy: 0.3, w: 0.5, h: 0.5 };
const none: ScreenFocus = { mode: 'none', cx: 0.5, cy: 0.5, w: 1, h: 1 };

describe('FocusAnimator', () => {
  it('snaps when duration is 0 (reduced motion)', () => {
    const a = new FocusAnimator(DEFAULT_FOCUS);
    a.setTarget(zoomTo, 0, 1000);
    expect(a.tick(1000)).toBe(false);
    expect(a.current).toEqual(zoomTo);
  });

  it('eases toward the target and reports animating mid-glide', () => {
    const a = new FocusAnimator(DEFAULT_FOCUS);
    a.setTarget(zoomTo, 400, 1000);
    expect(a.tick(1200)).toBe(true); // halfway in time
    expect(a.current.mode).toBe('zoom');
    expect(a.current.w).toBeLessThan(1);
    expect(a.current.w).toBeGreaterThan(0.5);
  });

  it('settles exactly on the target at the end', () => {
    const a = new FocusAnimator(DEFAULT_FOCUS);
    a.setTarget(zoomTo, 400, 1000);
    expect(a.tick(1400)).toBe(false);
    expect(a.current).toEqual(zoomTo);
  });

  it('glides OUT holding the outgoing mode, then settles to none', () => {
    const a = new FocusAnimator(zoomTo);
    a.setTarget(none, 400, 2000);
    // mid-glide it still renders as zoom, so the screen pulls back rather than jumping
    expect(a.tick(2200)).toBe(true);
    expect(a.current.mode).toBe('zoom');
    expect(a.current.w).toBeGreaterThan(0.5);
    // …then lands on none at the full frame
    expect(a.tick(2400)).toBe(false);
    expect(a.current.mode).toBe('none');
    expect(a.current.w).toBeCloseTo(1);
  });
});
