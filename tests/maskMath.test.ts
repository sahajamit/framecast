import { describe, expect, it } from 'vitest';
import { emaBlend, shapeToBytes, EMA_BASE, EMA_MAX } from '../src/compositor/matting/maskMath';

describe('emaBlend — motion-aware temporal smoothing', () => {
  it('barely moves on tiny changes (shimmer suppression)', () => {
    const prev = new Float32Array([0.5]);
    const cur = new Float32Array([0.52]);
    emaBlend(prev, cur);
    // Small delta → blend ≈ EMA_BASE → most of the old value survives.
    expect(prev[0]).toBeGreaterThan(0.5);
    expect(prev[0]).toBeLessThan(0.5 + 0.02 * (EMA_BASE + 0.1));
  });

  it('follows large changes almost immediately (no motion smear)', () => {
    const prev = new Float32Array([0]);
    const cur = new Float32Array([1]);
    emaBlend(prev, cur);
    expect(prev[0]).toBeGreaterThanOrEqual(EMA_MAX - 1e-6);
  });

  it('converges to a constant input', () => {
    const prev = new Float32Array([0]);
    const cur = new Float32Array([0.8]);
    for (let i = 0; i < 30; i++) emaBlend(prev, cur);
    expect(prev[0]).toBeCloseTo(0.8, 3);
  });

  it('is elementwise over the whole buffer', () => {
    const prev = new Float32Array([0, 1, 0.5]);
    const cur = new Float32Array([1, 0, 0.5]);
    emaBlend(prev, cur);
    expect(prev[0]).toBeGreaterThan(0.8);
    expect(prev[1]).toBeLessThan(0.2);
    expect(prev[2]).toBeCloseTo(0.5, 6);
  });
});

describe('shapeToBytes — sigmoid confidence shaping', () => {
  it('maps the endpoints exactly (0 → 0, 1 → 255) and the midpoint neutral', () => {
    const src = new Float32Array([0, 0.5, 1]);
    const out = new Uint8Array(3);
    shapeToBytes(src, out);
    // Exact endpoints: anything else bleeds the raw room through backdrops
    // (background alpha > 0) or makes the person translucent (core < 255).
    expect(out[0]).toBe(0);
    expect([127, 128]).toContain(out[1]); // fp rounding lands on either side
    expect(out[2]).toBe(255);
  });

  it('compresses the uncertain band toward the edges', () => {
    const src = new Float32Array([0.3, 0.7]);
    const out = new Uint8Array(2);
    shapeToBytes(src, out);
    // 0.3/0.7 confidence become much closer to 0/255 than a linear map would.
    expect(out[0]!).toBeLessThan(0.3 * 255 - 20);
    expect(out[1]!).toBeGreaterThan(0.7 * 255 + 20);
  });

  it('is monotonic', () => {
    const src = new Float32Array(101);
    for (let i = 0; i <= 100; i++) src[i] = i / 100;
    const out = new Uint8Array(101);
    shapeToBytes(src, out);
    for (let i = 1; i <= 100; i++) expect(out[i]!).toBeGreaterThanOrEqual(out[i - 1]!);
  });
});
