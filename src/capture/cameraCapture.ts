export async function getCameraStream(deviceId: string | null): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    video: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      frameRate: { ideal: 30 },
    },
    audio: false,
  });
}

interface ZoomCapability {
  min: number;
  max: number;
  step: number;
}

/** Hardware zoom range, if this camera exposes one (most built-in cams don't). */
export function nativeZoomCapability(track: MediaStreamTrack): ZoomCapability | null {
  const caps = track.getCapabilities?.() as (MediaTrackCapabilities & {
    zoom?: { min: number; max: number; step: number };
  }) | undefined;
  if (caps?.zoom && typeof caps.zoom === 'object' && caps.zoom.max > caps.zoom.min) {
    return caps.zoom;
  }
  return null;
}

export async function applyNativeZoom(track: MediaStreamTrack, zoom: number): Promise<void> {
  await track.applyConstraints({ advanced: [{ zoom } as MediaTrackConstraintSet] });
}
