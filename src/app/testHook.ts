import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';
import { runtime } from '../recorder/runtime';
import { isE2E } from '../library/fsAccess';
import { useStore } from '../state/store';
import type { FrameSettings } from '../types';

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
      setFrame(patch: Partial<FrameSettings>): void;
      sampleTopLeft(name: string): Promise<[number, number, number]>;
    };
  }
}

async function fileInLibrary(name: string): Promise<File> {
  const dir = runtime.libraryDir;
  if (!dir) throw new Error('library not connected');
  const handle = await dir.getFileHandle(name);
  return handle.getFile();
}

/** Playwright hooks, exposed only in ?e2e=1 mode. */
export function installTestHook(): void {
  if (!isE2E()) return;
  window.__framecast = {
    async inspectFile(name) {
      const file = await fileInLibrary(name);
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
    setFrame(patch) {
      useStore.getState().patchFrame(patch);
    },
    async sampleTopLeft(name) {
      const file = await fileInLibrary(name);
      const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
      const track = await input.getPrimaryVideoTrack();
      if (!track || !(await track.canDecode())) throw new Error('cannot decode video track');
      const duration = await input.computeDuration();
      const sink = new CanvasSink(track, { fit: 'contain' });
      const wrapped = await sink.getCanvas(Math.min(duration * 0.5, 1));
      if (!wrapped) throw new Error('no decodable frame');
      const canvas = wrapped.canvas as OffscreenCanvas | HTMLCanvasElement;
      const ctx = canvas.getContext('2d') as
        | CanvasRenderingContext2D
        | OffscreenCanvasRenderingContext2D
        | null;
      if (!ctx) throw new Error('no 2d context');
      const px = ctx.getImageData(3, 3, 1, 1).data;
      return [px[0] ?? 0, px[1] ?? 0, px[2] ?? 0];
    },
  };
}
