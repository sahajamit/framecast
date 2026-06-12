import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { runtime } from '../recorder/runtime';
import { connectLibraryDir, openInReview, refreshLibrary, toast } from './controller';
import { formatSize } from '../library/scan';
import { formatDuration, getFileMeta } from '../library/thumbs';
import { downloadFile } from '../library/fileOps';
import type { LibraryItem } from '../types';

export function LibraryScreen() {
  const library = useStore((s) => s.library);

  useEffect(() => {
    void refreshLibrary();
  }, []);

  if (!library.connected) {
    return (
      <div className="max-w-[430px] mx-auto rise-in">
        <div className="panel p-10 flex flex-col items-center gap-4 text-center">
          <h2 className="font-display font-semibold text-xl">Your recordings live in a folder you choose</h2>
          <p className="text-[13px] text-mute">
            framecast streams every take straight to disk — pick (or reconnect) that folder to see
            your library.
          </p>
          <button type="button" className="danger-btn" onClick={() => void connectLibraryDir()}>
            {library.dirName ? `reconnect “${library.dirName}”` : 'choose save folder'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rise-in flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display font-semibold text-lg">
          Library <span className="text-mute font-normal">· {library.dirName}</span>
        </h2>
        <span className="label-mono">{library.items.length} recordings</span>
      </div>
      {library.mode === 'opfs' && (
        <p className="label-mono -mt-2">
          this browser has no folder picker · recordings live in private browser storage · use ↓ to
          export
        </p>
      )}
      {library.items.length === 0 ? (
        <p className="text-[13px] text-mute">No recordings yet — hit Record and make your first take.</p>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {library.items.map((item) => (
            <LibraryCard key={`${item.name}:${item.lastModified}`} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

function LibraryCard({ item }: { item: LibraryItem }) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    let url: string | null = null;
    void (async () => {
      const dir = runtime.libraryDir;
      if (!dir) return;
      try {
        const handle = await dir.getFileHandle(item.name);
        const file = await handle.getFile();
        const meta = await getFileMeta(file, item.name);
        setDuration(meta.duration);
        if (meta.thumb) {
          url = URL.createObjectURL(meta.thumb);
          setThumbUrl(url);
        }
      } catch {
        // File vanished between scan and read.
      }
    })();
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [item.name, item.lastModified]);

  const open = async () => {
    const dir = runtime.libraryDir;
    if (!dir) return;
    try {
      const handle = await dir.getFileHandle(item.name);
      openInReview(handle, item.name);
    } catch {
      toast('Could not open this file.');
      await refreshLibrary();
    }
  };

  return (
    <div className="panel overflow-hidden flex flex-col group">
      <button
        type="button"
        onClick={() => void open()}
        className="relative aspect-video bg-black cursor-pointer"
      >
        {thumbUrl ? (
          <img src={thumbUrl} alt="" className="absolute inset-0 h-full w-full object-contain" />
        ) : (
          <span className="absolute inset-0 grid place-items-center label-mono">no preview</span>
        )}
        <span className="absolute bottom-1.5 right-1.5 font-mono text-[10px] text-[#F5F0E8] bg-black/70 rounded px-1.5 py-0.5">
          {formatDuration(duration)}
        </span>
        <span
          className="absolute inset-0 grid place-items-center bg-black/0 group-hover:bg-black/40
            text-transparent group-hover:text-[#F5F0E8] transition-colors font-mono text-[11px] tracking-[0.15em] uppercase"
        >
          open ▸
        </span>
      </button>
      <div className="p-2.5 flex flex-col gap-1.5">
        <span className="text-[12.5px] truncate" title={item.name}>
          {item.name}
        </span>
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] text-faint">
            {formatSize(item.size)} · {new Date(item.lastModified).toLocaleDateString()}
          </span>
          <div className="flex gap-1">
            <button
              type="button"
              title="Download a copy"
              className="hairline-btn !px-2 !py-1 !text-[10px]"
              onClick={() =>
                void (async () => {
                  const dir = runtime.libraryDir;
                  if (!dir) return;
                  const handle = await dir.getFileHandle(item.name);
                  downloadFile(await handle.getFile(), item.name);
                })()
              }
            >
              ↓
            </button>
            <button
              type="button"
              title="Delete"
              className="hairline-btn !px-2 !py-1 !text-[10px] hover:!border-rec hover:!text-rec"
              onClick={() =>
                void (async () => {
                  const dir = runtime.libraryDir;
                  if (!dir) return;
                  await dir.removeEntry(item.name).catch(() => toast('Delete failed.'));
                  await refreshLibrary();
                })()
              }
            >
              ✕
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
