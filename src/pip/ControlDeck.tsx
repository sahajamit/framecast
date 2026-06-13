import { useEffect, useRef, useState } from 'react';
import { elapsedMs, formatElapsed, useStore } from '../state/store';
import { runtime } from '../recorder/runtime';
import {
  resetFocus,
  setMicMuted,
  stopRecording,
  togglePause,
  updateBubble,
  updateFocus,
} from '../app/controller';
import { Fader, Lamp, Segmented, Timecode, VuMeter } from '../ui/controls';
import { useStageGestures, type FocusTool } from '../ui/useStageGestures';
import { readLevel, meterPosition } from '../audio/levelMeter';
import { registerShortcuts } from '../shortcuts/keyboard';
import {
  BUBBLE_MAX_SIZE,
  BUBBLE_MIN_SIZE,
  cornerPosition,
  focusForZoom,
  focusZoomFactor,
  ZOOM_MAX,
  ZOOM_MIN,
  type SnapCorner,
} from '../compositor/layout';

function snapTo(corner: SnapCorner): void {
  const session = runtime.session;
  const dims = session ? { w: session.width, h: session.height } : { w: 16, h: 9 };
  updateBubble(cornerPosition(corner, useStore.getState().settings.bubble, dims.w, dims.h));
}

const SNAPS: { corner: SnapCorner; cls: string }[] = [
  { corner: 'top-left', cls: 'nw' },
  { corner: 'top-right', cls: 'ne' },
  { corner: 'bottom-left', cls: 'sw' },
  { corner: 'bottom-right', cls: 'se' },
];

/**
 * The floating deck: the creator's cockpit mid-take. Lives in the Document
 * PiP window during recording (or inline in the tab when PiP is unavailable
 * / in e2e mode). Always dark — it is a video surface.
 */
export function ControlDeck({ windowRef }: { windowRef: Window }) {
  const phase = useStore((s) => s.session.phase);
  const countdown = useStore((s) => s.session.countdown);
  const micMuted = useStore((s) => s.session.micMuted);
  const bubble = useStore((s) => s.settings.bubble);
  const layout = useStore((s) => s.settings.layout);
  const micEnabled = useStore((s) => s.settings.micEnabled);
  const presetId = useStore((s) => s.settings.presetId);
  const focus = useStore((s) => s.focus);

  const videoRef = useRef<HTMLVideoElement>(null);
  const [clock, setClock] = useState('00:00');
  const [level, setLevel] = useState(0);
  const [tool, setTool] = useState<FocusTool>('off');

  const session = runtime.session;
  const hasBubble = layout === 'screen+camera';

  // Live composited preview.
  useEffect(() => {
    const video = videoRef.current;
    if (video && session && video.srcObject !== session.previewStream) {
      video.srcObject = session.previewStream;
      void video.play()?.catch(() => {});
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
        snap: snapTo,
        resetFocus: () => {
          setTool('off');
          resetFocus();
        },
      }),
    [windowRef],
  );

  const content = () => (session ? { w: session.width, h: session.height } : { w: 16, h: 9 });
  const { handlers, cursor, marquee } = useStageGestures(content, {
    bubbleEnabled: hasBubble && bubble.visible,
    focusEnabled: phase === 'recording' || phase === 'paused',
    getTool: () => tool,
  });

  function selectTool(t: FocusTool) {
    setTool(t);
    if (t === 'off') resetFocus();
  }
  function punchPreset(z: number) {
    setTool('zoom');
    updateFocus(focusForZoom(z));
  }
  const zoomReadout =
    focus.mode === 'zoom'
      ? `${focusZoomFactor(focus).toFixed(1)}×`
      : focus.mode === 'spotlight'
        ? 'SPOT'
        : '1.0×';

  const recording = phase === 'recording';
  const paused = phase === 'paused';
  const counting = phase === 'countdown';

  return (
    <div className="deck force-dark">
      <div className="deck-top">
        {counting ? (
          <span className="onair-word standby">
            <Lamp kind="warn" pulse />
            Stand by
          </span>
        ) : (
          <span className="onair-word">
            <Lamp kind="rec" pulse={recording} />
            On air
          </span>
        )}
        <span className="flex-1" />
        <Timecode live={recording} paused={paused}>
          {clock}
        </Timecode>
      </div>

      <div className="relative">
        <div className="stage" style={{ cursor, touchAction: 'none' }} {...handlers}>
          <video ref={videoRef} muted playsInline autoPlay className="object-contain pointer-events-none" />
          {marquee && (
            <div
              className="focus-marquee"
              style={{
                left: marquee.left,
                top: marquee.top,
                width: marquee.width,
                height: marquee.height,
              }}
            />
          )}
          {counting && (
            <div
              className="absolute inset-0 grid place-items-center"
              style={{ background: 'rgba(0,0,0,0.6)', zIndex: 5 }}
            >
              <span key={countdown} className="cd-num slam" style={{ fontSize: 84 }}>
                {countdown}
              </span>
            </div>
          )}
          {paused && (
            <div
              className="absolute inset-0 grid place-items-center"
              style={{ background: 'rgba(0,0,0,0.5)', zIndex: 5 }}
            >
              <span
                className="label"
                style={{ color: 'var(--color-warn)', fontSize: 12, letterSpacing: '0.3em' }}
              >
                paused
              </span>
            </div>
          )}
          {hasBubble &&
            SNAPS.map(({ corner, cls }) => (
              <button
                key={corner}
                type="button"
                className={`snap ${cls}`}
                title={`Snap bubble ${corner}`}
                aria-label={`Snap bubble ${corner}`}
                onClick={() => snapTo(corner)}
              />
            ))}
        </div>
      </div>

      <div className={`focus-strip ${focus.mode !== 'none' ? 'active' : ''}`}>
        <Segmented
          ariaLabel="Focus"
          value={tool}
          onChange={selectTool}
          options={[
            { value: 'off', label: 'Off' },
            { value: 'zoom', label: 'Punch' },
            { value: 'spotlight', label: 'Spot' },
          ]}
        />
        <div className="focus-row">
          <button type="button" className="btn-s" onClick={() => punchPreset(1.5)}>
            1.5×
          </button>
          <button type="button" className="btn-s" onClick={() => punchPreset(2)}>
            2×
          </button>
          <button
            type="button"
            className="btn-s"
            onClick={() => {
              setTool('off');
              resetFocus();
            }}
          >
            ⟲ 1×
          </button>
          <span className="flex-1" />
          <span className="focus-read mono-read">{zoomReadout}</span>
        </div>
      </div>

      {hasBubble && (
        <div className="grid grid-cols-2 gap-3.5">
          <Fader
            label="Zoom"
            value={bubble.zoom}
            min={ZOOM_MIN}
            max={ZOOM_MAX}
            step={0.05}
            onChange={(zoom) => updateBubble({ zoom })}
            format={(v) => `${v.toFixed(2)}×`}
          />
          <Fader
            label="Size"
            value={bubble.size}
            min={BUBBLE_MIN_SIZE}
            max={BUBBLE_MAX_SIZE}
            step={0.01}
            onChange={(size) => updateBubble({ size })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
        </div>
      )}

      {micEnabled && (
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            className={`btn-s ${micMuted ? 'danger' : ''}`}
            onClick={() => setMicMuted(!micMuted)}
            title="Toggle mic (M)"
          >
            {micMuted ? 'Muted' : 'Mute'}
          </button>
          <div className="flex-1">
            <VuMeter level={micMuted ? 0 : level} muted={micMuted} />
          </div>
        </div>
      )}

      <div className="flex gap-2.5 mt-auto">
        <button
          type="button"
          className="btn lg flex-1"
          onClick={togglePause}
          disabled={!recording && !paused}
          title="Pause/resume (Space)"
        >
          {paused ? '▶ Resume' : '❚❚ Pause'}
        </button>
        <button
          type="button"
          className="btn lg danger fill flex-1"
          onClick={() => void stopRecording()}
          disabled={!recording && !paused}
          title="Stop (S)"
        >
          ■ Stop & save
        </button>
      </div>

      <div className="deck-foot">
        <span>Framecast · {PRESET_LABELS[presetId] ?? presetId}</span>
        <span>Direct to disk</span>
      </div>
    </div>
  );
}

const PRESET_LABELS: Record<string, string> = {
  '1080p30': '1080p/30',
  '1080p60': '1080p/60',
  '1440p30': '1440p/30',
  '1440p60': '1440p/60',
  '2160p30': '4K/30',
};
