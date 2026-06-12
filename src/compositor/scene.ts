import type { BubbleGeometry, LayoutKind } from '../types';
import { bubbleRectPx, cameraSrcRect, containRect } from './layout';

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
  screen: DrawSource | null;
  camera: DrawSource | null;
}

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/**
 * Draws one composited frame. Pure with respect to inputs — used identically
 * by the preflight preview (video elements) and the compositor worker
 * (VideoFrames), so what you see is exactly what gets recorded.
 */
export function drawScene(ctx: Ctx2D, state: SceneState): void {
  const { outW, outH, layout, bubble, screen, camera } = state;
  ctx.clearRect(0, 0, outW, outH);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, outW, outH);

  if (layout === 'camera') {
    if (camera) drawCameraFull(ctx, camera, bubble, outW, outH);
    return;
  }

  if (screen) {
    const dst = containRect(screen.w, screen.h, outW, outH);
    ctx.drawImage(screen.img, dst.x, dst.y, dst.w, dst.h);
  }

  if (layout === 'screen+camera' && camera && bubble.visible) {
    drawBubble(ctx, camera, bubble, outW, outH);
  }
}

function drawCameraFull(
  ctx: Ctx2D,
  camera: DrawSource,
  bubble: BubbleGeometry,
  outW: number,
  outH: number,
): void {
  const src = cameraSrcRect(bubble.zoom, camera.w, camera.h, outW / outH);
  ctx.save();
  if (bubble.mirror) {
    ctx.translate(outW, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(camera.img, src.sx, src.sy, src.sw, src.sh, 0, 0, outW, outH);
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
