import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { runtime } from '../recorder/runtime';
import { backToPreflight, openInReview, refreshLibrary, toast } from './controller';
import { downloadFile } from '../library/fileOps';
import { convertRecording } from '../convert/exportFile';
import { trimRecording } from '../convert/trim';
import { enhanceRecording } from '../enhance/enhanceAudio';
import { ProgressBar } from '../ui/controls';
import { formatDuration } from '../library/thumbs';
import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';
import type { ExportFormat } from '../types';

interface Busy {
  label: string;
  progress: number;
}

export function ReviewScreen() {
  const reviewFileName = useStore((s) => s.session.reviewFileName);
  const audioCodec = useStore((s) => s.devices.audioCodec);

  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [trimIn, setTrimIn] = useState(0);
  const [trimOut, setTrimOut] = useState(0);
  const [busy, setBusy] = useState<Busy | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const stripRef = useRef<HTMLCanvasElement>(null);

  // Load the file under review.
  useEffect(() => {
    let revoked: string | null = null;
    void (async () => {
      const handle = runtime.reviewFileHandle;
      if (!handle) return;
      const f = await handle.getFile();
      setFile(f);
      const u = URL.createObjectURL(f);
      revoked = u;
      setUrl(u);
      setTrimIn(0);
      setTrimOut(0);
      setDuration(0);
    })();
    return () => {
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [reviewFileName]);

  // Filmstrip under the trim handles.
  useEffect(() => {
    if (!file || duration <= 0) return;
    let cancelled = false;
    void (async () => {
      try {
        const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
        const track = await input.getPrimaryVideoTrack();
        if (!track || !(await track.canDecode())) return;
        const strip = stripRef.current;
        if (!strip) return;
        const ctx = strip.getContext('2d')!;
        const slots = 8;
        const slotW = strip.width / slots;
        const sink = new CanvasSink(track, { width: Math.ceil(slotW), fit: 'cover' });
        for (let i = 0; i < slots && !cancelled; i++) {
          const wrapped = await sink.getCanvas((duration * (i + 0.5)) / slots);
          if (wrapped) ctx.drawImage(wrapped.canvas, i * slotW, 0, slotW, strip.height);
        }
      } catch {
        // Filmstrip is decorative — ignore failures.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file, duration]);

  if (!reviewFileName) return null;
  const dir = runtime.libraryDir;
  const effOut = trimOut > 0 ? trimOut : duration;
  const trimmed = trimIn > 0.05 || (duration > 0 && effOut < duration - 0.05);
  const currentExt = reviewFileName.slice(reviewFileName.lastIndexOf('.') + 1).toLowerCase();

  const seek = (t: number) => {
    const v = videoRef.current;
    if (v && isFinite(t)) v.currentTime = t;
  };

  async function withBusy(label: string, run: (p: (f: number, l?: string) => void) => Promise<void>) {
    setBusy({ label, progress: 0 });
    try {
      await run((fraction, newLabel) =>
        setBusy({ label: newLabel ?? label, progress: fraction }),
      );
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Operation failed.');
    } finally {
      setBusy(null);
      await refreshLibrary();
    }
  }

  const openOutput = async (outName: string) => {
    if (!dir) return;
    const handle = await dir.getFileHandle(outName);
    openInReview(handle, outName);
  };

  return (
    <div className="max-w-[860px] mx-auto flex flex-col gap-4 rise-in relative">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display font-semibold text-lg truncate">{reviewFileName}</h2>
        <span className="label-mono shrink-0">
          {formatDuration(duration)} · saved to {useStore.getState().library.dirName ?? 'folder'}
        </span>
      </div>

      <div className="viewfinder">
        <div className="vf-b" />
        {url && (
          <video
            ref={videoRef}
            src={url}
            controls
            className="w-full rounded-sm border border-line bg-black aspect-video"
            onLoadedMetadata={(e) => {
              const d = e.currentTarget.duration;
              if (isFinite(d)) {
                setDuration(d);
                setTrimOut(d);
              }
            }}
          />
        )}
      </div>

      {/* trim */}
      {duration > 0 && (
        <div className="panel p-3.5 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="label-mono">trim</span>
            <span className="font-mono text-[11px] text-mute">
              in {fmtT(trimIn)} · out {fmtT(effOut)} · keeps {fmtT(Math.max(0, effOut - trimIn))}
            </span>
          </div>
          <div className="relative h-14 rounded-md overflow-hidden border border-line">
            <canvas ref={stripRef} width={800} height={56} className="absolute inset-0 w-full h-full" />
            <div
              className="absolute inset-y-0 left-0 bg-black/70 border-r-2 border-accent"
              style={{ width: `${(trimIn / duration) * 100}%` }}
            />
            <div
              className="absolute inset-y-0 right-0 bg-black/70 border-l-2 border-accent"
              style={{ width: `${Math.max(0, (1 - effOut / duration) * 100)}%` }}
            />
            <input
              type="range"
              className="trim-range"
              min={0}
              max={duration}
              step={0.05}
              value={trimIn}
              onChange={(e) => {
                const v = Math.min(Number(e.target.value), effOut - 0.2);
                setTrimIn(Math.max(0, v));
                seek(v);
              }}
            />
            <input
              type="range"
              className="trim-range"
              min={0}
              max={duration}
              step={0.05}
              value={effOut}
              onChange={(e) => {
                const v = Math.max(Number(e.target.value), trimIn + 0.2);
                setTrimOut(Math.min(duration, v));
                seek(v);
              }}
            />
          </div>
          {trimmed && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-[12px] text-mute">
                {trimIn > 0.05
                  ? 'Cutting the head re-encodes (hardware, faster than realtime).'
                  : 'Tail-only cut — instant, no re-encode.'}
              </span>
              <button
                type="button"
                className="hairline-btn"
                onClick={() =>
                  void withBusy('Trimming', async (p) => {
                    if (!file || !dir) return;
                    const { outName } = await trimRecording(
                      file,
                      reviewFileName,
                      dir,
                      { start: trimIn, end: effOut },
                      (f) => p(f),
                    );
                    await openOutput(outName);
                  })
                }
              >
                ✂ apply trim
              </button>
            </div>
          )}
        </div>
      )}

      {/* actions */}
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="panel p-3.5 flex flex-col gap-2.5">
          <span className="label-mono">download / convert</span>
          <div className="grid grid-cols-3 gap-2">
            {(['mp4', 'webm', 'mov'] as ExportFormat[]).map((format) => (
              <button
                key={format}
                type="button"
                className="hairline-btn"
                onClick={() => {
                  if (format === currentExt) {
                    if (file) downloadFile(file, reviewFileName);
                    return;
                  }
                  void withBusy(`Converting to ${format.toUpperCase()}`, async (p) => {
                    if (!file || !dir) return;
                    const { outName, warning } = await convertRecording(
                      file,
                      reviewFileName,
                      dir,
                      format,
                      (f) => p(f),
                    );
                    if (warning) toast(warning);
                    else toast(`Saved ${outName} to your folder.`);
                  });
                }}
              >
                {format === currentExt ? `↓ ${format}` : format}
              </button>
            ))}
          </div>
          <p className="text-[11.5px] text-faint leading-snug">
            Your recording is already on disk. ↓ downloads a copy; other formats convert locally
            — nothing is uploaded.
          </p>
        </div>

        <div className="panel p-3.5 flex flex-col gap-2.5">
          <span className="label-mono">audio enhance</span>
          <button
            type="button"
            className="hairline-btn"
            onClick={() =>
              void withBusy('Enhancing audio', async (p) => {
                if (!file || !dir) return;
                const result = await enhanceRecording(
                  file,
                  reviewFileName,
                  dir,
                  audioCodec ?? 'opus',
                  (f, label) => p(f, label),
                );
                toast(
                  `Enhanced: measured ${result.measuredLufs.toFixed(1)} LUFS, applied ${result.appliedGainDb.toFixed(1)} dB.`,
                );
                await openOutput(result.outName);
              })
            }
          >
            ✦ denoise + normalize to −14 LUFS
          </button>
          <p className="text-[11.5px] text-faint leading-snug">
            RNNoise neural denoise + YouTube-loudness normalization, fully local. Writes a new
            “(enhanced)” file; the original stays untouched.
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <button
          type="button"
          className="danger-btn"
          onClick={() =>
            void (async () => {
              if (!dir) return;
              await dir.removeEntry(reviewFileName).catch(() => {});
              await refreshLibrary();
              backToPreflight();
            })()
          }
        >
          delete take
        </button>
        <button type="button" className="hairline-btn" onClick={backToPreflight}>
          ● new recording
        </button>
      </div>

      {busy && (
        <div className="absolute inset-0 z-20 grid place-items-center bg-bg/85 rounded-xl">
          <div className="panel p-6 w-[320px] flex flex-col gap-3">
            <span className="text-[13px]">{busy.label}…</span>
            <ProgressBar fraction={busy.progress} />
            <span className="font-mono text-[11px] text-mute">
              {Math.round(busy.progress * 100)}% · local processing
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function fmtT(t: number): string {
  const m = Math.floor(t / 60);
  const s = (t % 60).toFixed(1).padStart(4, '0');
  return `${m}:${s}`;
}
