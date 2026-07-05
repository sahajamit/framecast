import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CAMERA_BACKGROUNDS } from '../compositor/cameraBackgrounds';
import { useStore } from '../state/store';
import { runtime } from '../recorder/runtime';
import {
  onMediaChanged,
  resetFocus,
  selectScreen,
  startFlow,
  stopScreenShare,
  syncCamera,
  syncMic,
  toast,
  updateBubble,
  updateCameraBackground,
  updateCameraLighting,
  updateFocus,
  updateFrame,
} from './controller';
import { drawScene } from '../compositor/scene';
import { FocusAnimator } from '../compositor/focus';
import {
  createMattingEngine,
  effectiveCameraBackground,
  type MattingEngine,
} from '../compositor/matting/engine';
import type { MattingStats } from '../compositor/matting/types';
import { HIGH_TIER_ENABLED } from '../compositor/matting/tiers';
import type { CameraMattingQuality } from '../types';
import { isSegDbg } from '../ui/debug';
import {
  BUBBLE_MAX_SIZE,
  BUBBLE_MIN_SIZE,
  CAMERA_BLUR_MAX,
  CAMERA_BLUR_MIN,
  DEFAULT_FOCUS,
  FOCUS_GLIDE_MS,
  FOCUS_ZOOM_MAX,
  focusForZoom,
  focusZoomFactor,
  PAD_MAX,
  RADIUS_MAX,
  screenFrameRect,
  ZOOM_MAX,
  ZOOM_MIN,
} from '../compositor/layout';
import { Fader, Module, Segmented, SelectField, Switch, Timecode, VuMeter } from '../ui/controls';
import { BackdropPicker } from '../ui/BackdropPicker';
import { CameraBackgroundPicker } from '../ui/CameraBackgroundPicker';
import {
  BRIGHTNESS_MAX,
  BRIGHTNESS_MIN,
  CONTRAST_MAX,
  CONTRAST_MIN,
  LIGHTING_PRESETS,
  lightingFromPreset,
  WARMTH_MAX,
  WARMTH_MIN,
} from '../compositor/lighting';
import { useStageGestures, type FocusTool } from '../ui/useStageGestures';
import { prefersReducedMotion } from '../ui/reducedMotion';
import { meterPosition, readLevel } from '../audio/levelMeter';
import { PRESETS } from '../recorder/encoderConfig';
import type { PresetId } from '../types';

const STAGE_W = 1280;
const STAGE_H = 720;

type TabId = 'program' | 'camera' | 'mic' | 'scene' | 'focus' | 'output';

export function PreflightScreen() {
  const settings = useStore((s) => s.settings);
  const devices = useStore((s) => s.devices);
  const screenReady = useStore((s) => s.session.screenReady);
  const screenInfo = useStore((s) => s.session.screenInfo);
  const focus = useStore((s) => s.focus);
  const { patchSettings, patchBubble } = useStore.getState();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const camVideoRef = useRef<HTMLVideoElement>(null);
  const screenVideoRef = useRef<HTMLVideoElement>(null);
  const focusAnim = useRef(new FocusAnimator(DEFAULT_FOCUS));
  const lastFocusTarget = useRef(DEFAULT_FOCUS);
  const segmenterRef = useRef<MattingEngine | null>(null);
  const [micLevel, setMicLevel] = useState(0);
  const [matting, setMatting] = useState<MattingStats | null>(null);
  const [tool, setTool] = useState<FocusTool>('off');
  // Camera-tab accordion: one section open at a time keeps the tab inside the
  // viewport now that it holds framing + background + lighting stacks.
  const [camFold, setCamFold] = useState<'framing' | 'background' | 'lighting' | null>(
    'background',
  );
  const toggleFold = (id: 'framing' | 'background' | 'lighting') =>
    setCamFold((cur) => (cur === id ? null : id));
  const [activeTab, setActiveTab] = useState<TabId>('program');
  const [, setMediaEpoch] = useState(0);

  // The control panel is a single tab at a time so it always fits without
  // scrolling. Tabs unavailable in the current layout are hidden.
  const tabs = (
    [
      { id: 'program', label: 'Program', show: true },
      { id: 'camera', label: 'Camera', show: settings.layout !== 'screen' },
      { id: 'mic', label: 'Mic', show: true },
      { id: 'scene', label: 'Scene', show: true },
      { id: 'focus', label: 'Focus', show: settings.layout !== 'camera' },
      { id: 'output', label: 'Output', show: true },
    ] as { id: TabId; label: string; show: boolean }[]
  ).filter((t) => t.show);

  // Acquire / release devices to match settings.
  useEffect(() => {
    void syncCamera();
  }, [settings.layout, settings.camId]);
  useEffect(() => {
    void syncMic();
  }, [settings.micEnabled, settings.micId, settings.micProcessing]);
  useEffect(() => onMediaChanged(() => setMediaEpoch((n) => n + 1)), []);

  // If the active tab isn't available in the current layout, fall back to Program.
  useEffect(() => {
    if (!tabs.some((t) => t.id === activeTab)) setActiveTab('program');
  }, [tabs, activeTab]);

  // Load / release the matting engine to match the chosen background mode,
  // so the preview shows exactly the background the recording will bake in.
  // The warm engine survives Blur ↔ Backdrop toggles (tearing it down would
  // flash the raw room for the model-reload seconds); only a quality change
  // or turning the feature off rebuilds/releases it. The preview caps itself
  // at the balanced tier: the High-tier matting model runs in the recording
  // worker only (plan Q6), so preflight edges are representative, the
  // recording's strictly equal or better.
  const engineQualityRef = useRef<CameraMattingQuality | null>(null);
  const bgActive = settings.cameraBackground.mode !== 'none' && settings.layout !== 'screen';
  useEffect(() => {
    if (!bgActive) {
      segmenterRef.current?.close();
      segmenterRef.current = null;
      engineQualityRef.current = null;
      return;
    }
    if (segmenterRef.current && engineQualityRef.current !== settings.cameraBackground.quality) {
      segmenterRef.current.close();
      segmenterRef.current = null;
    }
    if (!segmenterRef.current) {
      segmenterRef.current = createMattingEngine({
        quality: settings.cameraBackground.quality,
        maxTier: 'balanced',
      });
      engineQualityRef.current = settings.cameraBackground.quality;
    }
  }, [bgActive, settings.cameraBackground.quality]);
  useEffect(
    () => () => {
      segmenterRef.current?.close();
      segmenterRef.current = null;
    },
    [],
  );

  // Live matting tier readout (and the ?dbg=seg overlay) next to the Quality
  // control, so an auto-downshift is visible instead of silent.
  useEffect(() => {
    if (settings.cameraBackground.mode === 'none' || settings.layout === 'screen') {
      setMatting(null);
      return;
    }
    const tick = setInterval(() => {
      setMatting(segmenterRef.current?.stats() ?? null);
    }, 500);
    return () => clearInterval(tick);
  }, [settings.cameraBackground.mode, settings.layout]);

  // Bind the live camera + screen to hidden <video>s that feed the preview canvas.
  useEffect(() => {
    const cam = camVideoRef.current;
    if (cam && cam.srcObject !== runtime.cameraStream) {
      cam.srcObject = runtime.cameraStream;
      void cam.play()?.catch(() => {});
    }
    const screen = screenVideoRef.current;
    if (screen && screen.srcObject !== runtime.displayStream) {
      screen.srcObject = runtime.displayStream;
      void screen.play()?.catch(() => {});
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
      const screen = screenVideoRef.current;
      const screenLive =
        useStore.getState().session.screenReady && screen && screen.videoWidth > 0 ? screen : null;
      const live = useStore.getState();
      const s = live.settings;
      // Rehearse the punch-in with the same easer the recording uses (WYSIWYG).
      if (live.focus !== lastFocusTarget.current) {
        lastFocusTarget.current = live.focus;
        focusAnim.current.setTarget(
          live.focus,
          prefersReducedMotion() ? 0 : FOCUS_GLIDE_MS,
          performance.now(),
        );
      }
      focusAnim.current.tick(performance.now());
      const bgActive = s.cameraBackground.mode !== 'none';
      const seg = segmenterRef.current;
      if (bgActive && seg && camReady) {
        seg.push(camReady, camReady.videoWidth, camReady.videoHeight);
      }
      const drawStart = performance.now();
      drawScene(ctx, {
        outW: STAGE_W,
        outH: STAGE_H,
        layout: s.layout,
        bubble: s.bubble,
        frame: s.frame,
        focus: focusAnim.current.current,
        screen: screenLive
          ? { img: screenLive, w: screenLive.videoWidth, h: screenLive.videoHeight }
          : { img: placeholder, w: STAGE_W, h: STAGE_H },
        camera: camReady
          ? { img: camReady, w: camReady.videoWidth, h: camReady.videoHeight }
          : null,
        cameraBackground:
          bgActive && seg ? effectiveCameraBackground(s.cameraBackground, seg.tier) : s.cameraBackground,
        cameraMask: bgActive && seg ? seg.getMask() : null,
        cameraLightWrap:
          bgActive && !!seg && (seg.tier === 'high' || seg.tier === 'balanced'),
        cameraLighting: s.cameraLighting,
      });
      if (bgActive && seg) seg.noteDrawTime(performance.now() - drawStart, 33.3);
    };
    render();
    return () => cancelAnimationFrame(raf);
  }, [placeholder]);

  // Mic meter.
  useEffect(() => {
    const tick = setInterval(() => {
      const graph = runtime.audioGraph;
      setMicLevel(graph && settings.micEnabled ? meterPosition(readLevel(graph.analyser).db) : 0);
    }, 125);
    return () => clearInterval(tick);
  }, [settings.micEnabled]);

  const { handlers, cursor, marquee } = useStageGestures(() => ({ w: STAGE_W, h: STAGE_H }), {
    bubbleEnabled: settings.layout === 'screen+camera',
    focusEnabled: settings.layout !== 'camera' && screenReady,
    getTool: () => tool,
    getFrame: () => {
      const f = useStore.getState().settings.frame;
      // Snap to the screen frame (so the bubble can straddle the border) only
      // when framing is on; otherwise keep the canvas-corner snap.
      return f.backdrop !== 'none' || f.pad > 0
        ? screenFrameRect(f.pad, STAGE_W, STAGE_H)
        : undefined;
    },
  });

  function selectFocusTool(t: FocusTool) {
    setTool(t);
    if (t === 'off') resetFocus();
  }
  function punchPreset(z: number) {
    setTool('zoom');
    updateFocus(focusForZoom(z));
  }

  const needsScreen = settings.layout !== 'camera';
  const canStart = settings.layout === 'camera' ? !!runtime.cameraStream : screenReady;
  const micName = deviceLabel(devices.mics, settings.micId) ?? 'Default microphone';

  return (
    <div className="preflight-grid rise-in">
      {/* program monitor */}
      <div className="monitor">
        <div className="monitor-head">
          <span className="take-title">
            Program <em>monitor</em>
          </span>
          <span className="src-read">
            {needsScreen
              ? screenReady
                ? (screenInfo ?? 'sharing')
                : 'no source selected'
              : 'camera only'}
          </span>
          <div className="monitor-actions">
            {needsScreen &&
              (screenReady ? (
                <>
                  <button type="button" className="btn-s" onClick={() => void selectScreen()}>
                    Change
                  </button>
                  <button type="button" className="btn-s danger" onClick={stopScreenShare}>
                    Stop share
                  </button>
                </>
              ) : (
                <button type="button" className="btn-s accent" onClick={() => void selectScreen()}>
                  ⊞ Select screen
                </button>
              ))}
          </div>
        </div>
        <div className="stage force-dark" style={{ cursor, touchAction: 'none' }} {...handlers}>
          <canvas ref={canvasRef} width={STAGE_W} height={STAGE_H} />
          {isSegDbg() && matting && (
            <div className="seg-dbg">
              seg {matting.tier}
              {matting.demoted ? ' (demoted)' : ''} · infer {matting.inferMs.toFixed(1)}ms ·
              refine {matting.refineMs.toFixed(1)}ms · {matting.inferFps.toFixed(0)}fps
            </div>
          )}
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
        </div>
        <div className="monitor-strip">
          <span className={canStart ? 'ok' : ''}>● Signal</span>
          <span className="sep" />
          {settings.captureSystemAudio && needsScreen && <span>Tab audio in</span>}
          {settings.captureSystemAudio && needsScreen && <span className="sep" />}
          <span className="truncate">
            {settings.micEnabled ? `Mic open — ${micName}` : 'Mic off'}
          </span>
          <span className="flex-1" />
          <Timecode>00:00:00</Timecode>
        </div>
      </div>

      {/* tabbed control panel — one panel at a time, so it never scrolls */}
      <div className="config-panel">
        <div className="tab-bar" role="tablist" aria-label="Controls">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={activeTab === t.id}
              className={`tab-btn ${activeTab === t.id ? 'on' : ''}`}
              onClick={() => setActiveTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="tab-body">
          {activeTab === 'program' && (
            <Module title="Program" no="CH·01">
              <Segmented
                ariaLabel="Layout"
                value={settings.layout}
                onChange={(layout) => patchSettings({ layout })}
                options={[
                  { value: 'screen+camera', label: 'Scrn+Cam' },
                  { value: 'screen', label: 'Screen' },
                  { value: 'camera', label: 'Camera' },
                ]}
              />
              <p className="mod-hint">Pick what the take captures. Screen, camera, or both.</p>
            </Module>
          )}

          {activeTab === 'camera' && settings.layout !== 'screen' && (
            <Module title="Camera" no="CH·02">
              <Fold
                title="Framing"
                summary={`${settings.bubble.zoom.toFixed(2)}× · ${
                  settings.bubble.shape === 'circle' ? 'circle' : 'rounded'
                }`}
                open={camFold === 'framing'}
                onToggle={() => toggleFold('framing')}
              >
              <SelectField
                ariaLabel="Camera"
                value={settings.camId ?? ''}
                onChange={(camId) => patchSettings({ camId: camId || null })}
                options={[
                  { value: '', label: 'Default camera' },
                  ...devices.cams.map((d) => ({ value: d.deviceId, label: d.label || 'Camera' })),
                ]}
              />
              <div className="mt-3">
                <Fader
                  label="Zoom · head framing"
                  value={settings.bubble.zoom}
                  min={ZOOM_MIN}
                  max={ZOOM_MAX}
                  step={0.05}
                  onChange={(zoom) => updateBubble({ zoom })}
                  format={(v) => `${v.toFixed(2)}×`}
                />
              </div>
              {settings.layout === 'screen+camera' && (
                <>
                  <div className="mt-2">
                    <Fader
                      label="Bubble size"
                      value={settings.bubble.size}
                      min={BUBBLE_MIN_SIZE}
                      max={BUBBLE_MAX_SIZE}
                      step={0.01}
                      onChange={(size) => updateBubble({ size })}
                      format={(v) => `${Math.round(v * 100)}%`}
                    />
                  </div>
                  <div className="mt-3">
                    <Segmented
                      ariaLabel="Bubble shape"
                      value={settings.bubble.shape}
                      onChange={(shape) => patchBubble({ shape })}
                      options={[
                        { value: 'circle', label: 'Circle' },
                        { value: 'roundedRect', label: 'Rounded' },
                      ]}
                    />
                  </div>
                </>
              )}
              <div className="sw-row mt-4 px-2">
                <Switch
                  checked={settings.bubble.mirror}
                  onChange={(mirror) => patchBubble({ mirror })}
                  label="Mirror"
                />
                <Switch
                  checked={settings.bubble.border}
                  onChange={(border) => patchBubble({ border })}
                  label="Border"
                />
                <Switch
                  checked={settings.bubble.shadow}
                  onChange={(shadow) => patchBubble({ shadow })}
                  label="Shadow"
                />
              </div>
              </Fold>

              <Fold
                title="Background"
                summary={
                  settings.cameraBackground.mode === 'none'
                    ? 'Off'
                    : settings.cameraBackground.mode === 'blur'
                      ? 'Blur'
                      : (CAMERA_BACKGROUNDS.find(
                          (b) => b.id === settings.cameraBackground.builtinId,
                        )?.label ?? 'Custom')
                }
                open={camFold === 'background'}
                onToggle={() => toggleFold('background')}
              >
                <div>
                  <Segmented
                    ariaLabel="Camera background"
                    value={settings.cameraBackground.mode}
                    onChange={(mode) => updateCameraBackground({ mode })}
                    options={[
                      { value: 'none', label: 'None' },
                      { value: 'blur', label: 'Blur' },
                      { value: 'builtin', label: 'Backdrop' },
                    ]}
                  />
                </div>
                {settings.cameraBackground.mode === 'blur' && (
                  <div className="mt-2">
                    <Fader
                      label="Blur strength"
                      value={settings.cameraBackground.blur}
                      min={CAMERA_BLUR_MIN}
                      max={CAMERA_BLUR_MAX}
                      step={1}
                      onChange={(blur) => updateCameraBackground({ blur })}
                      format={(v) => `${Math.round(v)}`}
                    />
                  </div>
                )}
                {settings.cameraBackground.mode === 'builtin' && (
                  <div className="mt-3">
                    <CameraBackgroundPicker
                      value={settings.cameraBackground.builtinId}
                      onChange={(builtinId) => updateCameraBackground({ builtinId })}
                    />
                  </div>
                )}
                {settings.cameraBackground.mode !== 'none' && (
                  <>
                    <div className="mt-3">
                      <div className="ctl-row">
                        <span className="ctl-name">Quality</span>
                        {matting && (
                          <span className="ctl-val" title="Live matting tier">
                            {matting.demoted ? '▾ ' : ''}
                            {matting.tier.toUpperCase()}
                          </span>
                        )}
                      </div>
                      <div className="mt-2">
                        <Segmented
                          ariaLabel="Matting quality"
                          value={settings.cameraBackground.quality}
                          onChange={(quality) => updateCameraBackground({ quality })}
                          options={[
                            { value: 'auto', label: 'Auto' },
                            // High reappears when the RVM/WebGPU tier is
                            // re-enabled (see tiers.ts HIGH_TIER_ENABLED).
                            ...(HIGH_TIER_ENABLED
                              ? [{ value: 'high' as const, label: 'High' }]
                              : []),
                            { value: 'balanced', label: 'Balanced' },
                            { value: 'lite', label: 'Lite' },
                          ]}
                        />
                      </div>
                    </div>
                    <p className="mod-hint">
                      Your room is replaced live, on-device. Nothing leaves the machine. Auto
                      picks the best quality this device sustains and steps down before a take
                      ever stutters.
                    </p>
                  </>
                )}
              </Fold>

              <Fold
                title="Lighting"
                summary={
                  LIGHTING_PRESETS.find((p) => p.id === settings.cameraLighting.preset)?.label ??
                  'Off'
                }
                open={camFold === 'lighting'}
                onToggle={() => toggleFold('lighting')}
              >
                <div>
                  <Segmented
                    ariaLabel="Camera lighting"
                    value={settings.cameraLighting.preset}
                    onChange={(preset) => updateCameraLighting(lightingFromPreset(preset))}
                    options={LIGHTING_PRESETS.map((p) => ({ value: p.id, label: p.label }))}
                  />
                </div>
                {settings.cameraLighting.preset !== 'off' && (
                  <>
                    <div className="mt-3">
                      <Fader
                        label="Brightness"
                        value={settings.cameraLighting.brightness}
                        min={BRIGHTNESS_MIN}
                        max={BRIGHTNESS_MAX}
                        step={0.01}
                        onChange={(brightness) => updateCameraLighting({ brightness })}
                        format={(v) => `${Math.round(v * 100)}%`}
                      />
                    </div>
                    <div className="mt-2">
                      <Fader
                        label="Warmth"
                        value={settings.cameraLighting.warmth}
                        min={WARMTH_MIN}
                        max={WARMTH_MAX}
                        step={0.02}
                        onChange={(warmth) => updateCameraLighting({ warmth })}
                        format={(v) =>
                          v === 0 ? 'Neutral' : v > 0 ? `Warm ${Math.round(v * 100)}` : `Cool ${Math.round(-v * 100)}`
                        }
                      />
                    </div>
                    <div className="mt-2">
                      <Fader
                        label="Contrast"
                        value={settings.cameraLighting.contrast}
                        min={CONTRAST_MIN}
                        max={CONTRAST_MAX}
                        step={0.01}
                        onChange={(contrast) => updateCameraLighting({ contrast })}
                        format={(v) => `${Math.round(v * 100)}%`}
                      />
                    </div>
                    <p className="mod-hint">
                      Baked into the recording, on-device. For a dim room, start with Neutral+.
                    </p>
                  </>
                )}
              </Fold>
            </Module>
          )}

          {activeTab === 'mic' && (
            <Module
              title="Mic"
              no="CH·03"
              val={
                <Switch
                  horizontal
                  checked={settings.micEnabled}
                  onChange={(micEnabled) => patchSettings({ micEnabled })}
                  label="Microphone on"
                />
              }
            >
              {settings.micEnabled && (
                <>
                  <SelectField
                    ariaLabel="Microphone"
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
                  <div className="mt-3">
                    <VuMeter level={micLevel} />
                    <div className="vu-cap">
                      <span>−60</span>
                      <span>−24</span>
                      <span>−12</span>
                      <span>0</span>
                    </div>
                  </div>
                  <div className="sw-row mt-4 px-2">
                    <Switch
                      checked={settings.micProcessing.noiseSuppression}
                      onChange={(v) =>
                        patchSettings({
                          micProcessing: { ...settings.micProcessing, noiseSuppression: v },
                        })
                      }
                      label="Denoise"
                    />
                    <Switch
                      checked={settings.micProcessing.echoCancellation}
                      onChange={(v) =>
                        patchSettings({
                          micProcessing: { ...settings.micProcessing, echoCancellation: v },
                        })
                      }
                      label="Echo"
                    />
                    <Switch
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
            </Module>
          )}

          {activeTab === 'scene' && (
            <Module title="Scene" no="CH·04">
              <BackdropPicker
                value={settings.frame.backdrop}
                onChange={(backdrop) => updateFrame({ backdrop })}
              />
              <div className="mt-3">
                <Fader
                  label="Padding"
                  value={settings.frame.pad}
                  min={0}
                  max={PAD_MAX}
                  step={0.005}
                  onChange={(pad) => updateFrame({ pad })}
                  format={(v) => `${Math.round(v * 100)}%`}
                />
              </div>
              <div className="mt-2">
                <Fader
                  label="Corner radius"
                  value={settings.frame.radius}
                  min={0}
                  max={RADIUS_MAX}
                  step={1}
                  onChange={(radius) => updateFrame({ radius })}
                  format={(v) => `${Math.round(v)} px`}
                />
              </div>
              <div className="ctl-row mt-4">
                <span className="ctl-name">Drop shadow</span>
                <Switch
                  horizontal
                  checked={settings.frame.shadow}
                  onChange={(shadow) => updateFrame({ shadow })}
                  label="Drop shadow"
                />
              </div>
              <p className="mod-hint">Padding trades screen pixels for style.</p>
            </Module>
          )}

          {activeTab === 'focus' && settings.layout !== 'camera' && (
            <Module title="Focus" no="CH·05">
              <Segmented
                ariaLabel="Focus"
                value={tool}
                onChange={selectFocusTool}
                options={[
                  { value: 'off', label: 'Off' },
                  { value: 'zoom', label: 'Punch' },
                  { value: 'spotlight', label: 'Spot' },
                ]}
              />
              <div className="mt-3">
                <Fader
                  label="Screen zoom"
                  value={focus.mode === 'zoom' ? focusZoomFactor(focus) : 1}
                  min={1}
                  max={FOCUS_ZOOM_MAX}
                  step={0.1}
                  onChange={(z) => punchPreset(z)}
                  format={(v) => `${v.toFixed(1)}×`}
                />
              </div>
              <div className="sw-row mt-4 px-2">
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
              </div>
              <p className="mod-hint">Drag on the monitor to target a region. 0 or Esc to exit.</p>
            </Module>
          )}

          {activeTab === 'output' && (
            <Module title="Output" no="OUT">
              <SelectField
                ariaLabel="Quality preset"
                mono
                value={settings.presetId}
                onChange={(presetId) => patchSettings({ presetId: presetId as PresetId })}
                options={Object.values(PRESETS).map((p) => ({ value: p.id, label: p.label }))}
              />
              {settings.layout !== 'camera' && (
                <>
                  <div className="ctl-row mt-4">
                    <span className="ctl-name">Capture tab / system audio</span>
                    <Switch
                      horizontal
                      checked={settings.captureSystemAudio}
                      onChange={(captureSystemAudio) => {
                        patchSettings({ captureSystemAudio });
                        if (useStore.getState().session.screenReady) {
                          toast('Audio capture applies the next time you select a screen.');
                        }
                      }}
                      label="Capture tab or system audio"
                    />
                  </div>
                  {settings.captureSystemAudio && (
                    <div className="ctl-row mt-2">
                      <span className="ctl-name">Mute locally on roll</span>
                      <Switch
                        horizontal
                        checked={settings.suppressLocalAudioPlayback}
                        onChange={(suppressLocalAudioPlayback) =>
                          patchSettings({ suppressLocalAudioPlayback })
                        }
                        label="Mute locally while recording"
                      />
                    </div>
                  )}
                </>
              )}
            </Module>
          )}
        </div>

      </div>

      <video ref={camVideoRef} muted playsInline className="hidden" />
      <video ref={screenVideoRef} muted playsInline className="hidden" />
    </div>
  );
}

function deviceLabel(devices: MediaDeviceInfo[], id: string | null): string | null {
  if (!id) return null;
  return devices.find((d) => d.deviceId === id)?.label ?? null;
}

/**
 * The transport control, docked in the app header rail so it stays reachable
 * no matter how long the active preflight tab grows (the Camera tab in
 * particular). Same punch key, same arming rules as always: camera layout
 * arms on a live camera, screen layouts arm on a picked surface.
 */
export function HeaderRollTape() {
  const layout = useStore((s) => s.settings.layout);
  const screenReady = useStore((s) => s.session.screenReady);
  const [, setMediaEpoch] = useState(0);
  // runtime.cameraStream is a live object outside the store; re-render on
  // device changes the same way the preflight screen does.
  useEffect(() => onMediaChanged(() => setMediaEpoch((n) => n + 1)), []);
  const canStart = layout === 'camera' ? !!runtime.cameraStream : screenReady;
  return (
    <div className="hdr-roll" data-testid="header-roll-tape">
      <button
        type="button"
        className="punch punch-hdr"
        aria-label="Roll tape"
        disabled={!canStart}
        onClick={() => void startFlow()}
      />
      <div className="hdr-roll-meta">
        <div className="word">Roll tape</div>
        <div className="sub">
          {canStart
            ? 'Arms · 3 · 2 · 1'
            : layout === 'camera'
              ? 'Waiting for the camera'
              : 'Select a screen to arm'}
        </div>
      </div>
    </div>
  );
}

/**
 * Collapsible sub-section for a control panel that has outgrown one screen
 * (the Camera tab in particular). Accordion-style: the parent keeps one open
 * at a time so the tab never needs scrolling; the closed header still shows
 * a live summary so nothing is invisible while folded.
 */
function Fold({
  title,
  summary,
  open,
  onToggle,
  children,
}: {
  title: string;
  summary: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className={`fold ${open ? 'open' : ''}`}>
      <button type="button" className="fold-head" aria-expanded={open} onClick={onToggle}>
        <span className="fold-title">{title}</span>
        <span className="fold-sum">{summary}</span>
        <span className="fold-chev" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open && <div className="fold-body">{children}</div>}
    </section>
  );
}

/** Stand-in for the screen feed before a capture surface is picked. */
function makeScreenPlaceholder(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = STAGE_W;
  canvas.height = STAGE_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas; // e.g. jsdom in component tests
  // Diagonal video-well stripes per the Console stage spec.
  ctx.fillStyle = '#0a0908';
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
  ctx.strokeStyle = '#11100d';
  ctx.lineWidth = 14;
  for (let x = -STAGE_H; x < STAGE_W + STAGE_H; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + STAGE_H, STAGE_H);
    ctx.stroke();
  }
  ctx.textAlign = 'center';
  ctx.fillStyle = '#4a443a';
  ctx.font = '600 34px "Big Shoulders Display Variable", sans-serif';
  const title = 'P R O G R A M   M O N I T O R';
  ctx.fillText(title, STAGE_W / 2, STAGE_H / 2 - 10);
  ctx.fillStyle = '#363129';
  ctx.font = '13px "IBM Plex Mono", monospace';
  ctx.fillText(
    '· HIT “SELECT SCREEN” — TAB / WINDOW / ENTIRE SCREEN ·',
    STAGE_W / 2,
    STAGE_H / 2 + 26,
  );
  return canvas;
}
