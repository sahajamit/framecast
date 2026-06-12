/** RMS level in [0, 1] plus dBFS, read from an AnalyserNode time-domain tap. */
export function readLevel(
  analyser: AnalyserNode,
  scratch?: Float32Array<ArrayBuffer>,
): { rms: number; db: number } {
  const buf = scratch ?? new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = buf[i] ?? 0;
    sum += v * v;
  }
  const rms = Math.sqrt(sum / buf.length);
  const db = rms > 0 ? 20 * Math.log10(rms) : -Infinity;
  return { rms, db };
}

/** Maps dBFS to a 0..1 meter position (-60 dB floor). */
export function meterPosition(db: number): number {
  if (!isFinite(db)) return 0;
  return Math.min(1, Math.max(0, (db + 60) / 60));
}
