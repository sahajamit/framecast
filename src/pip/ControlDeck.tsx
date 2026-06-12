import { useEffect, useRef, useState } from 'react';
import { elapsedMs, formatElapsed, useStore } from '../state/store';
import { runtime } from '../recorder/runtime';
import {
  armAndCapture,
  setMicMuted,
  stopRecording,
  togglePause,
  updateBubble,
} from '../app/controller';
import { Meter, SliderField, TallyDot } from '../ui/controls';
import { useBubbleDrag } from '../ui/useBubbleDrag';
import { readLevel, meterPosition } from '../audio/levelMeter';
import { registerShortcuts } from '../shortcuts/keyboard';
import {
  BUBBLE_MAX_SIZE,
  BUBBLE_MIN_SIZE,
  cornerPosition,
  SNAP_CORNERS,
  ZOOM_MAX,
  ZOOM_MIN,
} from '../compositor/layout';

const CORNER_GLYPHS: Record<string, string> = {
  'top-left': '◰',
  'top-right': '◳',
  'bottom-left': '◱',
  'bottom-right': '◲',
};

/**
 * The control deck: lives in the Document PiP window during recording (or
 * inline in the tab when PiP is unavailable / in e2e mode). Everything the
 * creator needs mid-take: live preview with drag-to-move bubble, snap, zoom,
 * mic, pause, stop, timer.
 */
export function ControlDeck({ windowRef }: { windowRef: Window }) {
  const phase = useStore((s) => s.session.phase);
  const armed = useStore((s) => s.session.armed);
  const countdown = useStore((s) => s.session.countdown);
  const micMuted = useStore((s) => s.session.micMuted);
  const bubble = useStore((s) => s.settings.bubble);
  const layout = useStore((s) => s.settings.layout);
  const micEnabled = useStore((s) => s.settings.micEnabled);

  const videoRef = useRef<HTMLVideoElement>(null);
  const [clock, setClock] = useState('00:00');
  const [level, setLevel] = useState(0);

  const session = runtime.session;
  const hasBubble = layout === 'screen+camera';

  // Live composited preview.
  useEffect(() => {
    const video = videoRef.current;
    if (video && session && video.srcObject !== session.previewStream) {
      video.srcObject = session.previewStream;
      void video.play().catch(() => {});
    }
  }, [session, phase]);

  // Timer + mic meter tick. The PiP window stays visible, so 4 Hz is honored.
  useEffect(() => {
    const tick = windowRef.setInterval(() => {
      setClock(formatElapsed(elapsedMs(useStore.getState().session)));
      const graph = runtime.audioGraph;
      if (graph) setLevel(meterPosition(readLevel(graph.analyser).db));
    }, 250);
    return () => windowRef.clearInterval(tick);
  }, [windowRef]);

  // Shortcuts inside this window.
  useEffect(
    () =>
      registerShortcuts(windowRef, {
        togglePause,
        stop: () => void stopRecording(),
        toggleMic: () => setMicMuted(!useStore.getState().session.micMuted),
        toggleCamera: () => updateBubble({ visible: !useStore.getState().settings.bubble.visible }),
        snap: (corner) => {
          const s = useStore.getState();
          const dims = runtime.session
            ? { w: runtime.session.width, h: runtime.session.height }
            : { w: 16, h: 9 };
          updateBubble(cornerPosition(corner, s.settings.bubble, dims.w, dims.h));
        },
      }),
    [windowRef],
  );

  const content = () =>
    session ? { w: session.width, h: session.height } : { w: 16, h: 9 };
  const { handlers, cursor } = useBubbleDrag(content, hasBubble && bubble.visible);

  const recording = phase === 'recording';
  const paused = phase === 'paused';

  if (armed) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 p-5 bg-bg">
        <TallyDot size={16} />
        <p className="text-center text-[13px] text-mute max-w-[220px]">
          Pick the tab, window or screen you want to record. Recording starts after a 3‑second
          countdown.
        </p>
        <button
          type="button"
          onClick={() => void armAndCapture()}
          className="danger-btn px-5 py-3 text-[12px]"
        >
          ● Choose screen & start
        </button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col gap-3 p-3 bg-bg select-none">
      {/* preview + drag overlay */}
      <div
        className="relative rounded-lg overflow-hidden border border-line bg-black aspect-video"
        style={{ cursor, touchAction: 'none' }}
        {...handlers}
      >
        <video
          ref={videoRef}
          muted
          playsInline
          autoPlay
          className="absolute inset-0 h-full w-full object-contain pointer-events-none"
        />
        {phase === 'countdown' && (
          <div className="absolute inset-0 grid place-items-center bg-black/60">
            <span key={countdown} className="count-pop font-display font-bold text-6xl text-ink">
              {countdown}
            </span>
          </div>
        )}
        {paused && (
          <div className="absolute inset-0 grid place-items-center bg-black/50">
            <span className="label-mono !text-amber !text-[12px]">paused</span>
          </div>
        )}
        <div className="absolute top-1.5 left-1.5 flex items-center gap-1.5 bg-black/55 rounded-md px-2 py-1">
          <TallyDot live={recording} size={10} />
          <span className="font-mono text-[11px] text-ink tabular-nums">{clock}</span>
        </div>
      </div>

      {/* bubble controls */}
      {hasBubble && (
        <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 items-center">
          <div className="grid grid-cols-2 gap-1">
            {SNAP_CORNERS.map((corner) => (
              <button
                key={corner}
                type="button"
                title={`Snap ${corner}`}
                onClick={() => {
                  const dims = content();
                  updateBubble(
                    cornerPosition(corner, useStore.getState().settings.bubble, dims.w, dims.h),
                  );
                }}
                className="h-7 w-7 grid place-items-center rounded-md border border-line text-mute
                  hover:text-ink hover:border-line-strong text-[13px] cursor-pointer"
              >
                {CORNER_GLYPHS[corner]}
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-1">
            <SliderField
              label="cam zoom"
              value={bubble.zoom}
              min={ZOOM_MIN}
              max={ZOOM_MAX}
              step={0.05}
              onChange={(zoom) => updateBubble({ zoom })}
              format={(v) => `${v.toFixed(2)}×`}
            />
            <SliderField
              label="cam size"
              value={bubble.size}
              min={BUBBLE_MIN_SIZE}
              max={BUBBLE_MAX_SIZE}
              step={0.01}
              onChange={(size) => updateBubble({ size })}
              format={(v) => `${Math.round(v * 100)}%`}
            />
          </div>
        </div>
      )}

      {/* mic strip */}
      {micEnabled && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMicMuted(!micMuted)}
            className={`hairline-btn !px-2.5 !py-1.5 ${micMuted ? '!border-amber/60 !text-amber' : ''}`}
            title="Toggle mic (M)"
          >
            {micMuted ? 'mic off' : 'mic on'}
          </button>
          <div className="flex-1">
            <Meter level={micMuted ? 0 : level} />
          </div>
        </div>
      )}

      {/* transport */}
      <div className="mt-auto grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={togglePause}
          disabled={!recording && !paused}
          className="hairline-btn py-3"
          title="Pause/resume (Space)"
        >
          {paused ? '▶ resume' : '❚❚ pause'}
        </button>
        <button
          type="button"
          onClick={() => void stopRecording()}
          disabled={!recording && !paused}
          className="danger-btn py-3"
          title="Stop (S)"
        >
          ■ stop & save
        </button>
      </div>
    </div>
  );
}
