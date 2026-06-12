import { ALL_FORMATS, BlobSource, Input } from 'mediabunny';
import { runtime } from '../recorder/runtime';
import { isE2E } from '../library/fsAccess';

interface InspectResult {
  duration: number;
  video: { codec: string | null; width: number; height: number; duration: number } | null;
  audio: { codec: string | null; duration: number } | null;
}

declare global {
  interface Window {
    __framecast?: {
      inspectFile(name: string): Promise<InspectResult>;
      listLibrary(): Promise<string[]>;
    };
  }
}

/** Playwright hooks, exposed only in ?e2e=1 mode. */
export function installTestHook(): void {
  if (!isE2E()) return;
  window.__framecast = {
    async inspectFile(name) {
      const dir = runtime.libraryDir;
      if (!dir) throw new Error('library not connected');
      const handle = await dir.getFileHandle(name);
      const file = await handle.getFile();
      const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
      const duration = await input.computeDuration();
      const video = await input.getPrimaryVideoTrack();
      const audio = await input.getPrimaryAudioTrack();
      return {
        duration,
        video: video
          ? {
              codec: video.codec,
              width: video.displayWidth,
              height: video.displayHeight,
              duration: await video.computeDuration(),
            }
          : null,
        audio: audio ? { codec: audio.codec, duration: await audio.computeDuration() } : null,
      };
    },
    async listLibrary() {
      const dir = runtime.libraryDir;
      if (!dir) return [];
      const names: string[] = [];
      for await (const entry of dir.values()) {
        if (entry.kind === 'file') names.push(entry.name);
      }
      return names.sort();
    },
  };
}
