import { del, get, set } from 'idb-keyval';

const DIR_KEY = 'framecast-library-dir';

/** e2e/test mode: back the library with OPFS so no native picker is needed. */
export function isE2E(): boolean {
  return new URLSearchParams(location.search).has('e2e');
}

export async function getSavedDir(): Promise<FileSystemDirectoryHandle | null> {
  if (isE2E()) return opfsLibraryDir();
  try {
    const handle = await get<FileSystemDirectoryHandle>(DIR_KEY);
    return handle ?? null;
  } catch {
    return null;
  }
}

export async function pickLibraryDir(): Promise<FileSystemDirectoryHandle> {
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
  return handle.queryPermission({ mode: 'readwrite' });
}

/** Must be called from a user gesture when permission is in 'prompt' state. */
export async function requestDirPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  return (await handle.requestPermission({ mode: 'readwrite' })) === 'granted';
}

async function opfsLibraryDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle('library', { create: true });
}
