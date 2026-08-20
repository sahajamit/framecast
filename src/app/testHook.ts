import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';
import { runtime } from '../recorder/runtime';
import { isE2E } from '../library/fsAccess';
import { useStore } from '../state/store';
import { updateFocus } from './controller';
import { DEFAULT_FOCUS } from '../compositor/layout';
import type { CameraBackground, FrameSettings, ScreenFocus } from '../types';

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
      setCameraBackground(patch: Partial<CameraBackground>): void;
      setFocus(patch: Partial<ScreenFocus>): void;
      sampleTopLeft(name: string): Promise<[number, number, number]>;
      samplePixel(
        name: string,
        nx: number,
        ny: number,
        atSec?: number,
      ): Promise<[number, number, number]>;
    };
  }
}

async function fileInLibrary(name: string): Promise<File> {
  const dir = runtime.libraryDir;
  if (!dir) throw new Error('library not connected');
  const handle = await dir.getFileHandle(name);
  return handle.getFile();
}

type AnyCtx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Decodes a frame ~halfway in and returns its 2D context + dimensions. */
async function decodeMidFrame(
  name: string,
  atSec?: number,
): Promise<{ ctx: AnyCtx2D; width: number; height: number }> {
  const file = await fileInLibrary(name);
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const track = await input.getPrimaryVideoTrack();
  if (!track || !(await track.canDecode())) throw new Error('cannot decode video track');
  const duration = await input.computeDuration();
  const sink = new CanvasSink(track, { fit: 'contain' });
  // Default samples early (capped at 1 s) so decodes stay cheap; specs that
  // need steady-state content (e.g. after the matting model's warm-up lands
  // mid-take) pass an explicit time.
  const t =
    atSec !== undefined
      ? Math.max(0, Math.min(atSec, Math.max(0, duration - 0.2)))
      : Math.min(duration * 0.5, 1);
  const wrapped = await sink.getCanvas(t);
  if (!wrapped) throw new Error('no decodable frame');
  const canvas = wrapped.canvas as OffscreenCanvas | HTMLCanvasElement;
  const ctx = canvas.getContext('2d') as AnyCtx2D | null;
  if (!ctx) throw new Error('no 2d context');
  return { ctx, width: canvas.width, height: canvas.height };
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
    setCameraBackground(patch) {
      useStore.getState().patchCameraBackground(patch);
    },
    setFocus(patch) {
      // animate:false so assertions don't race the glide.
      updateFocus({ ...DEFAULT_FOCUS, ...patch }, { animate: false });
    },
    async sampleTopLeft(name) {
      const { ctx } = await decodeMidFrame(name);
      const px = ctx.getImageData(3, 3, 1, 1).data;
      return [px[0] ?? 0, px[1] ?? 0, px[2] ?? 0];
    },
    async samplePixel(name, nx, ny, atSec) {
      const { ctx, width, height } = await decodeMidFrame(name, atSec);
      const x = Math.max(0, Math.min(width - 1, Math.round(nx * width)));
      const y = Math.max(0, Math.min(height - 1, Math.round(ny * height)));
      const px = ctx.getImageData(x, y, 1, 1).data;
      return [px[0] ?? 0, px[1] ?? 0, px[2] ?? 0];
    },
  };
}
