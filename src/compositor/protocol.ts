import type { BubbleGeometry, LayoutKind } from '../types';

export interface CompositorInit {
  type: 'init';
  width: number;
  height: number;
  fps: number;
  layout: LayoutKind;
  bubble: BubbleGeometry;
  /** Transferred MediaStreamTrackProcessor readables. */
  screen: ReadableStream<VideoFrame> | null;
  camera: ReadableStream<VideoFrame> | null;
  /** Transferred MediaStreamTrackGenerator writable. */
  out: WritableStream<VideoFrame>;
}

export type ToCompositor =
  | CompositorInit
  | { type: 'bubble'; bubble: BubbleGeometry }
  | { type: 'stop' };

export type FromCompositor =
  | { type: 'firstFrame' }
  | { type: 'sourceEnded'; source: 'screen' | 'camera' }
  | { type: 'stopped' }
  | { type: 'fatal'; message: string };
