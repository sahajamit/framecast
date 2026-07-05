import { describe, expect, it } from 'vitest';
import {
  capTier,
  HIGH_TIER_ENABLED,
  pickTier,
  QualityGovernor,
  TIER_CONFIG,
  tierAbove,
  tierBelow,
} from '../src/compositor/matting/tiers';

// While the RVM/WebGPU tier is gated off (ort-web recurrent-path bug, see
// tiers.ts), WebGPU devices land on balanced; these expectations flip
// automatically when the flag is re-enabled.
const WEBGPU_TIER = HIGH_TIER_ENABLED ? 'high' : 'balanced';

describe('tier ordering', () => {
  it('walks down high → balanced → lite → floor → null', () => {
    expect(tierBelow('high')).toBe('balanced');
    expect(tierBelow('balanced')).toBe('lite');
    expect(tierBelow('lite')).toBe('floor');
    expect(tierBelow('floor')).toBeNull();
  });
  it('walks up floor → lite → balanced → high → null', () => {
    expect(tierAbove('floor')).toBe('lite');
    expect(tierAbove('high')).toBeNull();
  });
  it('caps but never raises', () => {
    expect(capTier('high', 'balanced')).toBe('balanced');
    expect(capTier('lite', 'balanced')).toBe('lite');
  });
});

describe('pickTier — capability × quality matrix', () => {
  const webgpu = { webgpu: true, webgl2: true };
  const webgl = { webgpu: false, webgl2: true };
  const cpu = { webgpu: false, webgl2: false };

  it('auto follows capability', () => {
    expect(pickTier('auto', webgpu)).toBe(WEBGPU_TIER);
    expect(pickTier('auto', webgl)).toBe('balanced');
    expect(pickTier('auto', cpu)).toBe('lite');
  });
  it('high degrades to what the device has', () => {
    expect(pickTier('high', webgpu)).toBe(WEBGPU_TIER);
    expect(pickTier('high', webgl)).toBe('balanced');
    expect(pickTier('high', cpu)).toBe('lite');
  });
  it('explicit lower tiers are honored on capable devices', () => {
    expect(pickTier('balanced', webgpu)).toBe('balanced');
    expect(pickTier('lite', webgpu)).toBe('lite');
  });
  it('maxTier caps the preview at balanced (plan Q6)', () => {
    expect(pickTier('auto', webgpu, 'balanced')).toBe('balanced');
    expect(pickTier('high', webgpu, 'balanced')).toBe('balanced');
    expect(pickTier('lite', webgpu, 'balanced')).toBe('lite');
  });
});

/** Drives the governor with uniform samples across a simulated time span. */
function drive(
  gov: QualityGovernor,
  opts: { drawMs: number; from: number; to: number; frameBudget?: number },
): string[] {
  const decisions: string[] = [];
  for (let t = opts.from; t <= opts.to; t += 100) {
    // Enough samples for the EMA to reflect the level being fed.
    for (let i = 0; i < 5; i++) gov.noteDraw(opts.drawMs);
    const d = gov.decide(t, opts.frameBudget ?? 33.3);
    if (d !== 'hold') decisions.push(`${t}:${d}`);
  }
  return decisions;
}

describe('QualityGovernor', () => {
  const cfg = TIER_CONFIG.balanced;

  it('downshifts only after sustained overrun (~1.5s), not on a spike', () => {
    const gov = new QualityGovernor();
    gov.configure(cfg, 33.3);
    // One burst of slow draws then healthy again: no demotion.
    for (let i = 0; i < 5; i++) gov.noteDraw(60);
    expect(gov.decide(0, 33.3)).toBe('hold');
    const clean = drive(gov, { drawMs: 5, from: 100, to: 1400 });
    expect(clean).toEqual([]);
  });

  it('downshifts after continuous overrun', () => {
    const gov = new QualityGovernor();
    gov.configure(cfg, 33.3);
    const d = drive(gov, { drawMs: 40, from: 0, to: 2500 });
    expect(d.some((x) => x.endsWith(':down'))).toBe(true);
  });

  it('upshifts only after ~20s of clear headroom', () => {
    const gov = new QualityGovernor();
    gov.configure(cfg, 33.3);
    const early = drive(gov, { drawMs: 3, from: 0, to: 15_000 });
    expect(early).toEqual([]);
    const later = drive(gov, { drawMs: 3, from: 15_100, to: 25_000 });
    expect(later.some((x) => x.endsWith(':up'))).toBe(true);
  });

  it('never upshifts while recording, but still downshifts', () => {
    const gov = new QualityGovernor();
    gov.configure(cfg, 33.3);
    gov.setRecording(true);
    expect(drive(gov, { drawMs: 3, from: 0, to: 30_000 })).toEqual([]);
    const down = drive(gov, { drawMs: 40, from: 30_100, to: 33_000 });
    expect(down.some((x) => x.endsWith(':down'))).toBe(true);
  });

  it('slow inference alone (draw healthy) also demotes', () => {
    const gov = new QualityGovernor();
    gov.configure(TIER_CONFIG.lite, 33.3); // 66ms cadence → ~56ms budget
    const decisions: string[] = [];
    for (let t = 0; t <= 2500; t += 100) {
      for (let i = 0; i < 5; i++) {
        gov.noteDraw(4);
        gov.noteInfer(90);
      }
      const d = gov.decide(t, 33.3);
      if (d !== 'hold') decisions.push(d);
    }
    expect(decisions).toContain('down');
  });
});
