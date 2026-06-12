/// <reference lib="webworker" />
/**
 * Durable writer for in-progress recordings.
 *
 * FileSystemWritableFileStream (user folders AND OPFS) stages writes in a
 * swap file that only becomes real on close() — a tab crash loses everything.
 * OPFS createSyncAccessHandle() writes in place and flush() makes bytes
 * durable, so an interrupted recording survives as a playable fragmented MP4.
 */

declare const self: DedicatedWorkerGlobalScope;

export const PARTS_DIR = 'parts';
const FLUSH_INTERVAL_MS = 2000;

interface OpenMsg {
  type: 'open';
  id: number;
  name: string;
}
interface WriteMsg {
  type: 'write';
  data: ArrayBuffer;
  position: number;
}
interface FinalizeMsg {
  type: 'finalize';
  id: number;
}
interface DiscardMsg {
  type: 'discard';
  id: number;
}
export type ToDiskWorker = OpenMsg | WriteMsg | FinalizeMsg | DiscardMsg;
export type FromDiskWorker =
  | { type: 'ok'; id: number }
  | { type: 'error'; id: number | null; message: string };

let handle: FileSystemSyncAccessHandle | null = null;
let fileName: string | null = null;
let dirty = false;
let flushTimer: ReturnType<typeof setInterval> | null = null;

function reply(msg: FromDiskWorker): void {
  self.postMessage(msg);
}

async function partsDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(PARTS_DIR, { create: true });
}

self.onmessage = async (event: MessageEvent<ToDiskWorker>) => {
  const msg = event.data;
  try {
    switch (msg.type) {
      case 'open': {
        const dir = await partsDir();
        const fh = await dir.getFileHandle(msg.name, { create: true });
        handle = await fh.createSyncAccessHandle();
        handle.truncate(0);
        fileName = msg.name;
        dirty = false;
        flushTimer = setInterval(() => {
          if (dirty && handle) {
            handle.flush();
            dirty = false;
          }
        }, FLUSH_INTERVAL_MS);
        reply({ type: 'ok', id: msg.id });
        break;
      }
      case 'write': {
        if (!handle) throw new Error('Disk worker: write before open');
        handle.write(new Uint8Array(msg.data), { at: msg.position });
        dirty = true;
        break;
      }
      case 'finalize': {
        closeHandle(true);
        reply({ type: 'ok', id: msg.id });
        break;
      }
      case 'discard': {
        closeHandle(false);
        if (fileName) {
          const dir = await partsDir();
          await dir.removeEntry(fileName).catch(() => {});
          fileName = null;
        }
        reply({ type: 'ok', id: msg.id });
        break;
      }
    }
  } catch (err) {
    reply({
      type: 'error',
      id: 'id' in msg ? msg.id : null,
      message: err instanceof Error ? err.message : String(err),
    });
  }
};

function closeHandle(flush: boolean): void {
  if (flushTimer !== null) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  if (handle) {
    if (flush) handle.flush();
    handle.close();
    handle = null;
  }
}
