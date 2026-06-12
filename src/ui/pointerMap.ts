/**
 * Maps a pointer event on an element that displays letterboxed content
 * (object-fit: contain) to coordinates in the content's pixel space.
 * Returns null when the pointer is on the letterbox bars.
 */
export function mapPointerToContent(
  event: { clientX: number; clientY: number },
  el: HTMLElement,
  contentW: number,
  contentH: number,
): { x: number; y: number } | null {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0 || contentW === 0 || contentH === 0) return null;
  const scale = Math.min(rect.width / contentW, rect.height / contentH);
  const w = contentW * scale;
  const h = contentH * scale;
  const ox = rect.left + (rect.width - w) / 2;
  const oy = rect.top + (rect.height - h) / 2;
  const x = (event.clientX - ox) / scale;
  const y = (event.clientY - oy) / scale;
  if (x < 0 || y < 0 || x > contentW || y > contentH) return null;
  return { x, y };
}
