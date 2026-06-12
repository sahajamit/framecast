import type { LibraryItem } from '../types';

const RECORDING_EXT = /\.(mp4|webm|mov)$/i;

export async function scanLibrary(dir: FileSystemDirectoryHandle): Promise<LibraryItem[]> {
  const items: LibraryItem[] = [];
  for await (const entry of dir.values()) {
    if (entry.kind !== 'file' || !RECORDING_EXT.test(entry.name)) continue;
    try {
      const file = await (entry as FileSystemFileHandle).getFile();
      items.push({ name: entry.name, size: file.size, lastModified: file.lastModified });
    } catch {
      // Unreadable entry — skip.
    }
  }
  items.sort((a, b) => b.lastModified - a.lastModified);
  return items;
}

export function formatSize(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
