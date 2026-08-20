import type {
  BubbleGeometry,
  CameraBackground,
  CameraLighting,
  FrameSettings,
  LayoutKind,
  ScreenFocus,
} from '../types';
import {
  bubbleRectPx,
  cameraSrcRect,
  containRect,
  frameRadiusPx,
  screenFrameRect,
  screenSrcRect,
  SPOTLIGHT_DIM,
} from './layout';
import type { Box, SrcRect } from './layout';
import { paintBackdrop, paintCameraBlur } from './backdrops';
import { paintCameraBackgroundFill } from './cameraBackgrounds';
import { applyCameraGrade } from './lighting';
import type { MaskSource } from './matting/types';

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
  /** Virtual background for the camera; omitted or 'none' = raw camera. */
  cameraBackground?: CameraBackground;
  /** Foreground person mask for the current camera frame, or null when not ready. */
  cameraMask?: MaskSource | null;
  /**
   * Light-wrap: backdrop colour bleeding into the person's edge band so the
   * composite reads as one scene, not a sticker. Set by the callers from the
   * matting tier (high/balanced only) — never a user-facing control.
   */
  cameraLightWrap?: boolean;
  /** Colour grade for the camera; omitted or 'off' = ungraded camera. */
  cameraLighting?: CameraLighting | null;
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
  const {
    outW,
    outH,
    layout,
    bubble,
    frame,
    focus,
    screen,
    camera,
    cameraBackground,
    cameraMask,
    cameraLightWrap,
    cameraLighting,
  } = state;

  paintBackdrop(ctx, frame.backdrop, outW, outH, screen);

  const box = screenFrameRect(frame.pad, outW, outH);
  const radius = Math.min(frameRadiusPx(frame.radius, outH), Math.min(box.w, box.h) / 2);

  if (layout === 'camera') {
    if (camera) {
      drawFramedCamera(
        ctx,
        camera,
        bubble,
        box,
        radius,
        frame.shadow,
        outH,
        cameraBackground,
        cameraMask,
        cameraLighting,
        cameraLightWrap,
      );
    }
    return;
  }

  if (screen) {
    drawFramedScreen(ctx, screen, box, radius, frame.shadow, outH, focus);
  }

  if (layout === 'screen+camera' && camera && bubble.visible) {
    drawBubble(
      ctx,
      camera,
      bubble,
      outW,
      outH,
      cameraBackground,
      cameraMask,
      cameraLighting,
      cameraLightWrap,
    );
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
  cameraBackground?: CameraBackground,
  cameraMask?: MaskSource | null,
  cameraLighting?: CameraLighting | null,
  cameraLightWrap?: boolean,
): void {
  if (shadow) drawCardShadow(ctx, box, radius, outH);
  const src = cameraSrcRect(bubble.zoom, camera.w, camera.h, box.w / box.h);
  ctx.save();
  roundRectPath(ctx, box, radius);
  ctx.clip();
  paintCameraLayer(
    ctx,
    box,
    camera,
    src,
    bubble.mirror,
    cameraBackground,
    cameraMask,
    cameraLighting,
    cameraLightWrap,
  );
  ctx.restore();
}

function drawBubble(
  ctx: Ctx2D,
  camera: DrawSource,
  bubble: BubbleGeometry,
  outW: number,
  outH: number,
  cameraBackground?: CameraBackground,
  cameraMask?: MaskSource | null,
  cameraLighting?: CameraLighting | null,
  cameraLightWrap?: boolean,
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
  paintCameraLayer(
    ctx,
    rect,
    camera,
    src,
    bubble.mirror,
    cameraBackground,
    cameraMask,
    cameraLighting,
    cameraLightWrap,
  );
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

/** A destination rectangle in output px (bubble or framed-camera card). */
interface DestBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Paints the camera into an already-clipped destination box. With no active
 * background (mode 'none' or no mask yet) this is the original raw crop, so
 * behavior and the preview==recording guarantee are unchanged. With a mode and
 * a ready mask it paints the chosen background, then the segmented person on
 * top — the whole reason this feature exists. Finally the lighting grade is
 * applied in place over the camera box (a no-op when 'off'), so it colours the
 * person consistently across every background mode.
 */
function paintCameraLayer(
  ctx: Ctx2D,
  box: DestBox,
  camera: DrawSource,
  src: SrcRect,
  mirror: boolean,
  bg?: CameraBackground,
  mask?: MaskSource | null,
  lighting?: CameraLighting | null,
  lightWrap?: boolean,
): void {
  if (!bg || bg.mode === 'none' || !mask) {
    drawCameraCrop(ctx, box, camera, src, mirror);
  } else if (bg.mode === 'blur') {
    // No wrap on blur: the blurred room already blends into the edge naturally.
    paintCameraBlur(ctx, box, camera, src, mirror, bg.blur);
    drawMaskedPerson(ctx, box, camera, src, mirror, mask);
  } else {
    paintCameraBackgroundFill(ctx, box, bg.builtinId);
    drawMaskedPerson(ctx, box, camera, src, mirror, mask);
    if (lightWrap) paintLightWrap(ctx, box, camera, src, mirror, mask, bg.builtinId);
  }
  applyCameraGrade(ctx, box, lighting);
}

/** The original crop: centered, zoom-cropped, optionally mirrored camera fill. */
function drawCameraCrop(
  ctx: Ctx2D,
  box: DestBox,
  camera: DrawSource,
  src: SrcRect,
  mirror: boolean,
): void {
  ctx.save();
  ctx.translate(box.x + box.w / 2, box.y + box.h / 2);
  if (mirror) ctx.scale(-1, 1);
  ctx.drawImage(camera.img, src.sx, src.sy, src.sw, src.sh, -box.w / 2, -box.h / 2, box.w, box.h);
  ctx.restore();
}

let personScratch: OffscreenCanvas | null = null;

function getPersonScratch(w: number, h: number): OffscreenCanvas | null {
  if (typeof OffscreenCanvas === 'undefined') return null;
  if (!personScratch || personScratch.width !== w || personScratch.height !== h) {
    personScratch = new OffscreenCanvas(w, h);
  }
  return personScratch;
}

/**
 * Draws just the person over whatever background is already in `box`. The camera
 * crop is masked in an offscreen scratch (`destination-in` with the foreground
 * mask, sampled through the identical zoom crop so person and mask align), then
 * composited into the box with the same mirror as the raw path. The mask upscale
 * is smoothed, which feathers the edge enough for the fast model. Falls back to
 * the raw crop if OffscreenCanvas is unavailable (jsdom) — never a blank bubble.
 */
function drawMaskedPerson(
  ctx: Ctx2D,
  box: DestBox,
  camera: DrawSource,
  src: SrcRect,
  mirror: boolean,
  mask: MaskSource,
): void {
  const sw = Math.max(1, Math.round(box.w));
  const sh = Math.max(1, Math.round(box.h));
  const scratch = getPersonScratch(sw, sh);
  const sctx = scratch?.getContext('2d') ?? null;
  if (!scratch || !sctx || camera.w === 0 || camera.h === 0) {
    drawCameraCrop(ctx, box, camera, src, mirror);
    return;
  }

  sctx.clearRect(0, 0, sw, sh);
  sctx.drawImage(camera.img, src.sx, src.sy, src.sw, src.sh, 0, 0, sw, sh);

  // Keep only the foreground: intersect with the mask, cropped by the same zoom
  // window expressed in mask pixels (the mask is normalized to the camera frame).
  const mx = mask.w / camera.w;
  const my = mask.h / camera.h;
  sctx.save();
  sctx.globalCompositeOperation = 'destination-in';
  sctx.imageSmoothingEnabled = true;
  sctx.drawImage(mask.img, src.sx * mx, src.sy * my, src.sw * mx, src.sh * my, 0, 0, sw, sh);
  sctx.restore();

  ctx.save();
  ctx.translate(box.x + box.w / 2, box.y + box.h / 2);
  if (mirror) ctx.scale(-1, 1);
  ctx.drawImage(scratch, -box.w / 2, -box.h / 2, box.w, box.h);
  ctx.restore();
}

/** Wrap bleed strength; subtle by design ("sits in the scene", not "glows"). */
const WRAP_ALPHA = 0.35;

let wrapScratch: OffscreenCanvas | null = null;

function getWrapScratch(w: number, h: number): OffscreenCanvas | null {
  if (typeof OffscreenCanvas === 'undefined') return null;
  if (!wrapScratch || wrapScratch.width !== w || wrapScratch.height !== h) {
    wrapScratch = new OffscreenCanvas(w, h);
  }
  return wrapScratch;
}

/**
 * Light-wrap: a thin band of backdrop colour bled additively over the person's
 * edge, the trick compositors use to make a matted subject read as lit by the
 * scene behind them. Built entirely from the mask: blur(mask) minus mask gives
 * an edge ring in display space (same crop + mirror as the person), the ring
 * is tinted with the backdrop fill, then added on top at low alpha. Sizes are
 * fractions of the box, so preview == recording (invariant #9). Skipped
 * wholesale when OffscreenCanvas is missing — never load-bearing.
 */
function paintLightWrap(
  ctx: Ctx2D,
  box: DestBox,
  camera: DrawSource,
  src: SrcRect,
  mirror: boolean,
  mask: MaskSource,
  builtinId: string,
): void {
  const sw = Math.max(1, Math.round(box.w));
  const sh = Math.max(1, Math.round(box.h));
  const scratch = getWrapScratch(sw, sh);
  const sctx = scratch?.getContext('2d') ?? null;
  if (!scratch || !sctx || camera.w === 0 || camera.h === 0) return;

  const r = Math.max(2, sh * 0.02);
  const mx = mask.w / camera.w;
  const my = mask.h / camera.h;
  const sx = src.sx * mx;
  const sy = src.sy * my;
  const sWidth = src.sw * mx;
  const sHeight = src.sh * my;

  sctx.clearRect(0, 0, sw, sh);
  sctx.save();
  sctx.translate(sw / 2, sh / 2);
  if (mirror) sctx.scale(-1, 1);
  // Dilated edge: the blurred mask reaches past the person outline…
  sctx.filter = `blur(${r}px)`;
  sctx.drawImage(mask.img, sx, sy, sWidth, sHeight, -sw / 2, -sh / 2, sw, sh);
  sctx.filter = 'none';
  // …minus the person core leaves a ring hugging the boundary.
  sctx.globalCompositeOperation = 'destination-out';
  sctx.drawImage(mask.img, sx, sy, sWidth, sHeight, -sw / 2, -sh / 2, sw, sh);
  sctx.restore();

  // Tint the ring with the backdrop it should be wrapping.
  sctx.save();
  sctx.globalCompositeOperation = 'source-in';
  paintCameraBackgroundFill(sctx, { x: 0, y: 0, w: sw, h: sh }, builtinId);
  sctx.restore();

  ctx.save();
  ctx.globalAlpha = WRAP_ALPHA;
  ctx.globalCompositeOperation = 'lighter';
  ctx.drawImage(scratch, box.x, box.y, box.w, box.h);
  ctx.restore();
}
