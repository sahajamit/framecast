export async function deleteFromLibrary(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<void> {
  await dir.removeEntry(name);
}

/** Triggers a regular browser download of a library file. */
export function downloadFile(file: File, name: string): void {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** "name.mp4" -> "name-2.mp4" until it doesn't collide in the folder. */
export async function uniqueName(
  dir: FileSystemDirectoryHandle,
  desired: string,
): Promise<string> {
  const dot = desired.lastIndexOf('.');
  const stem = dot > 0 ? desired.slice(0, dot) : desired;
  const ext = dot > 0 ? desired.slice(dot) : '';
  let candidate = desired;
  for (let i = 2; ; i++) {
    try {
      await dir.getFileHandle(candidate);
      candidate = `${stem}-${i}${ext}`;
    } catch {
      return candidate;
    }
  }
}

export function replaceExt(name: string, ext: string): string {
  const dot = name.lastIndexOf('.');
  return (dot > 0 ? name.slice(0, dot) : name) + ext;
}
