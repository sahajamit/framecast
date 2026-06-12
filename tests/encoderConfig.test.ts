import { describe, expect, it } from 'vitest';
import { outputDims, PRESETS } from '../src/recorder/encoderConfig';

describe('outputDims', () => {
  it('keeps the source aspect ratio while fitting the preset box', () => {
    // 16:10 MacBook screen into the 1440p preset.
    const { w, h } = outputDims(3456, 2234, PRESETS['1440p30']);
    expect(h).toBeLessThanOrEqual(1440);
    expect(w).toBeLessThanOrEqual(2560);
    expect(w / h).toBeCloseTo(3456 / 2234, 2);
  });

  it('never upscales a small source', () => {
    const { w, h } = outputDims(1280, 720, PRESETS['1440p30']);
    expect(w).toBe(1280);
    expect(h).toBe(720);
  });

  it('returns even dimensions for the encoder', () => {
    const { w, h } = outputDims(1337, 999, PRESETS['1080p30']);
    expect(w % 2).toBe(0);
    expect(h % 2).toBe(0);
  });

  it('caps an ultrawide source by width', () => {
    const { w, h } = outputDims(5120, 1440, PRESETS['1440p30']);
    expect(w).toBe(2560);
    expect(h).toBeLessThanOrEqual(1440);
    expect(w / h).toBeCloseTo(5120 / 1440, 1);
  });
});
