import { drawChrome } from './chrome';
import { damp } from '../utils/math';
import type { FacePoints } from '../tracking/FaceTracker';
import { computeHeadPlacement, type CropInfo, type Placement } from './headPlacement';

export type BackgroundMode = 'camera' | 'dark' | 'green' | 'transparent';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 版本 B：把单独渲染的头部画布叠到用户脸上。
 * 缩放：角色脸宽对齐用户脸宽（三维距离，转头时基本不变）。
 * 位置：角色下巴对齐用户“闭嘴时的下巴”（按脸宽和比例推算，说话张嘴时头部不会上下跳）。
 */
export interface HeadOverlayInput {
  canvas: HTMLCanvasElement;
  /** 角色下巴在头部画布里的像素坐标。 */
  chinPx: { x: number; y: number };
  /** 角色脸宽在头部画布里是多少像素。 */
  widthPx: number;
  /** 用户的关键点（归一化视频坐标，未镜像）；null 时放在画面中央的默认位置。 */
  face: FacePoints | null;
  /** 用户闭嘴时“双眼 → 下巴”与脸宽之比。 */
  restChinRatio: number;
  /** 头部大小倍数与偏移（偏移以用户脸宽为单位）。 */
  scale: number;
  offsetX: number;
  offsetY: number;
  opacity: number;
}

export type HeadPlacement = Placement;

type Crop = CropInfo;

export interface CompositeInput {
  video: HTMLVideoElement | VideoFrame | null;
  mirror: boolean;
  background: BackgroundMode;
  cameraZoom: number;
  autoFrame: boolean;
  /** 自动构图时脸高占画面高度的比例（版本 A 0.4；版本 B 留出肩膀和符号的位置，0.3）。 */
  faceFraction?: number;
  faceBox: { cx: number; cy: number; w: number; h: number } | null;
  avatar: HTMLCanvasElement | null;
  avatarRect: Rect;
  headOverlay?: HeadOverlayInput | null;
  chrome: boolean;
  clock: string;
  dt: number;
}

/**
 * 9:16 合成器：摄像头画面 → Avatar（透明背景）→ 短视频界面。
 * 屏幕上看到的、录屏导出的、截图导出的都是同一张画布，保证一致。
 */
export class Compositor {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private crop = { cx: 0.5, cy: 0.5, zoom: 1, init: false };
  private lastCrop: Crop | null = null;
  /** 最近一次头部叠加的位置（调试与自动测试用）。 */
  lastHead: HeadPlacement | null = null;

  constructor(
    readonly width = 1080,
    readonly height = 1920,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext('2d', { alpha: true })!;
  }

  avatarRectFor(layout: { widthPct: number; heightPct: number; rightPct: number; bottomPct: number }): Rect {
    const w = layout.widthPct * this.width;
    const h = layout.heightPct * this.height;
    return {
      x: this.width * (1 - layout.rightPct) - w,
      y: this.height * (1 - layout.bottomPct) - h,
      w,
      h,
    };
  }

  draw(i: CompositeInput): void {
    const { ctx, width: W, height: H } = this;
    ctx.clearRect(0, 0, W, H);
    const v = i.video;
    const isVideoElement = v instanceof HTMLVideoElement;
    const vw = isVideoElement ? v.videoWidth : v?.displayWidth ?? 0;
    const vh = isVideoElement ? v.videoHeight : v?.displayHeight ?? 0;
    // 裁切框每帧都更新（即使背景不是摄像头），这样版本 B 的头部在任何背景下都跟着脸走
    this.lastCrop = vw > 0 && vh > 0 && (!isVideoElement || v.readyState >= 2) ? this.updateCrop(vw, vh, i) : null;
    if (i.background === 'camera' && v && this.lastCrop) this.drawVideo(v, this.lastCrop, i.mirror);
    else if (i.background === 'green') {
      ctx.fillStyle = '#00b140';
      ctx.fillRect(0, 0, W, H);
    } else if (i.background !== 'transparent') {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#2a2d36');
      g.addColorStop(1, '#121318');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }

    if (i.avatar) {
      const r = i.avatarRect;
      ctx.drawImage(i.avatar, r.x, r.y, r.w, r.h);
    }
    this.lastHead = i.headOverlay ? this.drawHead(i.headOverlay, i.mirror) : null;
    if (i.chrome) drawChrome(ctx, W, H, i.clock);
  }

  private drawHead(h: HeadOverlayInput, mirror: boolean): HeadPlacement | null {
    if (h.opacity <= 0.01) return null;
    const p = computeHeadPlacement({
      W: this.width,
      H: this.height,
      crop: this.lastCrop,
      mirror,
      face: h.face,
      restChinRatio: h.restChinRatio,
      canvasW: h.canvas.width,
      canvasH: h.canvas.height,
      chinPx: h.chinPx,
      widthPx: h.widthPx,
      scale: h.scale,
      offsetX: h.offsetX,
      offsetY: h.offsetY,
    });
    const { ctx } = this;
    ctx.save();
    ctx.globalAlpha = Math.min(1, h.opacity);
    ctx.drawImage(h.canvas, p.x, p.y, p.w, p.h);
    ctx.restore();
    return p;
  }

  private updateCrop(vw: number, vh: number, i: CompositeInput): Crop {
    const { width: W, height: H } = this;
    const aspect = W / H;
    // cover 裁切的基础尺寸
    let baseW = vw;
    let baseH = vw / aspect;
    if (baseH > vh) {
      baseH = vh;
      baseW = vh * aspect;
    }
    // 目标：手动缩放，或自动大脸构图（脸高约占画面 40%（版本 B 为 30%），脸位于画面 40% 高度处）
    let targetZoom = Math.max(1, i.cameraZoom);
    let tcx = 0.5;
    let tcy = 0.5;
    if (i.autoFrame && i.faceBox && i.faceBox.h > 0.02) {
      const faceHpx = i.faceBox.h * vh;
      const frac = i.faceFraction ?? 0.4;
      targetZoom = Math.min(2.6, Math.max(1, (frac * baseH) / faceHpx)) * Math.max(1, i.cameraZoom);
      const cropH = baseH / targetZoom;
      tcx = i.faceBox.cx;
      tcy = (i.faceBox.cy * vh + 0.1 * cropH) / vh;
    }
    const c = this.crop;
    if (!c.init) {
      c.cx = tcx;
      c.cy = tcy;
      c.zoom = targetZoom;
      c.init = true;
    } else {
      const lambda = 1.6;
      c.cx = damp(c.cx, tcx, lambda, i.dt);
      c.cy = damp(c.cy, tcy, lambda, i.dt);
      c.zoom = damp(c.zoom, targetZoom, lambda, i.dt);
    }
    const sw = baseW / c.zoom;
    const sh = baseH / c.zoom;
    let sx = c.cx * vw - sw / 2;
    let sy = c.cy * vh - sh / 2;
    sx = Math.min(Math.max(0, sx), vw - sw);
    sy = Math.min(Math.max(0, sy), vh - sh);
    return { sx, sy, sw, sh, vw, vh };
  }

  private drawVideo(v: HTMLVideoElement | VideoFrame, crop: Crop, mirror: boolean): void {
    const { ctx, width: W, height: H } = this;
    ctx.save();
    if (mirror) {
      ctx.translate(W, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(v, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, W, H);
    ctx.restore();
  }
}
