import type { CameraBackgroundId } from '../types';
// Bundled camera-background photos. These ARE image assets — the deliberate,
// camera-only exception to the flat-PWA / code-drawn-backdrop rule (the same
// exception phase-2 user imports rely on). Resolved through Vite as hashed
// assets. Only the camera bubble uses them; the scene backdrops stay code-drawn.
import homeUrl from '../assets/camera-bg/home.jpg?url';
import libraryUrl from '../assets/camera-bg/library.jpg?url';
import studioUrl from '../assets/camera-bg/studio.jpg?url';
import cafeUrl from '../assets/camera-bg/cafe.jpg?url';
import botanicaUrl from '../assets/camera-bg/botanica.jpg?url';
import workshopUrl from '../assets/camera-bg/workshop.jpg?url';

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

interface BoxPx {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface ImageBg {
  id: CameraBackgroundId;
  label: string;
  kind: 'image';
  url: string;
}
interface SolidBg {
  id: CameraBackgroundId;
  label: string;
  kind: 'solid';
  /** Vertical gradient [top, bottom], mid-tone by design. */
  colors: [string, string];
}
export type CameraBg = ImageBg | SolidBg;

/**
 * The built-in camera backgrounds gallery. Six photographic scenes from
 * different walks of life (so people recognise their own), plus two mid-tone
 * monochromes (neither too dark nor too light) for a clean, neutral look.
 * Append here to grow the gallery — nothing is ever removed.
 */
export const CAMERA_BACKGROUNDS: CameraBg[] = [
  { id: 'home', label: 'Home office', kind: 'image', url: homeUrl },
  { id: 'library', label: 'Library', kind: 'image', url: libraryUrl },
  { id: 'studio', label: 'Studio', kind: 'image', url: studioUrl },
  { id: 'cafe', label: 'Cafe', kind: 'image', url: cafeUrl },
  { id: 'botanica', label: 'Botanica', kind: 'image', url: botanicaUrl },
  { id: 'workshop', label: 'Workshop', kind: 'image', url: workshopUrl },
  { id: 'slate', label: 'Slate', kind: 'solid', colors: ['#4c5661', '#2c343c'] },
  { id: 'sand', label: 'Sand', kind: 'solid', colors: ['#b7a184', '#877053'] },
];

const BY_ID = new Map<string, CameraBg>(CAMERA_BACKGROUNDS.map((b) => [b.id, b]));

/** Neutral fill shown while a photo decodes, so the bubble is never transparent. */
const LOADING_FILL: [string, string] = ['#3a3f45', '#191c1f'];
/** Shown when a user-imported image was deleted out from under the setting. */
const MISSING_FILL: [string, string] = ['#4c5661', '#2c343c'];

function resolve(id: CameraBackgroundId): CameraBg {
  return BY_ID.get(id) ?? CAMERA_BACKGROUNDS[CAMERA_BACKGROUNDS.length - 1]!;
}

export function cameraBackgroundUrl(id: CameraBackgroundId): string | null {
  const bg = resolve(id);
  return bg.kind === 'image' ? bg.url : null;
}

/* ---------- image decode cache (per thread: worker + preview each own one) ---------- */

const bitmaps = new Map<string, ImageBitmap>();
const loading = new Set<string>();

/**
 * Returns the decoded photo if ready, else null and kicks off a one-time async
 * decode. The compositor stays synchronous: it draws the neutral fill until the
 * bitmap lands, then the next frame (frames flow continuously) picks it up.
 */
function bitmapFor(url: string): ImageBitmap | null {
  const cached = bitmaps.get(url);
  if (cached) return cached;
  if (
    !loading.has(url) &&
    typeof fetch !== 'undefined' &&
    typeof createImageBitmap !== 'undefined'
  ) {
    loading.add(url);
    void fetch(url)
      .then((r) => r.blob())
      .then((b) => createImageBitmap(b))
      .then((bmp) => {
        bitmaps.set(url, bmp);
        loading.delete(url);
      })
      .catch(() => loading.delete(url));
  }
  return null;
}

function paintSolid(ctx: Ctx2D, box: BoxPx, colors: [string, string]): void {
  const g = ctx.createLinearGradient(box.x, box.y, box.x, box.y + box.h);
  g.addColorStop(0, colors[0]);
  g.addColorStop(1, colors[1]);
  ctx.fillStyle = g;
  ctx.fillRect(box.x, box.y, box.w, box.h);
}

/** Draws `img` to cover `box`, center-cropped. */
function drawCover(ctx: Ctx2D, img: ImageBitmap, box: BoxPx): void {
  const scale = Math.max(box.w / img.width, box.h / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.drawImage(img, box.x + (box.w - w) / 2, box.y + (box.h - h) / 2, w, h);
}

/* ---------- user-imported images (IndexedDB-backed, per-thread cache) ---------- */

const userBitmaps = new Map<string, ImageBitmap | 'missing'>();
const userLoading = new Set<string>();

/**
 * Same synchronous-paint contract as bitmapFor, but sourced from IndexedDB
 * (which the recording worker shares with the page): returns the decoded
 * bitmap if ready, else kicks off a one-time load and reports the interim
 * state. 'missing' = the image was deleted; callers paint a neutral solid so
 * a stale persisted selection never strands a black bubble.
 */
function userBitmapFor(id: string): ImageBitmap | 'loading' | 'missing' {
  const cached = userBitmaps.get(id);
  if (cached) return cached;
  if (!userLoading.has(id) && typeof createImageBitmap !== 'undefined') {
    userLoading.add(id);
    void import('./userBackgrounds')
      .then((m) => m.getUserBackgroundBlob(id))
      .then(async (blob) => {
        userBitmaps.set(id, blob ? await createImageBitmap(blob) : 'missing');
        userLoading.delete(id);
      })
      .catch(() => {
        userBitmaps.set(id, 'missing');
        userLoading.delete(id);
      });
  }
  return userBitmaps.get(id) ?? 'loading';
}

/** Drops a deleted image from this thread's cache (the UI calls it on remove). */
export function evictUserBitmap(id: string): void {
  const cached = userBitmaps.get(id);
  if (cached && cached !== 'missing') cached.close();
  userBitmaps.delete(id);
}

/**
 * Fills `box` (already clipped by the caller) with the chosen backdrop: a
 * built-in photo cover-fit, a mid-tone monochrome gradient, or a
 * user-imported image resolved from IndexedDB.
 */
export function paintCameraBackgroundFill(ctx: Ctx2D, box: BoxPx, id: CameraBackgroundId): void {
  if (id.startsWith('user:')) {
    const bmp = userBitmapFor(id);
    if (bmp === 'loading') paintSolid(ctx, box, LOADING_FILL);
    else if (bmp === 'missing') paintSolid(ctx, box, MISSING_FILL);
    else drawCover(ctx, bmp, box);
    return;
  }
  const bg = resolve(id);
  if (bg.kind === 'solid') {
    paintSolid(ctx, box, bg.colors);
    return;
  }
  const bmp = bitmapFor(bg.url);
  if (bmp) drawCover(ctx, bmp, box);
  else paintSolid(ctx, box, LOADING_FILL);
}
