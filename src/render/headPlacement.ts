import type { FacePoints, Vec3 } from '../tracking/FaceTracker';

export interface CropInfo {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  vw: number;
  vh: number;
}

export interface PlacementInput {
  /** 合成画布尺寸。 */
  W: number;
  H: number;
  crop: CropInfo | null;
  mirror: boolean;
  face: FacePoints | null;
  restChinRatio: number;
  /** 头部画布尺寸、角色下巴在头部画布中的位置、角色脸宽（像素）。 */
  canvasW: number;
  canvasH: number;
  chinPx: { x: number; y: number };
  widthPx: number;
  scale: number;
  offsetX: number;
  offsetY: number;
}

export interface Placement {
  x: number;
  y: number;
  w: number;
  h: number;
  eye: { x: number; y: number };
  chin: { x: number; y: number };
  faceW: number;
  scale: number;
  fromFace: boolean;
}

/** 视频归一化坐标 → 合成画布像素坐标（含裁切与镜像）。 */
export function mapToCanvas(p: Vec3, crop: CropInfo, W: number, H: number, mirror: boolean): { x: number; y: number } {
  let x = ((p[0] * crop.vw - crop.sx) / crop.sw) * W;
  if (mirror) x = W - x;
  const y = ((p[1] * crop.vh - crop.sy) / crop.sh) * H;
  return { x, y };
}

/**
 * 版本 B 的头部摆放：
 * - 缩放：角色脸宽 = 用户脸宽（按三维距离算，转头时基本不变）× 头部大小倍数；
 * - 位置：角色下巴对齐用户“闭嘴时的下巴”。沿当前“眼 → 下巴”方向（已含低头 / 抬头的透视缩短），
 *   长度换成 restChinRatio × 脸宽，所以说话张嘴时头部不会跟着上下跳；
 * - 没有人脸数据时放在画面中央偏上的默认位置。
 */
export function computeHeadPlacement(i: PlacementInput): Placement {
  const { W, H, crop, face } = i;
  let faceW = W * 0.42;
  let eye = { x: W * 0.5, y: H * 0.36 };
  let chin = { x: eye.x, y: eye.y + i.restChinRatio * faceW };
  const fromFace = !!(face && crop);
  if (face && crop) {
    const k = W / crop.sw;
    const to3 = (p: Vec3) => [p[0] * crop.vw * k, p[1] * crop.vh * k, p[2] * crop.vw * k];
    const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    faceW = dist(to3(face.cheekL), to3(face.cheekR));
    const eyeChin = dist(to3(face.eyeMid), to3(face.chin));
    eye = mapToCanvas(face.eyeMid, crop, W, H, i.mirror);
    const c2 = mapToCanvas(face.chin, crop, W, H, i.mirror);
    const r = (i.restChinRatio * faceW) / Math.max(1e-3, eyeChin);
    chin = { x: eye.x + (c2.x - eye.x) * r, y: eye.y + (c2.y - eye.y) * r };
  }
  const s = (faceW / Math.max(1, i.widthPx)) * i.scale;
  return {
    x: chin.x - i.chinPx.x * s + i.offsetX * faceW,
    y: chin.y - i.chinPx.y * s + i.offsetY * faceW,
    w: i.canvasW * s,
    h: i.canvasH * s,
    eye,
    chin,
    faceW,
    scale: s,
    fromFace,
  };
}
