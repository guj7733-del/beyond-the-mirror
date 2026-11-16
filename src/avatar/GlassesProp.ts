import {
  CatmullRomCurve3,
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Shape,
  ShapeGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
} from 'three';
import type { FaceAnchors } from './FaceAnchors';

/**
 * 眼镜（可选配件）。参考修改意见中的效果图：上框粗黑、下框细银的眉线框。
 * 尺寸和位置按测得的眼睛位置自动计算，挂在 head 骨骼下随头转动，不参与疲惫调色。
 */
export class GlassesProp {
  readonly root = new Group();
  private readonly disposables: { dispose(): void }[] = [];

  constructor(anchors: FaceAnchors) {
    const a = anchors;
    const w = a.world;
    const s = a.modelHeight / 1.6;
    this.root.userData.bmOverlay = true;
    a.head.add(this.root);
    const hs = a.headWorldScale;
    this.root.scale.set(1 / hs.x, 1 / hs.y, 1 / hs.z);
    const toRoot = new Matrix4().makeScale(hs.x, hs.y, hs.z).multiply(a.headInv);
    const faceQuat = a.headWorldQuat.clone().invert();

    const spacing = Math.abs(w.eyeL.x - w.eyeR.x);
    const lw = Math.max(w.eyeW * 1.3, spacing * 0.6);
    const lh = Math.max(w.eyeH * 1.28, lw * 0.6);
    const mid = w.eyeL.clone().add(w.eyeR).multiplyScalar(0.5);
    mid.y += w.eyeH * 0.06;
    mid.z = Math.max(w.eyeL.z, w.eyeR.z) + 0.011 * s;

    // 在“脸部坐标”里搭眼镜（+X 角色左侧、+Y 上、+Z 前），再整体放到 head 下
    const face = new Group();
    face.position.copy(mid.clone().applyMatrix4(toRoot));
    face.quaternion.copy(faceQuat);
    this.root.add(face);

    const black = this.track(new MeshBasicMaterial({ color: 0x1b1b1e, toneMapped: false }));
    const silver = this.track(new MeshBasicMaterial({ color: 0xc4c8cf, toneMapped: false }));
    const glass = this.track(new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.08, depthWrite: false, side: DoubleSide, toneMapped: false }));
    const thick = 0.0026 * s;
    const thin = 0.001 * s;

    /** 镜框轮廓：上半部分偏方（眉线框），下半部分偏圆。 */
    const outline = (cx: number, n = 48) => {
      const top: Vector3[] = [];
      const bottom: Vector3[] = [];
      for (let i = 0; i <= n; i++) {
        const t = (i / n) * Math.PI;
        const c = Math.cos(t);
        const sn = Math.sin(t);
        top.push(new Vector3(cx + (lw / 2) * Math.sign(c) * Math.abs(c) ** 0.6, (lh / 2) * sn ** 0.55, 0));
        const tb = Math.PI + t;
        const cb = Math.cos(tb);
        bottom.push(new Vector3(cx + (lw / 2) * Math.sign(cb) * Math.abs(cb) ** 0.8, -(lh / 2) * Math.abs(Math.sin(tb)) ** 0.9, 0));
      }
      return { top, bottom };
    };

    const sides: [number, number][] = [
      [spacing / 2, 1],
      [-spacing / 2, -1],
    ];
    const innerTops: Vector3[] = [];
    for (const [cx, sign] of sides) {
      const lens = new Group();
      // 镜片顺着脸的弧度略向后转
      lens.rotation.y = sign * 0.14;
      lens.position.set(cx, 0, -Math.abs(cx) * 0.06);
      face.add(lens);
      const { top, bottom } = outline(0);
      lens.add(this.tube(top, thick, black));
      lens.add(this.tube(bottom, thin, silver));
      const shape = new Shape([...top, ...bottom].map((p) => new Vector2(p.x, p.y)));
      const lensMesh = new Mesh(this.track(new ShapeGeometry(shape, 24)), glass);
      lensMesh.renderOrder = 34;
      lens.add(lensMesh);

      lens.updateMatrix();
      // 内侧上角（接鼻梁）与外侧上角（接镜腿），换算到 face 坐标
      const inner = top[sign > 0 ? top.length - 1 : 0].clone().applyMatrix4(lens.matrix);
      const outer = top[sign > 0 ? 0 : top.length - 1].clone().applyMatrix4(lens.matrix);
      inner.y = lh * 0.12;
      innerTops.push(inner);
      // 镜腿：从外侧上角往后伸到耳朵附近
      const temple = [
        outer.clone(),
        outer.clone().add(new Vector3(sign * 0.006 * s, 0, -0.035 * s)),
        outer.clone().add(new Vector3(sign * 0.012 * s, -0.004 * s, -0.09 * s)),
      ];
      face.add(this.tube(temple, thick * 0.9, black));
    }
    // 鼻梁
    const [li, ri] = innerTops;
    const bridge = [li, li.clone().lerp(ri, 0.5).add(new Vector3(0, 0.004 * s, 0.002 * s)), ri];
    face.add(this.tube(bridge, thick * 0.85, black));

    this.root.traverse((o) => {
      o.userData.bmOverlay = true;
      o.frustumCulled = false;
    });
    this.root.visible = false;
  }

  private track<T extends { dispose(): void }>(x: T): T {
    this.disposables.push(x);
    return x;
  }

  private tube(points: Vector3[], radius: number, material: MeshBasicMaterial): Mesh {
    const curve = new CatmullRomCurve3(points, false, 'centripetal');
    const geo = this.track(new TubeGeometry(curve, Math.max(8, points.length * 2), radius, 8, false));
    const m = new Mesh(geo, material);
    m.renderOrder = 35;
    return m;
  }

  set visible(v: boolean) {
    this.root.visible = v;
  }

  get visible(): boolean {
    return this.root.visible;
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const d of this.disposables) d.dispose();
  }
}
