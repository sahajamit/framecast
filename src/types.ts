export type LayoutKind = 'screen+camera' | 'screen' | 'camera';

export type BubbleShape = 'circle' | 'roundedRect';

/**
 * The single source of truth for how the camera bubble is rendered, shared by
 * the preflight preview, the PiP control deck and the compositor worker.
 * Coordinates are normalized so the same geometry works at any output size.
 */
export interface BubbleGeometry {
  shape: BubbleShape;
  /** Bubble center, normalized to output width (0..1). */
  cx: number;
  /** Bubble center, normalized to output height (0..1). */
  cy: number;
  /** Bubble diameter as a fraction of min(outputWidth, outputHeight). */
  size: number;
  /** Digital zoom into the camera frame: 1 = full frame, 3 = tight head crop. */
  zoom: number;
  mirror: boolean;
  border: boolean;
  shadow: boolean;
  visible: boolean;
}

export type PresetId = '1080p30' | '1080p60' | '1440p30' | '1440p60' | '2160p30';

export interface QualityPreset {
  id: PresetId;
  label: string;
  maxWidth: number;
  maxHeight: number;
  fps: number;
  videoBitrate: number;
}

export type Phase =
  | 'preflight'
  | 'countdown'
  | 'recording'
  | 'paused'
  | 'finalizing'
  | 'review';

export type ExportFormat = 'mp4' | 'webm' | 'mov';

export interface LibraryItem {
  name: string;
  size: number;
  lastModified: number;
}

export interface MicProcessing {
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
}
