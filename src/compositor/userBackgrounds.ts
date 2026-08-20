/**
 * User-imported camera backgrounds (issue #9 phase 2): pick an image once,
 * use it as the virtual backdrop forever. Fully local, like everything else:
 * images live in IndexedDB (origin storage — survives reloads, gone only if
 * the user clears site data), never uploaded anywhere.
 *
 * Storage layout (idb-keyval, shared origin store so the recording worker
 * reads the same data as the preflight UI):
 *   camera-bg:index        UserBgEntry[] (newest first)
 *   camera-bg:img:<id>     full-size Blob, downscaled to ≤1920px and
 *                          re-encoded at import so a 40 MB photo can't bloat
 *                          storage or decode time
 *   camera-bg:thumb:<id>   small Blob for the gallery swatch
 *
 * Ids are namespaced ("user:<random>") so they slot into the existing
 * registry-driven CameraBackgroundId string without schema changes; the
 * painter in cameraBackgrounds.ts resolves the prefix to these blobs.
 */
import { del, get, set, update } from 'idb-keyval';

export const USER_BG_PREFIX = 'user:';

export function isUserBackgroundId(id: string): boolean {
  return id.startsWith(USER_BG_PREFIX);
}

export interface UserBgEntry {
  id: string;
  /** Display label, derived from the imported file name. */
  label: string;
  addedAt: number;
}

const INDEX_KEY = 'camera-bg:index';
const imgKey = (id: string): string => `camera-bg:img:${id}`;
const thumbKey = (id: string): string => `camera-bg:thumb:${id}`;

/** Import bounds: virtual backdrops never need more than ~1080p worth of px. */
const MAX_EDGE = 1920;
const THUMB_EDGE = 192;

/** IndexedDB is absent in jsdom (component tests); degrade to an empty gallery. */
function hasIdb(): boolean {
  return typeof indexedDB !== 'undefined';
}

export async function listUserBackgrounds(): Promise<UserBgEntry[]> {
  if (!hasIdb()) return [];
  return (await get<UserBgEntry[]>(INDEX_KEY)) ?? [];
}

export async function getUserBackgroundBlob(id: string): Promise<Blob | undefined> {
  if (!hasIdb()) return undefined;
  return get<Blob>(imgKey(id));
}

export async function getUserBackgroundThumb(id: string): Promise<Blob | undefined> {
  if (!hasIdb()) return undefined;
  return get<Blob>(thumbKey(id));
}

async function encodeScaled(bitmap: ImageBitmap, maxEdge: number): Promise<Blob> {
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  ctx.drawImage(bitmap, 0, 0, w, h);
  return canvas.convertToBlob({ type: 'image/webp', quality: 0.85 });
}

/**
 * Validates + ingests an image file. Throws on anything undecodable; callers
 * surface that as a toast. Returns the new entry, already persisted and
 * first in the index.
 */
export async function importUserBackground(file: File): Promise<UserBgEntry> {
  const bitmap = await createImageBitmap(file);
  try {
    const [img, thumb] = await Promise.all([
      encodeScaled(bitmap, MAX_EDGE),
      encodeScaled(bitmap, THUMB_EDGE),
    ]);
    const id = `${USER_BG_PREFIX}${crypto.randomUUID()}`;
    const label = (file.name.replace(/\.[^.]+$/, '') || 'Imported').slice(0, 40);
    const entry: UserBgEntry = { id, label, addedAt: Date.now() };
    await set(imgKey(id), img);
    await set(thumbKey(id), thumb);
    // update() reads and writes inside ONE IndexedDB transaction. A plain
    // get-then-set is two, so two imports (or an import racing a removal)
    // interleave and the later write drops the earlier entry, orphaning a
    // blob that no longer appears in the gallery.
    await update<UserBgEntry[]>(INDEX_KEY, (prev) => [entry, ...(prev ?? [])]);
    return entry;
  } finally {
    bitmap.close();
  }
}

export async function removeUserBackground(id: string): Promise<void> {
  if (!hasIdb()) return;
  // Same single-transaction requirement as the import path above.
  await update<UserBgEntry[]>(INDEX_KEY, (prev) => (prev ?? []).filter((e) => e.id !== id));
  await del(imgKey(id));
  await del(thumbKey(id));
}
