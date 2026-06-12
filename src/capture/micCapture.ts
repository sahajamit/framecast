import type { MicProcessing } from '../types';

export async function getMicStream(
  deviceId: string | null,
  processing: MicProcessing,
): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      echoCancellation: processing.echoCancellation,
      noiseSuppression: processing.noiseSuppression,
      autoGainControl: processing.autoGainControl,
      channelCount: { ideal: 1 },
      sampleRate: { ideal: 48000 },
    },
    video: false,
  });
}
