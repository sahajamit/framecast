import { getFirstEncodableAudioCodec, getFirstEncodableVideoCodec } from 'mediabunny';
import type { PresetId, QualityPreset } from '../types';

export const PRESETS: Record<PresetId, QualityPreset> = {
  '1080p30': {
    id: '1080p30',
    label: '1080p · 30 fps',
    maxWidth: 1920,
    maxHeight: 1080,
    fps: 30,
    videoBitrate: 6_000_000,
  },
  '1080p60': {
    id: '1080p60',
    label: '1080p · 60 fps',
    maxWidth: 1920,
    maxHeight: 1080,
    fps: 60,
    videoBitrate: 9_000_000,
  },
  '1440p30': {
    id: '1440p30',
    label: '1440p · 30 fps',
    maxWidth: 2560,
    maxHeight: 1440,
    fps: 30,
    videoBitrate: 10_000_000,
  },
  '1440p60': {
    id: '1440p60',
    label: '1440p · 60 fps',
    maxWidth: 2560,
    maxHeight: 1440,
    fps: 60,
    videoBitrate: 15_000_000,
  },
  '2160p30': {
    id: '2160p30',
    label: '4K · 30 fps',
    maxWidth: 3840,
    maxHeight: 2160,
    fps: 30,
    videoBitrate: 18_000_000,
  },
};

export const AUDIO_BITRATE = 160_000;

/**
 * Output canvas size: the captured source's exact aspect ratio, scaled to fit
 * inside the preset box (never upscaled), rounded to even numbers for the
 * encoder.
 */
export function outputDims(
  srcW: number,
  srcH: number,
  preset: QualityPreset,
): { w: number; h: number } {
  const scale = Math.min(1, preset.maxWidth / srcW, preset.maxHeight / srcH);
  const even = (v: number) => Math.max(2, Math.round((v * scale) / 2) * 2);
  return { w: even(srcW), h: even(srcH) };
}

export async function probeAudioCodec(): Promise<'aac' | 'opus' | null> {
  const codec = await getFirstEncodableAudioCodec(['aac', 'opus'], {
    numberOfChannels: 2,
    sampleRate: 48000,
    bitrate: AUDIO_BITRATE,
  });
  return codec === 'aac' || codec === 'opus' ? codec : null;
}

export async function assertVideoEncodable(w: number, h: number): Promise<void> {
  const codec = await getFirstEncodableVideoCodec(['avc'], { width: w, height: h });
  if (codec !== 'avc') {
    throw new Error(
      `This browser cannot hardware-encode H.264 at ${w}×${h}. Try a lower quality preset.`,
    );
  }
}
