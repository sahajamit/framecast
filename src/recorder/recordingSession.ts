import {
  MediaStreamAudioTrackSource,
  MediaStreamVideoTrackSource,
  Mp4OutputFormat,
  Output,
  StreamTarget,
} from 'mediabunny';
import type {
  BubbleGeometry,
  CameraBackground,
  CameraLighting,
  FrameSettings,
  LayoutKind,
  QualityPreset,
  ScreenFocus,
} from '../types';
import type { FromCompositor, ToCompositor } from '../compositor/protocol';
import type { AudioGraph } from '../audio/audioGraph';
import { AUDIO_BITRATE, assertVideoEncodable, outputDims } from './encoderConfig';
import { DiskWriterClient, promotePartToLibrary } from './diskWriter';

// mediabunny brands its track parameters; the runtime objects are plain MediaStreamTracks.
type VideoTrackArg = ConstructorParameters<typeof MediaStreamVideoTrackSource>[0];
type AudioTrackArg = ConstructorParameters<typeof MediaStreamAudioTrackSource>[0];

export interface SessionConfig {
  layout: LayoutKind;
  preset: QualityPreset;
  bubble: BubbleGeometry;
  frame: FrameSettings;
  cameraBackground: CameraBackground;
  cameraLighting: CameraLighting;
  focus: ScreenFocus;
  audioCodec: 'aac' | 'opus' | null;
  libraryDir: FileSystemDirectoryHandle;
}

export interface SessionMedia {
  /** Live display stream (screen/window/tab), required unless layout is camera-only. */
  displayStream: MediaStream | null;
  /** Live camera stream, required unless layout is screen-only. */
  cameraStream: MediaStream | null;
  /** Mixer producing the final mono/stereo audio track, or null for silent recordings. */
  audioGraph: AudioGraph | null;
}

export interface ActiveSession {
  /** Composited preview (clone of the recorded track) for the control deck. */
  previewStream: MediaStream;
  readonly partName: string;
  readonly width: number;
  readonly height: number;
  /** Begins encoding + writing. Call at the end of the countdown. */
  start(): Promise<void>;
  pause(): void;
  resume(): void;
  setBubble(bubble: BubbleGeometry): void;
  setFrame(frame: FrameSettings): void;
  setCameraBackground(cameraBackground: CameraBackground): void;
  setCameraLighting(cameraLighting: CameraLighting): void;
  setFocus(focus: ScreenFocus, animate: boolean): void;
  stop(): Promise<{ fileName: string; handle: FileSystemFileHandle }>;
  /** Tear down and delete the part file (error/cancel path). */
  abort(): Promise<void>;
  /** Fires when capture ends outside the app (Chrome's "Stop sharing" bar). */
  onExternalEnd: (() => void) | null;
  onError: ((message: string) => void) | null;
}

export async function prepareSession(
  cfg: SessionConfig,
  media: SessionMedia,
): Promise<ActiveSession> {
  const displayTrack = media.displayStream?.getVideoTracks()[0] ?? null;
  const cameraTrack = media.cameraStream?.getVideoTracks()[0] ?? null;

  if (cfg.layout !== 'camera' && !displayTrack) {
    throw new Error('No screen capture available');
  }
  if (cfg.layout === 'camera' && !cameraTrack) {
    throw new Error('No camera available');
  }

  // Output size follows the captured source's aspect ratio, capped by the preset.
  const sourceTrack = cfg.layout === 'camera' ? cameraTrack : displayTrack;
  const srcSettings = sourceTrack?.getSettings() ?? {};
  const srcW = srcSettings.width ?? cfg.preset.maxWidth;
  const srcH = srcSettings.height ?? cfg.preset.maxHeight;
  const { w, h } = outputDims(srcW, srcH, cfg.preset);
  await assertVideoEncodable(w, h);

  // Compositor: track processors (transferred) -> worker canvas -> generator track.
  const generator = new MediaStreamTrackGenerator({ kind: 'video' });
  const screenReadable =
    displayTrack && cfg.layout !== 'camera'
      ? new MediaStreamTrackProcessor({ track: displayTrack as MediaStreamVideoTrack }).readable
      : null;
  const cameraReadable =
    cameraTrack && cfg.layout !== 'screen'
      ? new MediaStreamTrackProcessor({ track: cameraTrack as MediaStreamVideoTrack }).readable
      : null;

  const worker = new Worker(new URL('../compositor/compositor.worker.ts', import.meta.url), {
    type: 'module',
  });
  const transfers: Transferable[] = [generator.writable];
  if (screenReadable) transfers.push(screenReadable);
  if (cameraReadable) transfers.push(cameraReadable);
  const init: ToCompositor = {
    type: 'init',
    width: w,
    height: h,
    fps: cfg.preset.fps,
    layout: cfg.layout,
    bubble: cfg.bubble,
    frame: cfg.frame,
    cameraBackground: cfg.cameraBackground,
    cameraLighting: cfg.cameraLighting,
    focus: cfg.focus,
    screen: screenReadable,
    camera: cameraReadable,
    out: generator.writable,
  };
  worker.postMessage(init, transfers);

  const compositorStopped = new Promise<void>((resolve) => {
    worker.addEventListener('message', (event: MessageEvent<FromCompositor>) => {
      if (event.data.type === 'stopped') resolve();
    });
  });

  // Recording pipeline: generator track -> WebCodecs encoders -> fragmented MP4 -> OPFS.
  const disk = new DiskWriterClient();
  const partName = `rec-${Date.now()}.part.mp4`;
  await disk.open(partName);

  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: 'fragmented', minimumFragmentDuration: 1 }),
    target: new StreamTarget(disk.createWritable()),
  });

  const videoSource = new MediaStreamVideoTrackSource(
    generator as unknown as VideoTrackArg,
    { codec: 'avc', bitrate: cfg.preset.videoBitrate, keyFrameInterval: 2 },
  );
  output.addVideoTrack(videoSource, { frameRate: cfg.preset.fps });

  const audioTrack = media.audioGraph?.outputTrack ?? null;
  let audioSource: MediaStreamAudioTrackSource | null = null;
  if (audioTrack && cfg.audioCodec) {
    audioSource = new MediaStreamAudioTrackSource(audioTrack as unknown as AudioTrackArg, {
      codec: cfg.audioCodec,
      bitrate: AUDIO_BITRATE,
    });
    output.addAudioTrack(audioSource);
  }

  let stopping = false;

  const session: ActiveSession = {
    previewStream: new MediaStream([generator.clone()]),
    partName,
    width: w,
    height: h,
    onExternalEnd: null,
    onError: null,

    async start() {
      await output.start();
    },

    pause() {
      // Same microtask for both sources keeps inter-track skew sub-frame.
      videoSource.pause();
      audioSource?.pause();
    },

    resume() {
      videoSource.resume();
      audioSource?.resume();
    },

    setBubble(bubble: BubbleGeometry) {
      worker.postMessage({ type: 'bubble', bubble } satisfies ToCompositor);
    },

    setFrame(frame: FrameSettings) {
      worker.postMessage({ type: 'frame', frame } satisfies ToCompositor);
    },

    setCameraBackground(cameraBackground: CameraBackground) {
      worker.postMessage({ type: 'cameraBackground', cameraBackground } satisfies ToCompositor);
    },

    setCameraLighting(cameraLighting: CameraLighting) {
      worker.postMessage({ type: 'cameraLighting', cameraLighting } satisfies ToCompositor);
    },

    setFocus(focus: ScreenFocus, animate: boolean) {
      worker.postMessage({ type: 'focus', focus, animate } satisfies ToCompositor);
    },

    async stop() {
      stopping = true;
      // Close the frame pipeline first so the encoder sees a clean end of stream.
      worker.postMessage({ type: 'stop' } satisfies ToCompositor);
      await Promise.race([compositorStopped, sleep(2000)]);
      stopAllTracks();
      await output.finalize();
      await disk.finalize();
      worker.terminate();

      const finalName = recordingFileName();
      const handle = await promotePartToLibrary(partName, cfg.libraryDir, finalName);
      return { fileName: finalName, handle };
    },

    async abort() {
      stopping = true;
      worker.postMessage({ type: 'stop' } satisfies ToCompositor);
      stopAllTracks();
      await output.cancel().catch(() => {});
      await disk.discard().catch(() => {});
      worker.terminate();
    },
  };

  function stopAllTracks(): void {
    for (const track of media.displayStream?.getTracks() ?? []) track.stop();
    // Camera + mic are owned by the preflight preview and stay warm.
  }

  // Surface capture ended externally (Chrome "Stop sharing" UI, window closed…).
  if (displayTrack) {
    displayTrack.addEventListener('ended', () => {
      if (!stopping) session.onExternalEnd?.();
    });
  }

  const watchError = (promise: Promise<void> | undefined, label: string) => {
    promise?.catch((err: unknown) => {
      if (!stopping) {
        session.onError?.(`${label}: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
  };
  watchError(videoSource.errorPromise, 'Video encoding failed');
  watchError(audioSource?.errorPromise, 'Audio encoding failed');

  return session;
}

function recordingFileName(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `framecast-${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}-${p(
    date.getHours(),
  )}${p(date.getMinutes())}${p(date.getSeconds())}.mp4`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
