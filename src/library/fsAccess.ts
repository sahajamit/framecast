import { del, get, set } from 'idb-keyval';

const DIR_KEY = 'framecast-library-dir';

export type LibraryMode = 'folder' | 'opfs';

/** e2e/test mode: back the library with OPFS so no native picker is needed. */
export function isE2E(): boolean {
  return new URLSearchParams(location.search).has('e2e');
}

/** Brave (and others) ship with the File System Access picker disabled. */
export function supportsFSA(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

/**
 * Pure mode resolution (unit-tested): a user-picked folder needs the FSA
 * picker; otherwise recordings live in the browser's private storage (OPFS)
 * and the Download button is the export path.
 */
export function resolveLibraryMode(hasFSA: boolean, e2e: boolean): LibraryMode {
  return hasFSA && !e2e ? 'folder' : 'opfs';
}

export function libraryMode(): LibraryMode {
  return resolveLibraryMode(supportsFSA(), isE2E());
}

export const OPFS_DIR_LABEL = 'browser storage';

export async function getSavedDir(): Promise<FileSystemDirectoryHandle | null> {
  if (libraryMode() === 'opfs') return opfsLibraryDir();
  try {
    const handle = await get<FileSystemDirectoryHandle>(DIR_KEY);
    return handle ?? null;
  } catch {
    return null;
  }
}

export async function pickLibraryDir(): Promise<FileSystemDirectoryHandle> {
  if (!supportsFSA()) {
    throw new Error('This browser cannot open a folder picker (File System Access API is off).');
  }
  const handle = await showDirectoryPicker({
    id: 'framecast-library',
    mode: 'readwrite',
    startIn: 'videos',
  });
  await set(DIR_KEY, handle);
  return handle;
}

export async function forgetLibraryDir(): Promise<void> {
  await del(DIR_KEY);
}

export async function queryDirPermission(
  handle: FileSystemDirectoryHandle,
): Promise<PermissionState> {
  if (libraryMode() === 'opfs') return 'granted';
  return handle.queryPermission({ mode: 'readwrite' });
}

/** Must be called from a user gesture when permission is in 'prompt' state. */
export async function requestDirPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  return (await handle.requestPermission({ mode: 'readwrite' })) === 'granted';
}

/** Ask the browser not to evict OPFS recordings under storage pressure. */
export async function requestPersistence(): Promise<void> {
  try {
    await navigator.storage?.persist?.();
  } catch {
    // Best effort only.
  }
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    return { usage, quota };
  } catch {
    return null;
  }
}

async function opfsLibraryDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle('library', { create: true });
}
