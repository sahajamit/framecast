import {
  ALL_FORMATS,
  BlobSource,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
  StreamTarget,
} from 'mediabunny';
import type { StreamTargetChunk } from 'mediabunny';
import { uniqueName } from '../library/fileOps';

/**
 * Cuts a recording down to [start, end]. A tail-only cut (start = 0) is a
 * fast packet copy; cutting the head re-encodes video (hardware-accelerated,
 * still faster than real time) so the result starts exactly on your in-point.
 */
export async function trimRecording(
  srcFile: File,
  srcName: string,
  dir: FileSystemDirectoryHandle,
  range: { start: number; end: number },
  onProgress: (fraction: number) => void,
): Promise<{ outName: string }> {
  const input = new Input({ source: new BlobSource(srcFile), formats: ALL_FORMATS });
  const outName = await uniqueName(dir, trimmedName(srcName));
  const outHandle = await dir.getFileHandle(outName, { create: true });
  const writable = await outHandle.createWritable();

  try {
    const output = new Output({
      format: new Mp4OutputFormat(),
      target: new StreamTarget(writable as unknown as WritableStream<StreamTargetChunk>),
    });
    const conversion = await Conversion.init({
      input,
      output,
      trim: { start: range.start, end: range.end },
    });
    conversion.onProgress = (progress) => onProgress(progress);
    await conversion.execute();
  } catch (err) {
    await dir.removeEntry(outName).catch(() => {});
    throw err;
  }
  return { outName };
}

export function isFastTrim(start: number): boolean {
  return start === 0;
}

function trimmedName(name: string): string {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  return `${stem} (trimmed).mp4`;
}
