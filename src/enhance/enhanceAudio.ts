import {
  ALL_FORMATS,
  AudioBufferSink,
  AudioBufferSource,
  BlobSource,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  Input,
  Mp4OutputFormat,
  Output,
  StreamTarget,
} from 'mediabunny';
import type { StreamTargetChunk } from 'mediabunny';
import { denoiseAudioBuffer } from './rnnoise';
import {
  applyGainInPlace,
  gainToTarget,
  measureIntegratedLufs,
  samplePeak,
} from './loudness';
import { AUDIO_BITRATE } from '../recorder/encoderConfig';
import { uniqueName } from '../library/fileOps';

const MAX_ENHANCE_MINUTES = 40;

export interface EnhanceResult {
  outName: string;
  measuredLufs: number;
  appliedGainDb: number;
}

/**
 * One-click audio cleanup: RNNoise denoise + normalize to -14 LUFS, then
 * remux with the original video packets copied byte-for-byte (no re-encode).
 */
export async function enhanceRecording(
  srcFile: File,
  srcName: string,
  dir: FileSystemDirectoryHandle,
  audioCodec: 'aac' | 'opus',
  onProgress: (fraction: number, label: string) => void,
): Promise<EnhanceResult> {
  const input = new Input({ source: new BlobSource(srcFile), formats: ALL_FORMATS });
  const audioTrack = await input.getPrimaryAudioTrack();
  if (!audioTrack) throw new Error('This recording has no audio track to enhance.');
  const duration = await audioTrack.computeDuration();
  if (duration > MAX_ENHANCE_MINUTES * 60) {
    throw new Error(`Audio enhance currently supports recordings up to ${MAX_ENHANCE_MINUTES} minutes.`);
  }

  // 1. Decode the full audio track into one AudioBuffer.
  onProgress(0.02, 'Decoding audio');
  const sampleRate = audioTrack.sampleRate;
  const numberOfChannels = audioTrack.numberOfChannels;
  const pieces: { buffer: AudioBuffer; offset: number }[] = [];
  let totalFrames = 0;
  const sink = new AudioBufferSink(audioTrack);
  for await (const wrapped of sink.buffers()) {
    const offset = Math.round(wrapped.timestamp * sampleRate);
    pieces.push({ buffer: wrapped.buffer, offset });
    totalFrames = Math.max(totalFrames, offset + wrapped.buffer.length);
    onProgress(0.02 + Math.min(0.2, (wrapped.timestamp / duration) * 0.2), 'Decoding audio');
  }
  if (totalFrames === 0) throw new Error('Could not decode any audio from this recording.');

  const merged = new AudioBuffer({ numberOfChannels, length: totalFrames, sampleRate });
  for (const piece of pieces) {
    for (let c = 0; c < numberOfChannels; c++) {
      merged.copyToChannel(piece.buffer.getChannelData(c), c, piece.offset);
    }
  }
  pieces.length = 0;

  // 2. Neural denoise (RNNoise, offline render — faster than real time).
  onProgress(0.25, 'Removing noise');
  const denoised = await denoiseAudioBuffer(merged);

  // 3. Measure loudness, compute gain to -14 LUFS with a -1 dBFS peak guard.
  onProgress(0.5, 'Normalizing loudness');
  const channels: Float32Array[] = [];
  for (let c = 0; c < denoised.numberOfChannels; c++) channels.push(denoised.getChannelData(c));
  const lufs = measureIntegratedLufs(channels, denoised.sampleRate);
  const peak = samplePeak(channels);
  const gain = gainToTarget(lufs, peak, -14);
  applyGainInPlace(channels, gain);

  // 4. Remux: copy video packets untouched, encode the enhanced audio.
  onProgress(0.55, 'Writing enhanced file');
  const outName = await uniqueName(dir, enhancedName(srcName));
  const outHandle = await dir.getFileHandle(outName, { create: true });
  const writable = await outHandle.createWritable();

  try {
    const output = new Output({
      format: new Mp4OutputFormat(),
      target: new StreamTarget(writable as unknown as WritableStream<StreamTargetChunk>),
    });

    const videoTrack = await input.getPrimaryVideoTrack();
    let feedVideo: (() => Promise<void>) | null = null;
    let videoDuration = 0;

    const audioSource = new AudioBufferSource({ codec: audioCodec, bitrate: AUDIO_BITRATE });
    output.addAudioTrack(audioSource);

    let audioFedSec = 0;
    const audioTotalSec = denoised.length / denoised.sampleRate;
    const feedAudioUpTo = async (t: number) => {
      while (audioFedSec < Math.min(t, audioTotalSec)) {
        const sliceSec = Math.min(1, audioTotalSec - audioFedSec);
        await audioSource.add(sliceBuffer(denoised, audioFedSec, sliceSec));
        audioFedSec += sliceSec;
      }
    };

    if (videoTrack && videoTrack.codec) {
      const videoSource = new EncodedVideoPacketSource(videoTrack.codec);
      output.addVideoTrack(videoSource);
      const decoderConfig = await videoTrack.getDecoderConfig();
      if (!decoderConfig) throw new Error('Could not read the video decoder configuration.');
      videoDuration = await videoTrack.computeDuration();
      const packetSink = new EncodedPacketSink(videoTrack);
      feedVideo = async () => {
        let first = true;
        for await (const packet of packetSink.packets()) {
          await videoSource.add(packet, first ? { decoderConfig } : undefined);
          first = false;
          // Keep audio interleaved roughly alongside video.
          await feedAudioUpTo(packet.timestamp);
          if (videoDuration > 0) {
            onProgress(0.55 + (packet.timestamp / videoDuration) * 0.4, 'Writing enhanced file');
          }
        }
      };
    }

    await output.start();
    if (feedVideo) await feedVideo();
    await feedAudioUpTo(audioTotalSec);
    await output.finalize();
  } catch (err) {
    await dir.removeEntry(outName).catch(() => {});
    throw err;
  }

  onProgress(1, 'Done');
  return {
    outName,
    measuredLufs: lufs,
    appliedGainDb: 20 * Math.log10(gain),
  };
}

function sliceBuffer(src: AudioBuffer, startSec: number, lengthSec: number): AudioBuffer {
  const start = Math.round(startSec * src.sampleRate);
  const length = Math.min(Math.round(lengthSec * src.sampleRate), src.length - start);
  const out = new AudioBuffer({
    numberOfChannels: src.numberOfChannels,
    length,
    sampleRate: src.sampleRate,
  });
  for (let c = 0; c < src.numberOfChannels; c++) {
    out.copyToChannel(src.getChannelData(c).subarray(start, start + length), c);
  }
  return out;
}

function enhancedName(name: string): string {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  return `${stem} (enhanced).mp4`;
}
