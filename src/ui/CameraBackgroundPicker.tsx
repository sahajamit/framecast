import { useEffect, useRef, useState } from 'react';
import type { CameraBackgroundId } from '../types';
import {
  CAMERA_BACKGROUNDS,
  evictUserBitmap,
  paintCameraBackgroundFill,
  type CameraBg,
} from '../compositor/cameraBackgrounds';
import {
  getUserBackgroundThumb,
  importUserBackground,
  listUserBackgrounds,
  removeUserBackground,
  type UserBgEntry,
} from '../compositor/userBackgrounds';

const SW = 72;
const SH = 54;

/**
 * Chooser for camera backgrounds: the built-in gallery plus the user's own
 * imported images (stored locally in IndexedDB — nothing leaves the machine)
 * and an import tile. Photo scenes render as a real thumbnail; the mid-tone
 * monochromes paint themselves with the same fill used in the recording, so
 * a chip previews the output.
 */
export function CameraBackgroundPicker({
  value,
  onChange,
}: {
  value: CameraBackgroundId;
  onChange: (id: CameraBackgroundId) => void;
}) {
  const [userBgs, setUserBgs] = useState<UserBgEntry[]>([]);
  const [thumbs, setThumbs] = useState<Map<string, string>>(new Map());
  const [importError, setImportError] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  /**
   * id -> object URL for every thumbnail we mint, so cleanup revokes the ones
   * created after the initial load too. Keyed by id rather than held in the
   * `thumbs` state so revoking never depends on a closure's view of it.
   */
  const urlsRef = useRef<Map<string, string>>(new Map());
  /** False once unmounted: never mint a URL nothing will ever revoke. */
  const aliveRef = useRef(true);

  function trackUrl(id: string, blob: Blob): string {
    const stale = urlsRef.current.get(id);
    if (stale) URL.revokeObjectURL(stale);
    const url = URL.createObjectURL(blob);
    urlsRef.current.set(id, url);
    return url;
  }

  function releaseUrl(id: string): void {
    const url = urlsRef.current.get(id);
    if (!url) return;
    URL.revokeObjectURL(url);
    urlsRef.current.delete(id);
  }

  // Load the imported gallery + thumbnails. Object URLs are tracked in a ref
  // and revoked on unmount.
  useEffect(() => {
    aliveRef.current = true;
    const alive = aliveRef;
    const urls = urlsRef;
    void (async () => {
      const entries = await listUserBackgrounds();
      if (!alive.current) return;
      setUserBgs(entries);
      const map = new Map<string, string>();
      for (const e of entries) {
        const blob = await getUserBackgroundThumb(e.id);
        // Re-checked after every await: an unmount partway through this loop
        // has already run cleanup, so a URL minted past this point would
        // never be revoked by anything.
        if (!alive.current) return;
        if (blob) map.set(e.id, trackUrl(e.id, blob));
      }
      setThumbs(map);
    })();
    return () => {
      alive.current = false;
      urls.current.forEach((u) => URL.revokeObjectURL(u));
      urls.current.clear();
    };
  }, []);

  async function onImport(file: File | undefined): Promise<void> {
    if (!file) return;
    setImportError(false);
    try {
      const entry = await importUserBackground(file);
      const blob = await getUserBackgroundThumb(entry.id);
      if (!aliveRef.current) return;
      setUserBgs((prev) => [entry, ...prev]);
      if (blob) {
        // Mint outside the updater: React may re-run or discard updater
        // functions, which would strand or double-create the URL.
        const url = trackUrl(entry.id, blob);
        setThumbs((prev) => new Map(prev).set(entry.id, url));
      }
      onChange(entry.id);
    } catch {
      setImportError(true);
    }
  }

  async function onRemove(id: string): Promise<void> {
    await removeUserBackground(id);
    evictUserBitmap(id);
    setUserBgs((prev) => prev.filter((e) => e.id !== id));
    setThumbs((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
    // Revoke outside the updater, for the same reason as onImport.
    releaseUrl(id);
    // Deleting the active backdrop falls back to a neutral built-in.
    if (value === id) onChange('slate');
  }

  return (
    <div>
      <div className="scene-swatches" role="group" aria-label="Camera backdrop">
        <button
          type="button"
          className="swatch swatch-add"
          aria-label="Import your own image"
          title="Import your own image"
          onClick={() => fileRef.current?.click()}
        >
          <span className="swatch-plus">+</span>
          <span className="swatch-cap">Import</span>
        </button>
        {userBgs.map((e) => (
          <span key={e.id} className="swatch-wrap">
            <button
              type="button"
              className={`swatch ${e.id === value ? 'on' : ''}`}
              aria-pressed={e.id === value}
              aria-label={e.label}
              title={e.label}
              onClick={() => onChange(e.id)}
            >
              {thumbs.get(e.id) ? (
                <img src={thumbs.get(e.id)} alt="" width={SW} height={SH} />
              ) : (
                <span className="swatch-plus">…</span>
              )}
              <span className="swatch-cap">{e.label}</span>
            </button>
            <button
              type="button"
              className="swatch-x"
              aria-label={`Remove ${e.label}`}
              title="Remove"
              onClick={() => void onRemove(e.id)}
            >
              ✕
            </button>
          </span>
        ))}
        {CAMERA_BACKGROUNDS.map((b) => (
          <Swatch key={b.id} bg={b} selected={b.id === value} onSelect={() => onChange(b.id)} />
        ))}
      </div>
      {importError && (
        <p className="mod-hint" role="alert">
          Could not read that file. Try a JPEG, PNG or WebP image.
        </p>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        data-testid="camera-bg-import"
        onChange={(ev) => {
          void onImport(ev.target.files?.[0]);
          ev.target.value = '';
        }}
      />
    </div>
  );
}

function Swatch({
  bg,
  selected,
  onSelect,
}: {
  bg: CameraBg;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={`swatch ${selected ? 'on' : ''}`}
      aria-pressed={selected}
      aria-label={bg.label}
      title={bg.label}
      onClick={onSelect}
    >
      {bg.kind === 'image' ? (
        <img src={bg.url} alt="" width={SW} height={SH} loading="lazy" />
      ) : (
        <SolidSwatch id={bg.id} />
      )}
      <span className="swatch-cap">{bg.label}</span>
    </button>
  );
}

function SolidSwatch({ id }: { id: CameraBackgroundId }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return; // jsdom in component tests
    paintCameraBackgroundFill(ctx, { x: 0, y: 0, w: SW, h: SH }, id);
  }, [id]);
  return <canvas ref={ref} width={SW} height={SH} />;
}
