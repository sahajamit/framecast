/**
 * Whether the user asked for reduced motion. The compositor worker can't read
 * matchMedia, so the main thread reads it here and passes the result to the
 * worker (and uses it for the preflight preview) — one source of truth for the
 * "glide vs snap" decision on punch-in zoom.
 */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}
