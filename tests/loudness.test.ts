import { describe, expect, it } from 'vitest';
import {
  applyGainInPlace,
  gainToTarget,
  measureIntegratedLufs,
  samplePeak,
} from '../src/enhance/loudness';

const RATE = 48000;

function sine(amplitude: number, seconds: number, freq = 997): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < out.length; i++) {
    out[i] = amplitude * Math.sin((2 * Math.PI * freq * i) / RATE);
  }
  return out;
}

describe('measureIntegratedLufs (BS.1770 reference points)', () => {
  // Spec reference: a 0 dBFS 997 Hz sine in one channel reads -3.01 LKFS.
  it('full-scale mono 997 Hz sine ≈ -3.01 LUFS', () => {
    expect(measureIntegratedLufs([sine(1, 5)], RATE)).toBeCloseTo(-3.01, 1);
  });

  it('-20 dBFS mono sine ≈ -23.01 LUFS', () => {
    expect(measureIntegratedLufs([sine(0.1, 5)], RATE)).toBeCloseTo(-23.01, 1);
  });

  it('same sine in both stereo channels gains +3.01 dB', () => {
    const l = sine(0.1, 5);
    const r = sine(0.1, 5);
    expect(measureIntegratedLufs([l, r], RATE)).toBeCloseTo(-20.0, 1);
  });

  it('silence gates to -70', () => {
    expect(measureIntegratedLufs([new Float32Array(RATE * 2)], RATE)).toBe(-70);
  });

  it('gating ignores long silent stretches', () => {
    const tone = sine(0.1, 2);
    const padded = new Float32Array(RATE * 8);
    padded.set(tone, RATE * 3);
    const gated = measureIntegratedLufs([padded], RATE);
    expect(gated).toBeGreaterThan(-26);
    expect(gated).toBeLessThan(-20);
  });
});

describe('gainToTarget', () => {
  it('computes the linear gain to reach -14 LUFS', () => {
    // -23 LUFS -> -14 LUFS = +9 dB = ×2.818, peak stays under -1 dBFS.
    expect(gainToTarget(-23, 0.1, -14)).toBeCloseTo(Math.pow(10, 9 / 20), 3);
  });

  it('caps the gain so peaks stay below -1 dBFS', () => {
    const ceiling = Math.pow(10, -1 / 20);
    expect(gainToTarget(-23, 0.5, -14)).toBeCloseTo(ceiling / 0.5, 3);
  });

  it('attenuates audio that is already too loud', () => {
    expect(gainToTarget(-8, 0.9, -14)).toBeLessThan(1);
  });
});

describe('applyGainInPlace + samplePeak', () => {
  it('round-trips a quiet sine to the target loudness', () => {
    const ch = sine(0.05, 5);
    const lufs = measureIntegratedLufs([ch], RATE);
    const gain = gainToTarget(lufs, samplePeak([ch]), -14);
    applyGainInPlace([ch], gain);
    const after = measureIntegratedLufs([ch], RATE);
    // Quiet source: either exactly -14 or peak-limited just below it.
    expect(after).toBeGreaterThan(-14.6);
    expect(after).toBeLessThan(-13.4);
    expect(samplePeak([ch])).toBeLessThanOrEqual(Math.pow(10, -1 / 20) + 1e-4);
  });
});
