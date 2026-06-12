/// <reference lib="webworker" />
import { drawScene } from './scene';
import type { FromCompositor, ToCompositor } from './protocol';
import type { BubbleGeometry, LayoutKind } from '../types';

declare const self: DedicatedWorkerGlobalScope;

let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;
let writer: WritableStreamDefaultWriter<VideoFrame> | null = null;
let outW = 0;
let outH = 0;
let frameIntervalMs = 1000 / 30;
let layout: LayoutKind = 'screen+camera';
let bubble: BubbleGeometry | null = null;

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
      init(msg.width, msg.height, msg.fps, msg.layout, msg.bubble, msg.screen, msg.camera, msg.out);
      break;
    case 'bubble':
      bubble = msg.bubble;
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
  screen: ReadableStream<VideoFrame> | null,
  camera: ReadableStream<VideoFrame> | null,
  out: WritableStream<VideoFrame>,
): void {
  outW = width;
  outH = height;
  frameIntervalMs = 1000 / fps;
  layout = initialLayout;
  bubble = initialBubble;
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
  if (!ctx || !canvas || !writer || !bubble) return;
  drawScene(ctx, {
    outW,
    outH,
    layout,
    bubble,
    screen: latestScreen
      ? { img: latestScreen, w: latestScreen.displayWidth, h: latestScreen.displayHeight }
      : null,
    camera: latestCamera
      ? { img: latestCamera, w: latestCamera.displayWidth, h: latestCamera.displayHeight }
      : null,
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
}

async function stop(): Promise<void> {
  stopped = true;
  if (heartbeat !== null) clearInterval(heartbeat);
  if (drawTimer !== null) clearTimeout(drawTimer);
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
