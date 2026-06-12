import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';
import { get, set } from 'idb-keyval';

export interface FileMeta {
  duration: number;
  thumb: Blob | null;
}

/** Duration + a representative-frame thumbnail, cached in IndexedDB by name+mtime. */
export async function getFileMeta(file: File, name: string): Promise<FileMeta> {
  const cacheKey = `meta:${name}:${file.lastModified}:${file.size}`;
  const cached = await get<FileMeta>(cacheKey).catch(() => undefined);
  if (cached) return cached;

  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  let duration = 0;
  let thumb: Blob | null = null;
  try {
    duration = await input.computeDuration();
    const videoTrack = await input.getPrimaryVideoTrack();
    if (videoTrack && (await videoTrack.canDecode())) {
      const sink = new CanvasSink(videoTrack, { width: 480, fit: 'contain' });
      const wrapped = await sink.getCanvas(Math.min(duration * 0.1, 5));
      if (wrapped) {
        const canvas = wrapped.canvas as OffscreenCanvas | HTMLCanvasElement;
        thumb =
          canvas instanceof OffscreenCanvas
            ? await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 })
            : await new Promise<Blob | null>((resolve) =>
                canvas.toBlob(resolve, 'image/jpeg', 0.7),
              );
      }
    }
  } catch {
    // Corrupt or partially-written file — show it without metadata.
  }

  const meta: FileMeta = { duration, thumb };
  await set(cacheKey, meta).catch(() => {});
  return meta;
}

export function formatDuration(seconds: number): string {
  if (!isFinite(seconds) || seconds <= 0) return '—';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}
