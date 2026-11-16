import {
  BufferGeometry,
  DoubleSide,
  Euler,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  Sprite,
  SpriteMaterial,
  Vector3,
  type Texture,
} from 'three';
import { DecalGeometry } from 'three/examples/jsm/geometries/DecalGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { FaceAnchors } from './FaceAnchors';
import type { OverlayTextures } from './textures';
import type { FatigueParams } from '../fatigue/stages';
import { clamp } from '../utils/math';

export interface OverlayTuning {
  /** 黑眼圈整体上下偏移（以眼高为单位）。 */
  darkCircleOffsetY: number;
  darkCircleScale: number;
  /** 螺旋眼 / × 眼的大小（以眼宽为单位）。 */
  eyeSymbolScale: number;
  eyeSymbolOffsetY: number;
  /** 头顶符号上下偏移（米）。 */
  symbolOffsetY: number;
  symbolScale: number;
}

export const DEFAULT_OVERLAY_TUNING: OverlayTuning = {
  darkCircleOffsetY: 0,
  darkCircleScale: 1,
  eyeSymbolScale: 1,
  eyeSymbolOffsetY: 0,
  symbolOffsetY: 0,
  symbolScale: 1,
};

function overlayMaterial(map: Texture, opts: Partial<MeshBasicMaterial> = {}): MeshBasicMaterial {
  const m = new MeshBasicMaterial({
    map,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    opacity: 0,
    toneMapped: false,
  });
  Object.assign(m, opts);
  return m;
}

function tag<T extends { userData: Record<string, unknown> }>(o: T): T {
  o.userData.bmOverlay = true;
  return o;
}

/**
 * 疲惫效果的透明图层：黑眼圈 / 眼袋（投射到皮肤上的贴花）、螺旋眼、× 眼、额头压力线，
 * 以及头部附近的漫画符号（精神线、叹气、旋涡、乌云）。全部挂在 head 骨骼下，随头部运动。
 */
export class FatigueOverlays {
  readonly root = tag(new Group());
  private readonly darkCircles: Mesh[] = [];
  private readonly eyeBags: Mesh[] = [];
  private readonly spirals: Group[] = [];
  private readonly spiralSpin: Mesh[] = [];
  private readonly xEyes: Group[] = [];
  private forehead: Mesh | null = null;
  private readonly sparkle: Sprite;
  private readonly sigh: Sprite;
  private readonly swirlGroup = tag(new Group());
  private readonly swirlSpin: Mesh;
  private readonly cloud: Sprite;
  private readonly rain: Sprite;
  private readonly rainTex: Texture;
  private readonly base: { sigh: Vector3; cloud: Vector3; rain: Vector3; sparkle: Vector3; swirl: Vector3 };
  readonly notes: string[] = [];
  private readonly scale: number;
  private readonly toRoot: Matrix4;

  constructor(
    anchors: FaceAnchors,
    tex: OverlayTextures,
    tuning: OverlayTuning = DEFAULT_OVERLAY_TUNING,
    /** above：旋涡和乌云在头顶正上方（版本 A）；side：放在头部右上方，避开用户本人的头发（版本 B）。 */
    layout: 'above' | 'side' = 'above',
  ) {
    const a = anchors;
    const w = a.world;
    this.scale = a.modelHeight / 1.6;
    a.head.add(this.root);
    // 抵消 head 骨骼的世界缩放，贴片尺寸始终以“米”为单位
    const hs = a.headWorldScale;
    this.root.scale.set(1 / hs.x, 1 / hs.y, 1 / hs.z);
    this.toRoot = new Matrix4().makeScale(hs.x, hs.y, hs.z).multiply(a.headInv);
    const toLocal = (v: Vector3) => v.clone().applyMatrix4(this.toRoot);
    const faceQuat = a.headWorldQuat.clone().invert();
    const s = this.scale;

    // —— 黑眼圈 / 眼袋：投射到皮肤网格上 ——
    const skin = a.baked.filter((b) => b.category === 'skin').map((b) => b.mesh);
    const targets = skin.length ? skin : a.baked.filter((b) => b.category === 'face' || b.category === 'eye').map((b) => b.mesh);
    const dcW = w.eyeW * 1.3 * tuning.darkCircleScale;
    const dcH = w.eyeH * 0.95 * tuning.darkCircleScale;
    for (const center of [w.underEyeL, w.underEyeR]) {
      const c = center.clone();
      c.y += tuning.darkCircleOffsetY * w.eyeH - dcH * 0.12;
      const dark = this.makeDecal(targets, c, dcW, dcH, overlayMaterial(tex.darkCircle));
      const bagCenter = c.clone();
      bagCenter.y -= dcH * 0.08;
      const bag = this.makeDecal(targets, bagCenter, dcW * 0.95, dcH * 0.85, overlayMaterial(tex.eyeBag));
      if (dark) this.darkCircles.push(dark);
      if (bag) this.eyeBags.push(bag);
    }
    if (this.darkCircles.length < 2) this.notes.push('黑眼圈贴花没有投射到皮肤上，已跳过（可检查模型的皮肤材质名称）。');

    // —— 螺旋眼 / × 眼：贴在眼睛前方的小平面 ——
    const eyeSize = Math.max(w.eyeW, w.eyeH * 1.2) * 1.05 * tuning.eyeSymbolScale;
    for (const eye of [w.eyeL, w.eyeR]) {
      const pos = eye.clone();
      pos.y += tuning.eyeSymbolOffsetY * w.eyeH;
      pos.z += 0.006 * s;
      const local = toLocal(pos);

      const sg = tag(new Group());
      sg.position.copy(local);
      sg.quaternion.copy(faceQuat);
      const spin = tag(new Mesh(new PlaneGeometry(eyeSize, eyeSize), overlayMaterial(tex.spiralEye)));
      spin.renderOrder = 30;
      sg.add(spin);
      this.root.add(sg);
      this.spirals.push(sg);
      this.spiralSpin.push(spin);

      const xg = tag(new Group());
      xg.position.copy(local);
      xg.quaternion.copy(faceQuat);
      const xm = tag(new Mesh(new PlaneGeometry(eyeSize * 0.9, eyeSize * 0.9), overlayMaterial(tex.xEye)));
      xm.renderOrder = 30;
      xg.add(xm);
      this.root.add(xg);
      this.xEyes.push(xg);
    }

    // —— 额头压力线 ——
    {
      const fm = tag(new Mesh(new PlaneGeometry(w.foreheadW, w.foreheadH), overlayMaterial(tex.foreheadLines)));
      fm.position.copy(toLocal(w.forehead));
      fm.quaternion.copy(faceQuat);
      fm.renderOrder = 25;
      this.root.add(fm);
      this.forehead = fm;
    }

    // —— 漫画符号 ——
    const spacing = Math.abs(w.eyeL.x - w.eyeR.x);
    const ss = tuning.symbolScale;
    const sprite = (map: Texture, sx: number, sy: number) => {
      const sp = tag(new Sprite(new SpriteMaterial({ map, transparent: true, depthWrite: false, opacity: 0, toneMapped: false })));
      sp.scale.set(sx * ss, sy * ss, 1);
      sp.renderOrder = 40;
      this.root.add(sp);
      return sp;
    };
    const sparkleW = new Vector3(w.headCenter.x - spacing * (layout === 'side' ? 1.55 : 1.9), w.eyeL.y + w.eyeH * 1.6, w.eyeL.z);
    this.sparkle = sprite(tex.sparkle, 0.11 * s, 0.11 * s);
    this.sparkle.material.rotation = 0.75;

    this.sigh = sprite(tex.sigh, 0.09 * s, 0.067 * s);

    const topY = w.headTop.y + tuning.symbolOffsetY;
    const side = layout === 'side';
    const swirlW = side
      ? new Vector3(w.headTop.x + 0.105 * s, topY - 0.01 * s, w.headCenter.z)
      : new Vector3(w.headTop.x, topY + 0.045 * s, w.headCenter.z);
    this.swirlSpin = tag(new Mesh(new PlaneGeometry(0.11 * s * ss, 0.11 * s * ss), overlayMaterial(tex.swirl)));
    this.swirlSpin.renderOrder = 40;
    this.swirlGroup.add(this.swirlSpin);
    this.swirlGroup.quaternion.copy(faceQuat).multiply(new Quaternion().setFromEuler(new Euler(-Math.PI * 0.36, 0, 0)));
    this.root.add(this.swirlGroup);

    const cloudW = side
      ? new Vector3(w.headTop.x + 0.125 * s, topY + 0.02 * s, w.headCenter.z)
      : new Vector3(w.headTop.x + 0.02 * s, topY + 0.088 * s, w.headCenter.z);
    this.cloud = sprite(tex.cloud, 0.21 * s, 0.13 * s);
    this.rainTex = tex.rain;
    this.rain = sprite(tex.rain, 0.14 * s, 0.09 * s);
    this.rain.renderOrder = 41;
    this.rain.material.depthTest = false;

    this.base = {
      sparkle: toLocal(sparkleW),
      sigh: toLocal(w.mouthSide),
      swirl: toLocal(swirlW),
      cloud: toLocal(cloudW),
      rain: toLocal(cloudW.clone().add(new Vector3(0, -0.07 * s, 0.03 * s))),
    };
    this.sparkle.position.copy(this.base.sparkle);
    this.swirlGroup.position.copy(this.base.swirl);
    this.cloud.position.copy(this.base.cloud);
    this.rain.position.copy(this.base.rain);
    this.sigh.position.copy(this.base.sigh);
    this.update(
      { darkCircle: 0, eyeBag: 0, spiralEyes: 0, xEyes: 0, foreheadLines: 0, sparkle: 0, sigh: 0, swirl: 0, cloud: 0 } as FatigueParams,
      0, 0, 0, 0,
    );
  }

  private makeDecal(targets: Mesh[], center: Vector3, w: number, h: number, mat: MeshBasicMaterial): Mesh | null {
    const size = new Vector3(w, h, Math.max(w, h) * 1.4);
    const geoms: BufferGeometry[] = [];
    for (const m of targets) {
      const bb = m.geometry.boundingBox;
      if (bb) {
        const half = size.clone().multiplyScalar(0.5);
        if (
          bb.max.x < center.x - half.x || bb.min.x > center.x + half.x ||
          bb.max.y < center.y - half.y || bb.min.y > center.y + half.y ||
          bb.max.z < center.z - half.z || bb.min.z > center.z + half.z
        ) continue;
      }
      const g = new DecalGeometry(m, center, new Euler(0, 0, 0), size);
      if (g.getAttribute('position').count > 0) geoms.push(g);
    }
    if (!geoms.length) return null;
    const merged = geoms.length === 1 ? geoms[0] : mergeGeometries(geoms, false);
    if (!merged) return null;
    merged.applyMatrix4(this.toRoot);
    const mesh = tag(new Mesh(merged, mat));
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -4;
    mat.polygonOffsetUnits = -8;
    mesh.renderOrder = 20;
    this.root.add(mesh);
    return mesh;
  }

  /**
   * @param userBlinkL/R 用户本人的眨眼值（未叠加疲惫），用于让螺旋眼 / × 眼在用户眨眼时被压扁，
   *                     这样即使到了 Stage 4/5，用户的眨眼仍然能在角色身上看出来。
   */
  update(f: FatigueParams, userBlinkL: number, userBlinkR: number, t: number, dt: number): void {
    const setOpacity = (o: Mesh | Sprite, v: number) => {
      const m = o.material as MeshBasicMaterial | SpriteMaterial;
      m.opacity = clamp(v);
      o.visible = m.opacity > 0.01;
    };
    for (const m of this.darkCircles) setOpacity(m, f.darkCircle);
    for (const m of this.eyeBags) setOpacity(m, f.eyeBag);

    const blinks = [userBlinkL, userBlinkR];
    this.spirals.forEach((g, i) => {
      const spin = this.spiralSpin[i];
      setOpacity(spin, f.spiralEyes);
      g.visible = spin.visible;
      spin.rotation.z -= dt * 5.5 * (i === 0 ? 1 : -1);
      g.scale.y = Math.max(0.1, 1 - blinks[i] * 0.95);
    });
    this.xEyes.forEach((g, i) => {
      const m = g.children[0] as Mesh;
      setOpacity(m, f.xEyes);
      g.visible = m.visible;
      g.scale.y = Math.max(0.15, 1 - blinks[i] * 0.85);
    });
    if (this.forehead) setOpacity(this.forehead, f.foreheadLines);

    // 精神线：轻微脉动
    setOpacity(this.sparkle, f.sparkle);
    const pulse = 1 + 0.08 * Math.sin(t * 6);
    this.sparkle.position.copy(this.base.sparkle);
    this.sparkle.material.rotation = 0.75 + 0.05 * Math.sin(t * 3);
    this.sparkle.scale.setScalar(0.11 * this.scale * pulse);

    // 叹气：从嘴边飘出、变大、淡出，循环
    const cyc = (t % 2.6) / 2.6;
    setOpacity(this.sigh, f.sigh * Math.sin(Math.PI * Math.min(1, cyc * 1.15)));
    this.sigh.position.copy(this.base.sigh).add(new Vector3(-0.03 * cyc * this.scale, 0.012 * cyc * this.scale, 0));
    const sighScale = (0.6 + 0.5 * cyc) * this.scale;
    this.sigh.scale.set(0.09 * sighScale, 0.067 * sighScale, 1);

    // 旋涡：平躺在头顶上方旋转
    setOpacity(this.swirlSpin, f.swirl);
    this.swirlGroup.visible = this.swirlSpin.visible;
    this.swirlSpin.rotation.z += dt * 4;

    // 乌云 + 雨
    setOpacity(this.cloud, f.cloud);
    setOpacity(this.rain, f.cloud * 0.9);
    const bob = Math.sin(t * 1.4) * 0.006 * this.scale;
    this.cloud.position.copy(this.base.cloud).add(new Vector3(0, bob, 0));
    this.rain.position.copy(this.base.rain).add(new Vector3(0, bob, 0));
    this.rainTex.offset.y = (this.rainTex.offset.y + dt * 1.4) % 1;
  }

  dispose(): void {
    this.root.removeFromParent();
    this.root.traverse((o) => {
      const m = o as Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as MeshBasicMaterial | undefined;
      mat?.dispose?.();
    });
  }
}
