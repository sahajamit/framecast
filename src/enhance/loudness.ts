/**
 * ITU-R BS.1770-4 integrated loudness (the measure behind YouTube's -14 LUFS
 * normalization), implemented from the spec: K-weighting prefilter, 400 ms
 * gating blocks with 75% overlap, -70 LUFS absolute gate and -10 LU relative
 * gate. Pure functions — covered by unit tests with known sine-wave vectors.
 */

interface BiquadCoeffs {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/** +4 dB high-shelf ("head effect") stage of the K-weighting filter. */
function shelfCoeffs(sampleRate: number): BiquadCoeffs {
  const f0 = 1681.974450955533;
  const G = 3.999843853973347;
  const Q = 0.7071752369554196;
  const K = Math.tan((Math.PI * f0) / sampleRate);
  const Vh = Math.pow(10, G / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  const a0 = 1 + K / Q + K * K;
  return {
    b0: (Vh + (Vb * K) / Q + K * K) / a0,
    b1: (2 * (K * K - Vh)) / a0,
    b2: (Vh - (Vb * K) / Q + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  };
}

/** RLB high-pass stage of the K-weighting filter. */
function highpassCoeffs(sampleRate: number): BiquadCoeffs {
  const f0 = 38.13547087602444;
  const Q = 0.5003270373238773;
  const K = Math.tan((Math.PI * f0) / sampleRate);
  const a0 = 1 + K / Q + K * K;
  return {
    b0: 1,
    b1: -2,
    b2: 1,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  };
}

function filterInPlace(samples: Float32Array, c: BiquadCoeffs): void {
  let x1 = 0,
    x2 = 0,
    y1 = 0,
    y2 = 0;
  for (let i = 0; i < samples.length; i++) {
    const x0 = samples[i] ?? 0;
    const y0 = c.b0 * x0 + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    samples[i] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }
}

const ABSOLUTE_GATE_LUFS = -70;
const BLOCK_MS = 400;
const HOP_MS = 100;

/** Integrated loudness in LUFS. Returns -70 for silence. */
export function measureIntegratedLufs(channels: Float32Array[], sampleRate: number): number {
  if (channels.length === 0 || (channels[0]?.length ?? 0) === 0) return ABSOLUTE_GATE_LUFS;

  const shelf = shelfCoeffs(sampleRate);
  const highpass = highpassCoeffs(sampleRate);
  // K-weight a copy of every channel.
  const weighted = channels.map((ch) => {
    const copy = new Float32Array(ch);
    filterInPlace(copy, shelf);
    filterInPlace(copy, highpass);
    return copy;
  });

  const blockLen = Math.round((BLOCK_MS / 1000) * sampleRate);
  const hopLen = Math.round((HOP_MS / 1000) * sampleRate);
  const length = weighted[0]?.length ?? 0;
  if (length < blockLen) return ABSOLUTE_GATE_LUFS;

  // Mean-square power per gating block, summed over channels (G_i = 1 for L/R).
  const blockPowers: number[] = [];
  for (let start = 0; start + blockLen <= length; start += hopLen) {
    let power = 0;
    for (const ch of weighted) {
      let sum = 0;
      for (let i = start; i < start + blockLen; i++) {
        const v = ch[i] ?? 0;
        sum += v * v;
      }
      power += sum / blockLen;
    }
    blockPowers.push(power);
  }
  if (blockPowers.length === 0) return ABSOLUTE_GATE_LUFS;

  const toLufs = (power: number) => -0.691 + 10 * Math.log10(power);
  const absGated = blockPowers.filter((p) => p > 0 && toLufs(p) > ABSOLUTE_GATE_LUFS);
  if (absGated.length === 0) return ABSOLUTE_GATE_LUFS;

  const meanAbs = absGated.reduce((a, b) => a + b, 0) / absGated.length;
  const relativeGate = toLufs(meanAbs) - 10;
  const relGated = absGated.filter((p) => toLufs(p) > relativeGate);
  if (relGated.length === 0) return ABSOLUTE_GATE_LUFS;

  const mean = relGated.reduce((a, b) => a + b, 0) / relGated.length;
  return toLufs(mean);
}

export function samplePeak(channels: Float32Array[]): number {
  let peak = 0;
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) {
      const v = Math.abs(ch[i] ?? 0);
      if (v > peak) peak = v;
    }
  }
  return peak;
}

const PEAK_CEILING = Math.pow(10, -1 / 20); // -1 dBFS

/** Linear gain that hits the target loudness without pushing peaks past -1 dBFS. */
export function gainToTarget(lufs: number, peak: number, targetLufs = -14): number {
  const gain = Math.pow(10, (targetLufs - lufs) / 20);
  if (peak <= 0) return gain;
  return Math.min(gain, PEAK_CEILING / peak);
}

export function applyGainInPlace(channels: Float32Array[], gain: number): void {
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) {
      ch[i] = (ch[i] ?? 0) * gain;
    }
  }
}
