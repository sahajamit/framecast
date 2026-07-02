import type { BubbleGeometry, FrameSettings, LayoutKind, ScreenFocus } from '../types';

export interface CompositorInit {
  type: 'init';
  width: number;
  height: number;
  fps: number;
  layout: LayoutKind;
  bubble: BubbleGeometry;
  frame: FrameSettings;
  focus: ScreenFocus;
  /** Transferred MediaStreamTrackProcessor readables. */
  screen: ReadableStream<VideoFrame> | null;
  camera: ReadableStream<VideoFrame> | null;
  /** Transferred MediaStreamTrackGenerator writable. */
  out: WritableStream<VideoFrame>;
}

export type ToCompositor =
  | CompositorInit
  | { type: 'bubble'; bubble: BubbleGeometry }
  | { type: 'frame'; frame: FrameSettings }
  | { type: 'focus'; focus: ScreenFocus; animate: boolean }
  | { type: 'stop' };

export type FromCompositor =
  | { type: 'firstFrame' }
  | { type: 'sourceEnded'; source: 'screen' | 'camera' }
  | { type: 'stopped' }
  | { type: 'fatal'; message: string };
