import type { StreamTargetChunk } from 'mediabunny';
import type { FromDiskWorker } from './disk.worker';

export const PARTS_DIR = 'parts';

/**
 * Main-thread client for the OPFS disk worker. Exposes a WritableStream that
 * mediabunny's StreamTarget writes {data, position} chunks into.
 */
export class DiskWriterClient {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, { resolve: () => void; reject: (e: Error) => void }>();
  private fatal: Error | null = null;

  constructor() {
    this.worker = new Worker(new URL('./disk.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<FromDiskWorker>) => {
      const msg = event.data;
      if (msg.type === 'ok') {
        this.pending.get(msg.id)?.resolve();
        this.pending.delete(msg.id);
      } else {
        const error = new Error(`Recording disk writer failed: ${msg.message}`);
        if (msg.id !== null) {
          this.pending.get(msg.id)?.reject(error);
          this.pending.delete(msg.id);
        } else {
          this.fatal = error;
        }
      }
    };
  }

  private call(
    msg: { type: 'open'; name: string } | { type: 'finalize' } | { type: 'discard' },
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...msg, id });
    });
  }

  open(name: string): Promise<void> {
    return this.call({ type: 'open', name });
  }

  /** WritableStream for mediabunny's StreamTarget. */
  createWritable(): WritableStream<StreamTargetChunk> {
    return new WritableStream<StreamTargetChunk>({
      write: (chunk) => {
        if (this.fatal) throw this.fatal;
        // Copy: mediabunny may reuse the underlying buffer after write returns.
        const copy = chunk.data.slice();
        this.worker.postMessage({ type: 'write', data: copy.buffer, position: chunk.position }, [
          copy.buffer,
        ]);
      },
    });
  }

  async finalize(): Promise<void> {
    await this.call({ type: 'finalize' });
    this.worker.terminate();
  }

  async discard(): Promise<void> {
    await this.call({ type: 'discard' });
    this.worker.terminate();
  }
}

/** Copies a finalized OPFS part file into the library folder, then removes the part. */
export async function promotePartToLibrary(
  partName: string,
  libraryDir: FileSystemDirectoryHandle,
  finalName: string,
): Promise<FileSystemFileHandle> {
  const root = await navigator.storage.getDirectory();
  const parts = await root.getDirectoryHandle(PARTS_DIR, { create: true });
  const partHandle = await parts.getFileHandle(partName);
  const file = await partHandle.getFile();

  const outHandle = await libraryDir.getFileHandle(finalName, { create: true });
  const writable = await outHandle.createWritable();
  await file.stream().pipeTo(writable);
  await parts.removeEntry(partName).catch(() => {});
  return outHandle;
}
