import { damp } from '../utils/math';
import type { FacePoints } from '../tracking/FaceTracker';
import { computeHeadPlacement, type CropInfo, type Placement } from './headPlacement';

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

export interface CompositeInput {
  video: HTMLVideoElement | null;
  mirror: boolean;
  cameraRect: Rect | null;
  cameraZoom: number;
  autoFrame: boolean;
  faceBox: { cx: number; cy: number; w: number; h: number } | null;
  avatar: HTMLCanvasElement | null;
  avatarRect: Rect;
  headOverlay?: HeadOverlayInput | null;
  dt: number;
}

/**
 * 把 Avatar 或摄像头画面画在右下角，保留其余区域透明。
 * 短视频由画布下方的播放器显示。
 */
export class Compositor {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private crop = { cx: 0.5, cy: 0.5, zoom: 1, init: false };
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
    this.lastHead = null;

    if (i.cameraRect) this.drawCameraWindow(i.cameraRect, i);
    else this.crop.init = false;
    if (i.avatar) {
      const r = i.avatarRect;
      ctx.drawImage(i.avatar, r.x, r.y, r.w, r.h);
    }
  }

  private drawCameraWindow(rect: Rect, i: CompositeInput): void {
    const { ctx } = this;
    const { x, y, w, h } = rect;
    const v = i.video;
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.clip();
    let crop: CropInfo | null = null;
    if (v && v.readyState >= 2 && v.videoWidth > 0) {
      crop = this.updateCrop(v, rect, i);
      this.drawVideo(v, crop, rect, i.mirror);
    } else {
      this.crop.init = false;
      ctx.fillStyle = '#181a21';
      ctx.fillRect(0, 0, w, h);
    }
    if (i.headOverlay && i.headOverlay.opacity > 0.01) {
      this.lastHead = this.drawHead(i.headOverlay, rect, crop, i.mirror);
    }
    ctx.restore();
  }

  private drawHead(h: HeadOverlayInput, rect: Rect, crop: CropInfo | null, mirror: boolean): HeadPlacement {
    const p = computeHeadPlacement({
      W: rect.w,
      H: rect.h,
      crop,
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
    return {
      ...p,
      x: p.x + rect.x,
      y: p.y + rect.y,
      eye: { x: p.eye.x + rect.x, y: p.eye.y + rect.y },
      chin: { x: p.chin.x + rect.x, y: p.chin.y + rect.y },
    };
  }

  private updateCrop(v: HTMLVideoElement, rect: Rect, i: CompositeInput): CropInfo {
    const vw = v.videoWidth;
    const vh = v.videoHeight;
    const aspect = rect.w / rect.h;
    // cover 裁切的基础尺寸
    let baseW = vw;
    let baseH = vw / aspect;
    if (baseH > vh) {
      baseH = vh;
      baseW = vh * aspect;
    }
    // 自动构图让脸部约占小窗高度的 30%，脸位于画面高度的 40% 处。
    let targetZoom = Math.max(1, i.cameraZoom);
    let tcx = 0.5;
    let tcy = 0.5;
    if (i.autoFrame && i.faceBox && i.faceBox.h > 0.02) {
      const faceHpx = i.faceBox.h * vh;
      targetZoom = Math.min(2.6, Math.max(1, (0.3 * baseH) / faceHpx)) * targetZoom;
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

  private drawVideo(v: HTMLVideoElement, crop: CropInfo, { w, h }: Rect, mirror: boolean): void {
    const { ctx } = this;
    ctx.save();
    if (mirror) {
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(v, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, w, h);
    ctx.restore();
  }
}
