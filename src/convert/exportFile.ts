import {
  ALL_FORMATS,
  BlobSource,
  Conversion,
  Input,
  MovOutputFormat,
  Mp4OutputFormat,
  Output,
  StreamTarget,
  WebMOutputFormat,
  canEncodeAudio,
} from 'mediabunny';
import type {
  ConversionAudioOptions,
  ConversionVideoOptions,
  OutputFormat,
  StreamTargetChunk,
} from 'mediabunny';
import type { ExportFormat } from '../types';
import { replaceExt, uniqueName } from '../library/fileOps';
import { AUDIO_BITRATE } from '../recorder/encoderConfig';

export interface ConvertResult {
  outName: string;
  /** Set when MOV audio had to stay Opus (AAC encoder unavailable). */
  warning: string | null;
}

/**
 * Converts a recording into another container, fully locally.
 * - mp4: packet copy (also turns fragmented recordings into standard MP4)
 * - webm: VP9 + Opus re-encode (H.264 is not allowed in WebM)
 * - mov: video packets copied, audio transcoded to AAC when possible
 */
export async function convertRecording(
  srcFile: File,
  srcName: string,
  dir: FileSystemDirectoryHandle,
  target: ExportFormat,
  onProgress: (fraction: number) => void,
): Promise<ConvertResult> {
  const input = new Input({ source: new BlobSource(srcFile), formats: ALL_FORMATS });

  let format: OutputFormat;
  let video: ConversionVideoOptions | undefined;
  let audio: ConversionAudioOptions | undefined;
  let warning: string | null = null;

  switch (target) {
    case 'mp4':
      format = new Mp4OutputFormat();
      break;
    case 'webm': {
      format = new WebMOutputFormat();
      video = { codec: 'vp9' };
      audio = { codec: 'opus', bitrate: AUDIO_BITRATE };
      break;
    }
    case 'mov': {
      format = new MovOutputFormat();
      const audioTrack = await input.getPrimaryAudioTrack();
      if (audioTrack && audioTrack.codec !== 'aac') {
        if (await canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: 48000 })) {
          audio = { codec: 'aac', bitrate: AUDIO_BITRATE };
        } else {
          warning =
            'AAC encoding is unavailable in this browser, so the MOV keeps Opus audio — QuickTime may play it silently.';
        }
      }
      break;
    }
  }

  const outName = await uniqueName(dir, replaceExt(srcName, `.${target}`));
  const outHandle = await dir.getFileHandle(outName, { create: true });
  const writable = await outHandle.createWritable();

  try {
    const output = new Output({
      format,
      target: new StreamTarget(writable as unknown as WritableStream<StreamTargetChunk>),
    });
    const conversion = await Conversion.init({ input, output, video, audio });
    conversion.onProgress = (progress) => onProgress(progress);
    await conversion.execute();
  } catch (err) {
    await dir.removeEntry(outName).catch(() => {});
    throw err;
  }

  return { outName, warning };
}
