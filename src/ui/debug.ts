/**
 * Dev-only instrumentation switches, read from the URL. `?dbg=seg` overlays
 * the live matting tier + timings on the preflight stage and logs the
 * recording worker's matting stats to the console — how the cross-device
 * story (issue #11) gets validated on hardware we do not own.
 */
export function isSegDbg(): boolean {
  return (
    typeof location !== 'undefined' &&
    new URLSearchParams(location.search).get('dbg') === 'seg'
  );
}
