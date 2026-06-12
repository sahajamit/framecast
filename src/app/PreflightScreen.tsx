import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { runtime } from '../recorder/runtime';
import { onMediaChanged, startFlow, syncCamera, syncMic, updateBubble } from './controller';
import { drawScene } from '../compositor/scene';
import {
  BUBBLE_MAX_SIZE,
  BUBBLE_MIN_SIZE,
  ZOOM_MAX,
  ZOOM_MIN,
} from '../compositor/layout';
import { Field, Meter, Segmented, SelectField, SliderField, Toggle } from '../ui/controls';
import { useBubbleDrag } from '../ui/useBubbleDrag';
import { meterPosition, readLevel } from '../audio/levelMeter';
import { PRESETS } from '../recorder/encoderConfig';
import type { PresetId } from '../types';

const STAGE_W = 1280;
const STAGE_H = 720;

export function PreflightScreen() {
  const settings = useStore((s) => s.settings);
  const devices = useStore((s) => s.devices);
  const { patchSettings, patchBubble } = useStore.getState();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const camVideoRef = useRef<HTMLVideoElement>(null);
  const [micLevel, setMicLevel] = useState(0);
  const [, setMediaEpoch] = useState(0);

  // Acquire / release devices to match settings.
  useEffect(() => {
    void syncCamera();
  }, [settings.layout, settings.camId]);
  useEffect(() => {
    void syncMic();
  }, [settings.micEnabled, settings.micId, settings.micProcessing]);
  useEffect(() => onMediaChanged(() => setMediaEpoch((n) => n + 1)), []);

  // Bind the live camera to a hidden <video> that feeds the preview canvas.
  useEffect(() => {
    const video = camVideoRef.current;
    if (video && video.srcObject !== runtime.cameraStream) {
      video.srcObject = runtime.cameraStream;
      void video.play().catch(() => {});
    }
  });

  // Preview render loop — same drawScene the recording uses.
  const placeholder = useMemo(() => makeScreenPlaceholder(), []);
  useEffect(() => {
    let raf = 0;
    const ctx = canvasRef.current?.getContext('2d');
    const render = () => {
      raf = requestAnimationFrame(render);
      if (!ctx) return;
      const cam = camVideoRef.current;
      const camReady = cam && cam.videoWidth > 0 ? cam : null;
      const s = useStore.getState().settings;
      drawScene(ctx, {
        outW: STAGE_W,
        outH: STAGE_H,
        layout: s.layout,
        bubble: s.bubble,
        screen: { img: placeholder, w: STAGE_W, h: STAGE_H },
        camera: camReady ? { img: camReady, w: camReady.videoWidth, h: camReady.videoHeight } : null,
      });
    };
    render();
    return () => cancelAnimationFrame(raf);
  }, [placeholder]);

  // Mic meter.
  useEffect(() => {
    const tick = setInterval(() => {
      const graph = runtime.audioGraph;
      setMicLevel(
        graph && settings.micEnabled ? meterPosition(readLevel(graph.analyser).db) : 0,
      );
    }, 125);
    return () => clearInterval(tick);
  }, [settings.micEnabled]);

  const { handlers, cursor } = useBubbleDrag(
    () => ({ w: STAGE_W, h: STAGE_H }),
    settings.layout === 'screen+camera',
  );

  const canStart = settings.layout !== 'camera' || !!runtime.cameraStream;

  return (
    <div className="grid lg:grid-cols-[1fr_330px] gap-6 items-start rise-in">
      {/* stage */}
      <div className="flex flex-col gap-3">
        <div className="viewfinder rounded-sm">
          <div className="vf-b" />
          <canvas
            ref={canvasRef}
            width={STAGE_W}
            height={STAGE_H}
            {...handlers}
            style={{ cursor, touchAction: 'none' }}
            className="w-full rounded-sm border border-line bg-black"
          />
        </div>
        <div className="flex items-center justify-between px-1">
          <span className="label-mono">
            {settings.layout === 'screen+camera'
              ? 'drag the bubble · scroll over it to zoom'
              : settings.layout === 'screen'
                ? 'screen only — no camera overlay'
                : 'camera only — full frame'}
          </span>
          <span className="label-mono">
            {PRESETS[settings.presetId].label} · h.264
            {devices.audioCodec ? ` + ${devices.audioCodec}` : ''}
          </span>
        </div>
        <video ref={camVideoRef} muted playsInline className="hidden" />
      </div>

      {/* control rail */}
      <aside className="flex flex-col gap-5">
        <Field label="layout">
          <Segmented
            value={settings.layout}
            onChange={(layout) => patchSettings({ layout })}
            options={[
              { value: 'screen+camera', label: 'screen + cam' },
              { value: 'screen', label: 'screen' },
              { value: 'camera', label: 'camera' },
            ]}
          />
        </Field>

        {settings.layout !== 'screen' && (
          <div className="panel p-3.5 flex flex-col gap-3.5">
            <Field label="camera">
              <SelectField
                value={settings.camId ?? ''}
                onChange={(camId) => patchSettings({ camId: camId || null })}
                options={[
                  { value: '', label: 'Default camera' },
                  ...devices.cams.map((d) => ({
                    value: d.deviceId,
                    label: d.label || 'Camera',
                  })),
                ]}
              />
            </Field>
            <SliderField
              label="zoom (head framing)"
              value={settings.bubble.zoom}
              min={ZOOM_MIN}
              max={ZOOM_MAX}
              step={0.05}
              onChange={(zoom) => updateBubble({ zoom })}
              format={(v) => `${v.toFixed(2)}×`}
            />
            {settings.layout === 'screen+camera' && (
              <>
                <SliderField
                  label="bubble size"
                  value={settings.bubble.size}
                  min={BUBBLE_MIN_SIZE}
                  max={BUBBLE_MAX_SIZE}
                  step={0.01}
                  onChange={(size) => updateBubble({ size })}
                  format={(v) => `${Math.round(v * 100)}%`}
                />
                <Segmented
                  value={settings.bubble.shape}
                  onChange={(shape) => patchBubble({ shape })}
                  options={[
                    { value: 'circle', label: '● circle' },
                    { value: 'roundedRect', label: '▢ rounded' },
                  ]}
                />
              </>
            )}
            <div className="grid grid-cols-3 gap-2">
              <Toggle
                checked={settings.bubble.mirror}
                onChange={(mirror) => patchBubble({ mirror })}
                label="Mirror"
              />
              <Toggle
                checked={settings.bubble.border}
                onChange={(border) => patchBubble({ border })}
                label="Border"
              />
              <Toggle
                checked={settings.bubble.shadow}
                onChange={(shadow) => patchBubble({ shadow })}
                label="Shadow"
              />
            </div>
          </div>
        )}

        <div className="panel p-3.5 flex flex-col gap-3.5">
          <div className="flex items-center justify-between">
            <span className="label-mono">microphone</span>
            <Toggle
              checked={settings.micEnabled}
              onChange={(micEnabled) => patchSettings({ micEnabled })}
              label=""
            />
          </div>
          {settings.micEnabled && (
            <>
              <SelectField
                value={settings.micId ?? ''}
                onChange={(micId) => patchSettings({ micId: micId || null })}
                options={[
                  { value: '', label: 'Default microphone' },
                  ...devices.mics.map((d) => ({
                    value: d.deviceId,
                    label: d.label || 'Microphone',
                  })),
                ]}
              />
              <Meter level={micLevel} />
              <div className="grid grid-cols-3 gap-2">
                <Toggle
                  checked={settings.micProcessing.noiseSuppression}
                  onChange={(v) =>
                    patchSettings({
                      micProcessing: { ...settings.micProcessing, noiseSuppression: v },
                    })
                  }
                  label="Denoise"
                />
                <Toggle
                  checked={settings.micProcessing.echoCancellation}
                  onChange={(v) =>
                    patchSettings({
                      micProcessing: { ...settings.micProcessing, echoCancellation: v },
                    })
                  }
                  label="Echo"
                />
                <Toggle
                  checked={settings.micProcessing.autoGainControl}
                  onChange={(v) =>
                    patchSettings({
                      micProcessing: { ...settings.micProcessing, autoGainControl: v },
                    })
                  }
                  label="Gain"
                />
              </div>
            </>
          )}
        </div>

        <div className="panel p-3.5 flex flex-col gap-3.5">
          <Field label="quality">
            <SelectField
              value={settings.presetId}
              onChange={(presetId) => patchSettings({ presetId: presetId as PresetId })}
              options={Object.values(PRESETS).map((p) => ({ value: p.id, label: p.label }))}
            />
          </Field>
          {settings.layout !== 'camera' && (
            <>
              <Toggle
                checked={settings.captureSystemAudio}
                onChange={(captureSystemAudio) => patchSettings({ captureSystemAudio })}
                label="Capture tab / system audio"
              />
              {settings.captureSystemAudio && (
                <Toggle
                  checked={settings.suppressLocalAudioPlayback}
                  onChange={(suppressLocalAudioPlayback) =>
                    patchSettings({ suppressLocalAudioPlayback })
                  }
                  label="Mute it locally while recording"
                />
              )}
            </>
          )}
        </div>

        <button
          type="button"
          disabled={!canStart}
          onClick={() => void startFlow()}
          className="group relative w-full rounded-xl bg-rec hover:bg-rec-hot disabled:opacity-40
            disabled:cursor-not-allowed text-white font-display font-semibold text-[15px] py-4
            transition-colors cursor-pointer shadow-[0_8px_30px_rgba(255,90,78,0.28)]"
        >
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-white mr-2 align-middle group-hover:tally-live" />
          Start recording
        </button>
        <p className="label-mono text-center -mt-2">
          floating controls pop out · 3‑2‑1 countdown · saved straight to disk
        </p>
      </aside>
    </div>
  );
}

/** Stand-in for the screen feed before a capture surface is picked. */
function makeScreenPlaceholder(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = STAGE_W;
  canvas.height = STAGE_H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#0f1116';
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
  ctx.strokeStyle = 'rgba(235,240,255,0.028)';
  ctx.lineWidth = 10;
  for (let x = -STAGE_H; x < STAGE_W + STAGE_H; x += 36) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + STAGE_H, STAGE_H);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(235,240,255,0.28)';
  ctx.font = '600 30px "Bricolage Grotesque Variable", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Your screen appears here', STAGE_W / 2, STAGE_H / 2 - 12);
  ctx.fillStyle = 'rgba(235,240,255,0.16)';
  ctx.font = '13px "Spline Sans Mono Variable", monospace';
  ctx.fillText('YOU PICK A TAB · WINDOW · OR FULL SCREEN WHEN YOU HIT START', STAGE_W / 2, STAGE_H / 2 + 22);
  return canvas;
}
