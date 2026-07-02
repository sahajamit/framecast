/// <reference lib="webworker" />
import { drawScene } from './scene';
import { FocusAnimator } from './focus';
import { FOCUS_GLIDE_MS } from './layout';
import type { FromCompositor, ToCompositor } from './protocol';
import type { BubbleGeometry, CameraBackground, FrameSettings, LayoutKind, ScreenFocus } from '../types';
import { createCameraSegmenter, type CameraSegmenter } from './segmentation';

declare const self: DedicatedWorkerGlobalScope;

let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;
let writer: WritableStreamDefaultWriter<VideoFrame> | null = null;
let outW = 0;
let outH = 0;
let frameIntervalMs = 1000 / 30;
let layout: LayoutKind = 'screen+camera';
let bubble: BubbleGeometry | null = null;
let sceneFrame: FrameSettings | null = null;
let cameraBackground: CameraBackground | null = null;
let segmenter: CameraSegmenter | null = null;
let focus: FocusAnimator | null = null;

let latestScreen: VideoFrame | null = null;
let latestCamera: VideoFrame | null = null;
let dirty = false;
let lastDrawAt = 0;
let drawTimer: ReturnType<typeof setTimeout> | null = null;
let heartbeat: ReturnType<typeof setInterval> | null = null;
let stopped = false;
let sentFirstFrame = false;

function post(message: FromCompositor): void {
  self.postMessage(message);
}

self.onmessage = (event: MessageEvent<ToCompositor>) => {
  const msg = event.data;
  switch (msg.type) {
    case 'init':
      init(
        msg.width,
        msg.height,
        msg.fps,
        msg.layout,
        msg.bubble,
        msg.frame,
        msg.cameraBackground,
        msg.focus,
        msg.screen,
        msg.camera,
        msg.out,
      );
      break;
    case 'bubble':
      bubble = msg.bubble;
      dirty = true;
      scheduleDraw();
      break;
    case 'frame':
      sceneFrame = msg.frame;
      dirty = true;
      scheduleDraw();
      break;
    case 'cameraBackground':
      cameraBackground = msg.cameraBackground;
      ensureSegmenter();
      dirty = true;
      scheduleDraw();
      break;
    case 'focus':
      focus?.setTarget(msg.focus, msg.animate ? FOCUS_GLIDE_MS : 0, performance.now());
      dirty = true;
      scheduleDraw();
      break;
    case 'stop':
      void stop();
      break;
  }
};

function init(
  width: number,
  height: number,
  fps: number,
  initialLayout: LayoutKind,
  initialBubble: BubbleGeometry,
  initialFrame: FrameSettings,
  initialCameraBackground: CameraBackground,
  initialFocus: ScreenFocus,
  screen: ReadableStream<VideoFrame> | null,
  camera: ReadableStream<VideoFrame> | null,
  out: WritableStream<VideoFrame>,
): void {
  outW = width;
  outH = height;
  frameIntervalMs = 1000 / fps;
  layout = initialLayout;
  bubble = initialBubble;
  sceneFrame = initialFrame;
  cameraBackground = initialCameraBackground;
  // Load the segmentation model during the countdown-to-record window (this
  // init runs at "0"), never lazily mid-frame, so the model is warm by the time
  // frames flow and the pipeline never idles waiting on it (invariant #8).
  if (camera) ensureSegmenter();
  focus = new FocusAnimator(initialFocus);
  canvas = new OffscreenCanvas(width, height);
  ctx = canvas.getContext('2d', { desynchronized: true });
  if (!ctx) {
    post({ type: 'fatal', message: 'Could not create 2D canvas context in worker' });
    return;
  }
  writer = out.getWriter();
  if (screen) void pump(screen, 'screen');
  if (camera) void pump(camera, 'camera');
  // Re-emit the last composited frame during static-screen stretches so the
  // muxer keeps receiving fragments. Worker timers may be throttled to 1 Hz in
  // hidden tabs, which is exactly the cadence needed here.
  heartbeat = setInterval(() => {
    if (!stopped && performance.now() - lastDrawAt > 950 && (latestScreen || latestCamera)) {
      draw();
    }
  }, 1000);
}

/** Lazily spin up the segmentation model, only when a background mode is on. */
function ensureSegmenter(): void {
  if (segmenter || stopped || layout === 'screen') return;
  if (!cameraBackground || cameraBackground.mode === 'none') return;
  segmenter = createCameraSegmenter();
}

function segmentationActive(): boolean {
  return !!segmenter && !!cameraBackground && cameraBackground.mode !== 'none';
}

async function pump(stream: ReadableStream<VideoFrame>, kind: 'screen' | 'camera'): Promise<void> {
  const reader = stream.getReader();
  for (;;) {
    let result: ReadableStreamReadResult<VideoFrame>;
    try {
      result = await reader.read();
    } catch {
      break;
    }
    if (result.done || stopped) {
      result.value?.close();
      break;
    }
    const frame = result.value;
    if (kind === 'screen') {
      latestScreen?.close();
      latestScreen = frame;
    } else {
      latestCamera?.close();
      latestCamera = frame;
      // Feed the segmenter off the draw path: push() copies the pixels
      // synchronously, so closing this frame on the next read can't race it.
      if (segmentationActive()) segmenter!.push(frame, frame.displayWidth, frame.displayHeight);
    }
    dirty = true;
    scheduleDraw();
  }
  if (!stopped) post({ type: 'sourceEnded', source: kind });
}

/** Draw as soon as the frame interval allows, coalescing bursts. */
function scheduleDraw(): void {
  if (drawTimer !== null || stopped) return;
  const wait = Math.max(0, lastDrawAt + frameIntervalMs - performance.now());
  drawTimer = setTimeout(() => {
    drawTimer = null;
    if (!stopped && dirty) draw();
  }, wait);
}

function draw(): void {
  if (!ctx || !canvas || !writer || !bubble || !sceneFrame || !focus) return;
  // Advance the punch-in glide before composing so this frame reflects it.
  const animating = focus.tick(performance.now());
  drawScene(ctx, {
    outW,
    outH,
    layout,
    bubble,
    frame: sceneFrame,
    focus: focus.current,
    screen: latestScreen
      ? { img: latestScreen, w: latestScreen.displayWidth, h: latestScreen.displayHeight }
      : null,
    camera: latestCamera
      ? { img: latestCamera, w: latestCamera.displayWidth, h: latestCamera.displayHeight }
      : null,
    cameraBackground: cameraBackground ?? undefined,
    cameraMask: segmentationActive() ? segmenter!.getMask() : null,
  });
  const frame = new VideoFrame(canvas, {
    timestamp: Math.round(performance.now() * 1000),
    duration: Math.round(frameIntervalMs * 1000),
  });
  // The MediaStreamTrackGenerator consumes (and closes) written frames.
  writer.write(frame).catch(() => {});
  lastDrawAt = performance.now();
  dirty = false;
  if (!sentFirstFrame) {
    sentFirstFrame = true;
    post({ type: 'firstFrame' });
  }
  // Keep the glide running at frame rate even on a static screen (the 1 Hz
  // heartbeat is too slow). The last frame returns false and we fall back to it.
  if (animating) {
    dirty = true;
    scheduleDraw();
  }
}

async function stop(): Promise<void> {
  stopped = true;
  if (heartbeat !== null) clearInterval(heartbeat);
  if (drawTimer !== null) clearTimeout(drawTimer);
  segmenter?.close();
  segmenter = null;
  focus = null;
  latestScreen?.close();
  latestCamera?.close();
  latestScreen = null;
  latestCamera = null;
  try {
    await writer?.close();
  } catch {
    // Generator may already be ended.
  }
  post({ type: 'stopped' });
}
