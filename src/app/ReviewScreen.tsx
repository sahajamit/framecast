import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { runtime } from '../recorder/runtime';
import { backToPreflight, openInReview, refreshLibrary, toast } from './controller';
import { downloadFile } from '../library/fileOps';
import { convertRecording } from '../convert/exportFile';
import { trimRecording } from '../convert/trim';
import { enhanceRecording } from '../enhance/enhanceAudio';
import { Lamp, Module, ProgressBar, Timecode } from '../ui/controls';
import { formatDuration } from '../library/thumbs';
import { formatSize } from '../library/scan';
import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';
import type { ExportFormat } from '../types';

interface Busy {
  label: string;
  progress: number;
}

export function ReviewScreen() {
  const reviewFileName = useStore((s) => s.session.reviewFileName);
  const audioCodec = useStore((s) => s.devices.audioCodec);
  const storageMode = useStore((s) => s.library.mode);
  const dirName = useStore((s) => s.library.dirName);

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
        const ctx = strip.getContext('2d');
        if (!ctx) return;
        const slots = 10;
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
      await run((fraction, newLabel) => setBusy({ label: newLabel ?? label, progress: fraction }));
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

  const inPct = duration > 0 ? (trimIn / duration) * 100 : 0;
  const outPct = duration > 0 ? (effOut / duration) * 100 : 100;

  return (
    <div className="grid lg:grid-cols-[1fr_336px] gap-5 items-start rise-in relative">
      {/* playback monitor */}
      <div className="monitor">
        <div className="monitor-head">
          <span className="take-title">
            Take <em>review</em>
          </span>
          <span className="src-read">{reviewFileName}</span>
          <div className="monitor-actions">
            <button type="button" className="btn-s" onClick={backToPreflight}>
              New take
            </button>
            <button
              type="button"
              className="btn-s danger"
              onClick={() =>
                void (async () => {
                  if (!dir) return;
                  await dir.removeEntry(reviewFileName).catch(() => {});
                  await refreshLibrary();
                  backToPreflight();
                })()
              }
            >
              Delete
            </button>
          </div>
        </div>
        <div className="stage force-dark">
          {url && (
            <video
              ref={videoRef}
              src={url}
              controls
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
        <div className="monitor-strip">
          <span className="ok">● Saved</span>
          <span className="sep" />
          <span className="truncate">{dirName ?? 'on disk'}</span>
          <span className="flex-1" />
          <Timecode>{formatDuration(duration)}</Timecode>
        </div>

        {/* trim deck */}
        {duration > 0 && (
          <div className="mt-4">
            <div className="mod-label" style={{ marginBottom: 8 }}>
              <b>Trim</b>
              <span className="no">IN/OUT</span>
              <span className="val">{formatDuration(Math.max(0, effOut - trimIn))} kept</span>
            </div>
            <div className="trim-well force-dark">
              <div className="trim-strip">
                <canvas ref={stripRef} width={900} height={44} />
              </div>
              <div className="trim-dim" style={{ left: 0, width: `${inPct}%` }} />
              <div className="trim-dim" style={{ right: 0, width: `${Math.max(0, 100 - outPct)}%` }} />
              <div className="trim-rail" style={{ top: 8, left: `${inPct}%`, right: `${100 - outPct}%` }} />
              <div className="trim-rail" style={{ bottom: 8, left: `${inPct}%`, right: `${100 - outPct}%` }} />
              <input
                type="range"
                className="trim-range"
                aria-label="Trim in point"
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
                aria-label="Trim out point"
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
            <div className="flex items-center gap-5 mt-2.5">
              <span className="hint">
                IN <b style={{ color: 'var(--color-accent)' }}>{fmtT(trimIn)}</b>
              </span>
              <span className="hint">
                OUT <b style={{ color: 'var(--color-accent)' }}>{fmtT(effOut)}</b>
              </span>
              <span className="flex-1" />
              {trimmed && (
                <>
                  <span className="hint">
                    {trimIn > 0.05 ? 'Head cut re-encodes on-device' : 'Tail cut · instant copy'}
                  </span>
                  <button
                    type="button"
                    className="btn-s accent"
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
                    ✂ Apply trim
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* rail */}
      <aside className="flex flex-col gap-3">
        <Module title="Export" no="OUT·01">
          <div className="seg">
            {(['mp4', 'webm', 'mov'] as ExportFormat[]).map((format) => (
              <button
                key={format}
                type="button"
                className={format === currentExt ? 'on' : ''}
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
                    else toast(`Saved ${outName} to your library.`);
                  });
                }}
              >
                {format === currentExt ? `↓ ${format}` : format}
              </button>
            ))}
          </div>
          <p className="hint mt-2.5">
            ↓ downloads the current file.
            <br />
            Other formats convert on your machine — nothing is uploaded.
          </p>
        </Module>

        <Module title="Audio" no="FX">
          <button
            type="button"
            className="btn w-full"
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
            ✦ Enhance audio
          </button>
          <p className="hint mt-2.5">
            One pass: denoise + level to −14 LUFS.
            <br />A new file is written; the original stays.
          </p>
        </Module>

        <Module title="Take" no="TC" val={file ? formatSize(file.size) : undefined}>
          <button type="button" className="btn w-full" onClick={backToPreflight}>
            Roll next take
          </button>
          <p className="hint mt-2.5" style={{ wordBreak: 'break-all' }}>
            {reviewFileName}
            <br />
            {storageMode === 'opfs' ? 'browser storage · use ↓ to export' : (dirName ?? 'on disk')}
          </p>
        </Module>
      </aside>

      {busy && (
        <div
          className="absolute inset-0 grid place-items-center"
          style={{ zIndex: 40, background: 'color-mix(in srgb, var(--color-bg) 82%, transparent)', borderRadius: 'var(--radius-4)' }}
        >
          <div className="module w-[340px]">
            <div className="mod-label">
              <b>Processing</b>
              <span className="no">LOCAL</span>
            </div>
            <p className="text-[13px] mb-3" style={{ color: 'var(--color-ink-2)' }}>
              {busy.label}…
            </p>
            <ProgressBar fraction={busy.progress} />
            <p className="hint mt-2.5">
              <Lamp size={7} /> local processing · nothing leaves this machine
            </p>
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
