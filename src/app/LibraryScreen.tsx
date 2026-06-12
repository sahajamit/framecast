import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { runtime } from '../recorder/runtime';
import { connectLibraryDir, openInReview, refreshLibrary, toast } from './controller';
import { formatSize } from '../library/scan';
import { formatDuration, getFileMeta } from '../library/thumbs';
import { downloadFile } from '../library/fileOps';
import { Lamp } from '../ui/controls';
import type { LibraryItem } from '../types';

export function LibraryScreen() {
  const library = useStore((s) => s.library);
  const setView = useStore((s) => s.setView);

  useEffect(() => {
    void refreshLibrary();
  }, []);

  const totalBytes = library.items.reduce((sum, item) => sum + item.size, 0);

  if (!library.connected) {
    return (
      <div className="rise-in">
        <div className="banner">
          <Lamp kind="warn" />
          <div className="b-msg">
            <b>Folder disconnected</b>
            The browser needs permission to re-open your takes folder. Your takes are safe on disk
            — reconnect to list them.
          </div>
          <div className="b-actions">
            <button type="button" className="btn primary" onClick={() => void connectLibraryDir()}>
              Reconnect folder
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rise-in flex flex-col gap-4">
      <div className="flex items-center gap-4 flex-wrap">
        <span className="lib-title">Tape library</span>
        <span className="lib-count">
          {library.items.length} {library.items.length === 1 ? 'take' : 'takes'}
          {totalBytes > 0 && ` · ${formatSize(totalBytes)}`}
        </span>
        <div className="flex-1" />
        <div className="storage-note">
          <Lamp size={7} />
          <span className="truncate">
            {library.mode === 'opfs' ? (
              <>Browser storage · <b>use ↓ to export</b> · direct to disk</>
            ) : (
              <>Folder · <b>{library.dirName}</b> · direct to disk</>
            )}
          </span>
        </div>
        <button type="button" className="btn" onClick={() => setView('record')}>
          Roll new take
        </button>
      </div>

      {library.items.length === 0 ? (
        <div className="lib-empty">
          <div className="reel" />
          <b>No takes on the shelf</b>
          <span>Your first recording lands here — straight to your disk</span>
          <button type="button" className="btn primary mt-2.5" onClick={() => setView('record')}>
            Roll your first take
          </button>
        </div>
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
    <div className="take-card">
      <button type="button" className="thumb force-dark" onClick={() => void open()} title="Open in review">
        {thumbUrl && <img src={thumbUrl} alt="" />}
        <span className="dur">{formatDuration(duration)}</span>
      </button>
      <div className="tc-name" title={item.name}>
        {item.name}
      </div>
      <div className="tc-meta">
        <span>{new Date(item.lastModified).toLocaleDateString()}</span>
        <span>{formatSize(item.size)}</span>
      </div>
      <div className="tc-actions">
        <button
          type="button"
          className="btn-s"
          title="Download a copy"
          onClick={() =>
            void (async () => {
              const dir = runtime.libraryDir;
              if (!dir) return;
              const handle = await dir.getFileHandle(item.name);
              downloadFile(await handle.getFile(), item.name);
            })()
          }
        >
          ↓ Download
        </button>
        <button
          type="button"
          className="btn-s danger"
          title="Delete"
          onClick={() =>
            void (async () => {
              const dir = runtime.libraryDir;
              if (!dir) return;
              await dir.removeEntry(item.name).catch(() => toast('Delete failed.'));
              await refreshLibrary();
            })()
          }
        >
          Delete
        </button>
      </div>
    </div>
  );
}
