import type { BubbleGeometry, FrameSettings, LayoutKind, ScreenFocus } from '../types';
import {
  bubbleRectPx,
  cameraSrcRect,
  containRect,
  frameRadiusPx,
  screenFrameRect,
  screenSrcRect,
  SPOTLIGHT_DIM,
} from './layout';
import type { Box } from './layout';
import { paintBackdrop } from './backdrops';

/** A drawable image plus its intrinsic dimensions (VideoFrame, video element, canvas…). */
export interface DrawSource {
  img: CanvasImageSource;
  w: number;
  h: number;
}

export interface SceneState {
  outW: number;
  outH: number;
  layout: LayoutKind;
  bubble: BubbleGeometry;
  frame: FrameSettings;
  focus: ScreenFocus;
  screen: DrawSource | null;
  camera: DrawSource | null;
}

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Dark panel behind the inset content, shown in any aspect gap inside the frame. */
const CARD_WELL = '#0a0908';

/**
 * Draws one composited frame. Pure with respect to inputs — used identically
 * by the preflight preview (video elements) and the compositor worker
 * (VideoFrames), so what you see is exactly what gets recorded.
 *
 * Order: backdrop (fills the canvas) → inset screen/camera in a rounded,
 * optionally shadowed frame → camera bubble on top (clamped to the full canvas,
 * so it can straddle the frame edge). `backdrop:'none'` with pad 0 and radius 0
 * reproduces the original full-bleed output.
 */
export function drawScene(ctx: Ctx2D, state: SceneState): void {
  const { outW, outH, layout, bubble, frame, focus, screen, camera } = state;

  paintBackdrop(ctx, frame.backdrop, outW, outH, screen);

  const box = screenFrameRect(frame.pad, outW, outH);
  const radius = Math.min(frameRadiusPx(frame.radius, outH), Math.min(box.w, box.h) / 2);

  if (layout === 'camera') {
    if (camera) drawFramedCamera(ctx, camera, bubble, box, radius, frame.shadow, outH);
    return;
  }

  if (screen) {
    drawFramedScreen(ctx, screen, box, radius, frame.shadow, outH, focus);
  }

  if (layout === 'screen+camera' && camera && bubble.visible) {
    drawBubble(ctx, camera, bubble, outW, outH);
  }
}

function roundRectPath(ctx: Ctx2D, box: Box, r: number): void {
  ctx.beginPath();
  ctx.roundRect(box.x, box.y, box.w, box.h, r);
}

/** Soft drop shadow cast by the framed card onto the backdrop. */
function drawCardShadow(ctx: Ctx2D, box: Box, radius: number, outH: number): void {
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
  ctx.shadowBlur = Math.max(8, outH * 0.025);
  ctx.shadowOffsetY = Math.max(2, outH * 0.006);
  ctx.fillStyle = '#000';
  roundRectPath(ctx, box, radius);
  ctx.fill();
  ctx.restore();
}

function drawFramedScreen(
  ctx: Ctx2D,
  screen: DrawSource,
  box: Box,
  radius: number,
  shadow: boolean,
  outH: number,
  focus: ScreenFocus,
): void {
  if (shadow) drawCardShadow(ctx, box, radius, outH);
  ctx.save();
  roundRectPath(ctx, box, radius);
  ctx.clip();
  ctx.fillStyle = CARD_WELL;
  ctx.fillRect(box.x, box.y, box.w, box.h);
  const dst = containRect(screen.w, screen.h, box.w, box.h);
  const dx = box.x + dst.x;
  const dy = box.y + dst.y;
  if (focus.mode === 'zoom') {
    // Crop the source to the focus region and stretch it onto the same dst the
    // screen fills at 1x — a punch-in that resamples from native-res pixels.
    const src = screenSrcRect(focus, screen.w, screen.h);
    ctx.drawImage(screen.img, src.sx, src.sy, src.sw, src.sh, dx, dy, dst.w, dst.h);
  } else {
    ctx.drawImage(screen.img, dx, dy, dst.w, dst.h);
    if (focus.mode === 'spotlight') {
      drawSpotlight(ctx, box, {
        x: dx + (focus.cx - focus.w / 2) * dst.w,
        y: dy + (focus.cy - focus.h / 2) * dst.h,
        w: focus.w * dst.w,
        h: focus.h * dst.h,
      });
    }
  }
  ctx.restore();
}

/** Dims the framed card outside a bright region, to point without zooming. */
function drawSpotlight(ctx: Ctx2D, box: Box, region: Box): void {
  const r = Math.min(region.w, region.h) * 0.04;
  ctx.save();
  ctx.beginPath();
  ctx.rect(box.x, box.y, box.w, box.h);
  ctx.roundRect(region.x, region.y, region.w, region.h, r);
  ctx.fillStyle = `rgba(0, 0, 0, ${SPOTLIGHT_DIM})`;
  ctx.fill('evenodd');
  ctx.restore();
}

function drawFramedCamera(
  ctx: Ctx2D,
  camera: DrawSource,
  bubble: BubbleGeometry,
  box: Box,
  radius: number,
  shadow: boolean,
  outH: number,
): void {
  if (shadow) drawCardShadow(ctx, box, radius, outH);
  const src = cameraSrcRect(bubble.zoom, camera.w, camera.h, box.w / box.h);
  ctx.save();
  roundRectPath(ctx, box, radius);
  ctx.clip();
  ctx.translate(box.x + box.w / 2, box.y + box.h / 2);
  if (bubble.mirror) ctx.scale(-1, 1);
  ctx.drawImage(camera.img, src.sx, src.sy, src.sw, src.sh, -box.w / 2, -box.h / 2, box.w, box.h);
  ctx.restore();
}

function drawBubble(
  ctx: Ctx2D,
  camera: DrawSource,
  bubble: BubbleGeometry,
  outW: number,
  outH: number,
): void {
  const rect = bubbleRectPx(bubble, outW, outH);
  const src = cameraSrcRect(bubble.zoom, camera.w, camera.h, 1);

  if (bubble.shadow) {
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
    ctx.shadowBlur = rect.w * 0.12;
    ctx.shadowOffsetY = rect.w * 0.03;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.roundRect(rect.x, rect.y, rect.w, rect.h, rect.r);
    ctx.fill();
    ctx.restore();
  }

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(rect.x, rect.y, rect.w, rect.h, rect.r);
  ctx.clip();
  ctx.translate(rect.x + rect.w / 2, rect.y + rect.h / 2);
  if (bubble.mirror) ctx.scale(-1, 1);
  ctx.drawImage(camera.img, src.sx, src.sy, src.sw, src.sh, -rect.w / 2, -rect.h / 2, rect.w, rect.h);
  ctx.restore();

  if (bubble.border) {
    ctx.save();
    ctx.beginPath();
    const inset = Math.max(1.5, rect.w * 0.008);
    ctx.roundRect(
      rect.x + inset / 2,
      rect.y + inset / 2,
      rect.w - inset,
      rect.h - inset,
      Math.max(0, rect.r - inset / 2),
    );
    ctx.lineWidth = inset;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.stroke();
    ctx.restore();
  }
}
