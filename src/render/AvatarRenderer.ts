import { AmbientLight, DirectionalLight, Group, PerspectiveCamera, SRGBColorSpace, Scene, Vector3, WebGLRenderer } from 'three';
import type { Avatar } from '../avatar/Avatar';
import { DEG } from '../utils/math';

export interface AvatarLayout {
  /** Avatar 区域宽度（占画面宽度的比例）。 */
  widthPct: number;
  /** Avatar 区域高度（占画面高度的比例）。 */
  heightPct: number;
  /** 距画面右边缘。 */
  rightPct: number;
  /** 距画面下边缘（默认贴着底部导航栏上沿）。 */
  bottomPct: number;
  /** 镜头缩放：越大角色越大。 */
  zoom: number;
  /** 构图上下平移（正值角色下移）。 */
  offsetY: number;
  /** 构图左右平移（正值角色右移）。 */
  offsetX: number;
  /** 角色朝向（度，正值转向画面左侧 / 用户脸的方向）。 */
  yawDeg: number;
}

export const DEFAULT_LAYOUT: AvatarLayout = {
  widthPct: 0.56,
  heightPct: 0.45,
  rightPct: 0,
  bottomPct: 0.091,
  zoom: 1.12,
  offsetY: 0,
  offsetX: 0,
  yawDeg: -8,
};

/** 用透明背景渲染角色，供合成器叠加到摄像头画面右下角。 */
export class AvatarRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(18, 1, 0.05, 50);
  readonly holder = new Group();
  avatar: Avatar | null = null;
  private width = 0;
  private height = 0;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.renderer = new WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: true,
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.setPixelRatio(1);
    // 版本 B 用材质级裁切平面去掉下巴以下的部分
    this.renderer.localClippingEnabled = true;
    const key = new DirectionalLight(0xffffff, Math.PI * 0.9);
    key.position.set(-0.5, 1.2, 1.6);
    const fill = new AmbientLight(0xffffff, Math.PI * 0.25);
    this.scene.add(key, fill, this.holder);
  }

  setAvatar(avatar: Avatar | null): void {
    if (this.avatar) this.holder.remove(this.avatar.root);
    this.avatar = avatar;
    if (avatar) this.holder.add(avatar.root);
  }

  setSize(w: number, h: number): void {
    const W = Math.max(16, Math.round(w));
    const H = Math.max(16, Math.round(h));
    if (W === this.width && H === this.height) return;
    this.width = W;
    this.height = H;
    this.renderer.setSize(W, H, false);
    this.camera.aspect = W / H;
    this.camera.updateProjectionMatrix();
  }

  /** 半身构图：从腰部到头顶上方（留出漫画符号的位置）。 */
  frame(layout: AvatarLayout): void {
    this.holder.rotation.y = layout.yawDeg * DEG;
    const a = this.avatar;
    if (!a) return;
    const f = a.framing;
    const body = Math.max(0.2, f.headTopY - f.waistY);
    const top = f.headTopY + body * 0.31;
    const bottom = f.waistY + body * 0.1;
    const span = (top - bottom) / Math.max(0.2, layout.zoom);
    const cy = (top + bottom) / 2 + layout.offsetY * (top - bottom);
    const cx = f.centerX - layout.offsetX * (top - bottom) * this.camera.aspect;
    const dist = span / 2 / Math.tan((this.camera.fov * DEG) / 2);
    this.camera.position.set(cx, cy, f.faceZ + dist);
    this.camera.lookAt(cx, cy, f.faceZ - 0.05);
    this.camera.near = Math.max(0.01, dist * 0.2);
    this.camera.far = dist * 4;
    this.camera.updateProjectionMatrix();
  }

  /**
   * 版本 B 的构图：正方形画布，只框头部（下巴略下到头顶上方的符号），角色正对镜头。
   * 头部在画布里的位置随面捕转动，合成时按双眼中点对齐到用户脸上。
   */
  frameHead(): void {
    this.holder.rotation.y = 0;
    const a = this.avatar;
    if (!a) return;
    const f = a.framing;
    const s = f.height / 1.6;
    const bottom = f.chinY - 0.06 * s;
    const top = f.headTopY + 0.2 * s;
    const span = Math.max(top - bottom, 0.52 * s);
    const cy = (top + bottom) / 2;
    const cx = f.centerX + 0.02 * s;
    const dist = span / 2 / Math.tan((this.camera.fov * DEG) / 2);
    this.camera.position.set(cx, cy, f.faceZ + dist);
    this.camera.lookAt(cx, cy, f.faceZ - 0.05);
    this.camera.near = Math.max(0.01, dist * 0.2);
    this.camera.far = dist * 4;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }

  /** 世界坐标 → 画布像素坐标（左上角为原点）。 */
  project(world: Vector3): { x: number; y: number } {
    const v = world.clone().project(this.camera);
    return { x: ((v.x + 1) / 2) * this.width, y: ((1 - v.y) / 2) * this.height };
  }

  /** 某个世界坐标点所在深度处，1 米对应多少画布像素。 */
  pixelsPerMeter(world: Vector3): number {
    const v = world.clone().applyMatrix4(this.camera.matrixWorldInverse);
    const depth = Math.max(1e-4, -v.z);
    return this.height / (2 * depth * Math.tan((this.camera.fov * DEG) / 2));
  }

  get size(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.renderer.dispose();
  }
}
