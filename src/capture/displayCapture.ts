interface DisplayCaptureOptions {
  wantAudio: boolean;
  suppressLocalAudioPlayback: boolean;
  fps: number;
}

/**
 * Opens Chrome's screen/window/tab picker. Tab capture natively records only
 * the viewport (no omnibox or browser chrome) — exactly what we want.
 */
export async function getDisplayStream(
  opts: DisplayCaptureOptions,
  mediaDevices: MediaDevices = navigator.mediaDevices,
): Promise<MediaStream> {
  const constraints: DisplayMediaStreamOptions & Record<string, unknown> = {
    video: {
      frameRate: { ideal: opts.fps, max: 60 },
    },
    audio: opts.wantAudio
      ? ({ suppressLocalAudioPlayback: opts.suppressLocalAudioPlayback } as MediaTrackConstraints)
      : false,
    // Chrome-only hints. Harmless elsewhere.
    systemAudio: 'include',
    surfaceSwitching: 'include',
    monitorTypeSurfaces: 'include',
  };
  return mediaDevices.getDisplayMedia(constraints);
}

export type CaptureSurface = 'tab' | 'window' | 'monitor' | 'unknown';

export function captureSurfaceOf(track: MediaStreamTrack): CaptureSurface {
  const surface = (track.getSettings() as MediaTrackSettings & { displaySurface?: string })
    .displaySurface;
  if (surface === 'browser') return 'tab';
  if (surface === 'window') return 'window';
  if (surface === 'monitor') return 'monitor';
  return 'unknown';
}
