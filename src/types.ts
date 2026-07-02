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

/**
 * Backdrop behind the inset screen in scene framing. Drawn as code (gradients /
 * noise / live blur) in `compositor/backdrops.ts`, never as bundled images, and
 * theme-invariant — backdrops are part of the recording, not the app chrome.
 */
export type BackdropId =
  | 'none'
  | 'ink'
  | 'slate'
  | 'bone'
  | 'charcoal'
  | 'paper'
  | 'led'
  | 'charcoal-grain'
  | 'paper-grain'
  | 'blur';

/**
 * Scene framing: the captured screen sits inset on a styled backdrop with
 * rounded corners and a soft shadow. Resolution-independent so the 720p
 * preflight preview and the full-res recording render the same relative frame:
 * `pad` is a fraction; `radius` is px at a 1080p reference, scaled by outH/1080.
 */
export interface FrameSettings {
  backdrop: BackdropId;
  /** Inset as a fraction of output height (0..0.12), applied as equal px on all sides. */
  pad: number;
  /** Corner radius in px at a 1080p-height reference (0..24); drawn = radius * outH / 1080. */
  radius: number;
  shadow: boolean;
}

export type FocusMode = 'none' | 'zoom' | 'spotlight';

/**
 * Live "punch-in" state for the screen layer, baked into the recording. `cx,cy`
 * is the region center and `w,h` its size, normalized (0..1) to the screen
 * content and already constrained to the output aspect ratio. The implied zoom
 * factor is 1/w (clamped to FOCUS_ZOOM_MAX). `zoom` mode crops to the region and
 * fills the frame; `spotlight` keeps the full frame but dims everything outside
 * the region. Distinct from BubbleGeometry.zoom, which is the camera's digital
 * zoom — this never carries a field literally named `zoom`.
 */
export interface ScreenFocus {
  mode: FocusMode;
  cx: number;
  cy: number;
  w: number;
  h: number;
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
