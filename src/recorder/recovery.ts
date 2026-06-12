import {
  ALL_FORMATS,
  BlobSource,
  EncodedAudioPacketSource,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  Input,
  Mp4OutputFormat,
  Output,
  StreamTarget,
} from 'mediabunny';
import type { EncodedPacket, InputAudioTrack, InputVideoTrack, StreamTargetChunk } from 'mediabunny';
import { PARTS_DIR } from './diskWriter';
import { uniqueName } from '../library/fileOps';

/** Orphaned in-progress recordings left in OPFS by a crash or closed tab. */
export async function listRecoverableParts(): Promise<string[]> {
  try {
    const root = await navigator.storage.getDirectory();
    const parts = await root.getDirectoryHandle(PARTS_DIR);
    const names: string[] = [];
    for await (const entry of parts.values()) {
      if (entry.kind === 'file' && entry.name.endsWith('.part.mp4')) names.push(entry.name);
    }
    return names.sort();
  } catch {
    return [];
  }
}

export async function discardPart(name: string): Promise<void> {
  const root = await navigator.storage.getDirectory();
  const parts = await root.getDirectoryHandle(PARTS_DIR);
  await parts.removeEntry(name).catch(() => {});
}

/**
 * Salvages a crashed recording into a standard MP4 in the library folder.
 * Copies packets until the (possibly truncated) final fragment stops parsing,
 * so everything up to the last flushed second survives.
 */
export async function recoverPart(
  partName: string,
  libraryDir: FileSystemDirectoryHandle,
): Promise<{ outName: string }> {
  const root = await navigator.storage.getDirectory();
  const parts = await root.getDirectoryHandle(PARTS_DIR);
  const partHandle = await parts.getFileHandle(partName);
  const file = await partHandle.getFile();

  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const videoTrack = await input.getPrimaryVideoTrack().catch(() => null);
  const audioTrack = await input.getPrimaryAudioTrack().catch(() => null);
  if (!videoTrack && !audioTrack) {
    throw new Error('Nothing recoverable in this file.');
  }

  const outName = await uniqueName(libraryDir, recoveredName(partName));
  const outHandle = await libraryDir.getFileHandle(outName, { create: true });
  const writable = await outHandle.createWritable();

  try {
    const output = new Output({
      format: new Mp4OutputFormat(),
      target: new StreamTarget(writable as unknown as WritableStream<StreamTargetChunk>),
    });

    const video = videoTrack?.codec ? new EncodedVideoPacketSource(videoTrack.codec) : null;
    if (video) output.addVideoTrack(video);
    const audio = audioTrack?.codec ? new EncodedAudioPacketSource(audioTrack.codec) : null;
    if (audio) output.addAudioTrack(audio);

    await output.start();

    const videoFeed =
      video && videoTrack ? await makePacketFeed(videoTrack, video.add.bind(video)) : null;
    const audioFeed =
      audio && audioTrack ? await makePacketFeed(audioTrack, audio.add.bind(audio)) : null;

    // Merge-feed by timestamp so the muxer never has to buffer one whole track.
    let wrote = 0;
    for (;;) {
      const candidates = [videoFeed, audioFeed].filter(
        (f): f is PacketFeed => f !== null && f.head !== null,
      );
      if (candidates.length === 0) break;
      candidates.sort((a, b) => (a.head?.timestamp ?? 0) - (b.head?.timestamp ?? 0));
      const feed = candidates[0];
      if (!feed) break;
      await feed.writeHeadAndAdvance();
      wrote++;
    }
    if (wrote === 0) throw new Error('No complete packets found in this file.');

    await output.finalize();
  } catch (err) {
    await libraryDir.removeEntry(outName).catch(() => {});
    throw err;
  }

  await discardPart(partName);
  return { outName };
}

interface PacketFeed {
  head: EncodedPacket | null;
  writeHeadAndAdvance(): Promise<void>;
}

async function makePacketFeed(
  track: InputVideoTrack | InputAudioTrack,
  add: (packet: EncodedPacket, meta?: never) => Promise<void>,
): Promise<PacketFeed | null> {
  const decoderConfig = await track.getDecoderConfig().catch(() => null);
  if (!decoderConfig) return null;
  const sink = new EncodedPacketSink(track);
  const iterator = sink.packets();

  const next = async (): Promise<EncodedPacket | null> => {
    try {
      const result = await iterator.next();
      return result.done ? null : result.value;
    } catch {
      // Truncated tail — stop cleanly at the last parseable packet.
      return null;
    }
  };

  let first = true;
  const feed: PacketFeed = {
    head: await next(),
    async writeHeadAndAdvance() {
      if (!feed.head) return;
      // First packet must carry the decoder config.
      await (add as (p: EncodedPacket, m?: unknown) => Promise<void>)(
        feed.head,
        first ? { decoderConfig } : undefined,
      );
      first = false;
      feed.head = await next();
    },
  };
  return feed;
}

function recoveredName(partName: string): string {
  const stem = partName.replace(/\.part\.mp4$/, '');
  return `framecast-recovered-${stem.replace(/^rec-/, '')}.mp4`;
}
