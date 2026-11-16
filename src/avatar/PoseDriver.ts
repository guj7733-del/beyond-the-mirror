import { Euler, Matrix4, Object3D, Quaternion, Vector3 } from 'three';
import type { VRMHumanBoneName, VRMHumanoid } from '@pixiv/three-vrm';
import type { FatigueParams } from '../fatigue/stages';
import type { HeadPose } from '../tracking/FaceProcessor';
import { DEG, clamp, wobble } from '../utils/math';

type Side = 'left' | 'right';

/** 手臂姿势（以角色左臂为准，右臂自动镜像）。方向都在“躯干空间”：+X 角色左侧，+Y 上，+Z 角色前方。 */
interface ArmPose {
  upper: Vector3;
  fore: Vector3;
  finger: Vector3;
  palm: Vector3;
  curl: number;
  thumbCurl: number;
}

const v = (x: number, y: number, z: number) => new Vector3(x, y, z).normalize();

export const ARM_POSES: Record<'cheer' | 'phone' | 'slump', ArmPose> = {
  // Stage 0：双拳在胸前（参考图中精神饱满的样子）
  cheer: { upper: v(0.3, -1, 0.25), fore: v(-0.3, 0.6, 0.75), finger: v(-0.35, 0.6, 0.7), palm: v(-0.75, -0.1, -0.65), curl: 1.45, thumbCurl: 0.9 },
  // Stage 1–4：双手捧着手机，手机背面朝向镜头
  phone: { upper: v(0.32, -1, 0.3), fore: v(-0.45, 0.2, 1), finger: v(-0.3, 0.85, 0.45), palm: v(-0.95, 0.05, -0.3), curl: 0.75, thumbCurl: 0.2 },
  // Stage 5：上身塌下，前臂横在身前、手搭在画面底部
  slump: { upper: v(0.25, -0.6, 0.75), fore: v(-0.85, 0.05, 0.55), finger: v(-0.7, -0.15, 0.6), palm: v(-0.1, -1, 0.1), curl: 0.35, thumbCurl: 0.15 },
};

const FINGERS = ['Index', 'Middle', 'Ring', 'Little'] as const;
const SEGMENTS = ['Proximal', 'Intermediate', 'Distal'] as const;
const THUMB = ['ThumbMetacarpal', 'ThumbProximal', 'ThumbDistal'] as const;

interface ArmRest {
  upper: Vector3;
  fore: Vector3;
  finger: Vector3;
  palm: Vector3;
  thumb: Vector3;
  curlAxis: Vector3;
  thumbAxis: Vector3;
}

export interface PoseInput {
  head: HeadPose | null;
  presence: number;
  fatigue: FatigueParams;
  time: number;
  dt: number;
  /** corner：右下角半身（版本 A）；head：只有头部叠在脸上（版本 B）。 */
  mode?: 'corner' | 'head';
}

/**
 * 姿态驱动：在“规范空间”（角色面向 +Z、左手 +X、所有骨骼静止旋转为单位四元数）里计算
 * 每根骨骼的局部旋转，再换算到具体模型的 normalized 骨骼上。
 * 面捕头部旋转、疲惫低头 / 塌肩、呼吸、眩晕摇晃、手臂姿势都在这里合成。
 */
export class PoseDriver {
  private readonly rootQ: Quaternion;
  private readonly rootQInv: Quaternion;
  private readonly rest: Record<Side, ArmRest>;
  private readonly has = new Set<VRMHumanBoneName>();
  private breathPhase = 0;
  readonly notes: string[] = [];

  constructor(
    private readonly humanoid: VRMHumanoid,
    rigRoot: Object3D,
  ) {
    rigRoot.updateMatrixWorld(true);
    this.rootQ = rigRoot.getWorldQuaternion(new Quaternion());
    this.rootQInv = this.rootQ.clone().invert();
    const names: VRMHumanBoneName[] = [
      'hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
      'leftShoulder', 'rightShoulder', 'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm', 'leftHand', 'rightHand',
    ];
    for (const n of names) if (humanoid.getNormalizedBoneNode(n)) this.has.add(n);
    for (const side of ['left', 'right'] as const) {
      for (const f of FINGERS) for (const s of SEGMENTS) {
        const n = `${side}${f}${s}` as VRMHumanBoneName;
        if (humanoid.getNormalizedBoneNode(n)) this.has.add(n);
      }
      for (const t of THUMB) {
        const n = `${side}${t}` as VRMHumanBoneName;
        if (humanoid.getNormalizedBoneNode(n)) this.has.add(n);
      }
    }
    this.rest = { left: this.measureRest('left'), right: this.measureRest('right') };
    if (!this.has.has('neck')) this.notes.push('缺少 neck 骨骼：低头动作全部由 head 承担。');
    if (!this.has.has('leftUpperArm') || !this.has.has('rightUpperArm')) this.notes.push('缺少手臂骨骼：手臂保持模型默认姿势。');
    if (!this.has.has('leftIndexProximal')) this.notes.push('缺少手指骨骼：不做握拳 / 握手机的手指弯曲。');
  }

  /** 世界坐标（规范空间）下的骨骼位置。加载后、摆姿势前调用。 */
  private pos(name: VRMHumanBoneName): Vector3 | null {
    const node = this.humanoid.getRawBoneNode(name);
    return node ? node.getWorldPosition(new Vector3()) : null;
  }

  private measureRest(side: Side): ArmRest {
    const sx = side === 'left' ? 1 : -1;
    const dir = (a: VRMHumanBoneName, b: VRMHumanBoneName, fallback: Vector3) => {
      const pa = this.pos(a);
      const pb = this.pos(b);
      if (!pa || !pb || pa.distanceTo(pb) < 1e-5) return fallback.clone();
      return pb.sub(pa).normalize();
    };
    const out = new Vector3(sx, 0, 0);
    const upper = dir(`${side}UpperArm` as VRMHumanBoneName, `${side}LowerArm` as VRMHumanBoneName, out);
    const fore = dir(`${side}LowerArm` as VRMHumanBoneName, `${side}Hand` as VRMHumanBoneName, upper);
    const finger = dir(`${side}Hand` as VRMHumanBoneName, `${side}MiddleProximal` as VRMHumanBoneName, fore);
    let palm = new Vector3(0, -1, 0);
    const idx = this.pos(`${side}IndexProximal` as VRMHumanBoneName);
    const lit = this.pos(`${side}LittleProximal` as VRMHumanBoneName);
    if (idx && lit) {
      const across = lit.sub(idx).normalize();
      const cand = side === 'left' ? across.clone().cross(finger) : finger.clone().cross(across);
      if (cand.lengthSq() > 1e-6) palm = cand.normalize();
    }
    palm.sub(finger.clone().multiplyScalar(finger.dot(palm))).normalize();
    const thumb = dir(`${side}ThumbProximal` as VRMHumanBoneName, `${side}ThumbDistal` as VRMHumanBoneName, new Vector3(sx * 0.6, 0, 0.8));
    const curlAxis = finger.clone().cross(palm).normalize();
    const thumbAxis = thumb.clone().cross(palm).normalize();
    if (thumbAxis.lengthSq() < 1e-6) thumbAxis.copy(curlAxis);
    return { upper, fore, finger, palm, thumb, curlAxis, thumbAxis };
  }

  /** 规范空间的局部旋转 → normalized 骨骼的局部旋转（VRM0 模型需要绕 Y 轴共轭）。 */
  private set(name: VRMHumanBoneName, q: Quaternion): void {
    const node = this.humanoid.getNormalizedBoneNode(name);
    if (!node) return;
    node.quaternion.copy(this.rootQInv).multiply(q).multiply(this.rootQ);
  }

  update(input: PoseInput): void {
    const { fatigue: f, time: t, dt } = input;
    const w = clamp(input.presence);

    // —— 呼吸 ——
    this.breathPhase += dt * (f.breathRate / 60) * Math.PI * 2;
    const breath = Math.sin(this.breathPhase) * 1.1 * f.breathDepth * DEG;

    // —— 头部：面捕 + 待机微动 ——
    const idleYaw = 3.5 * wobble(t * 0.35, 1) * DEG;
    const idlePitch = 2 * wobble(t * 0.3, 2) * DEG;
    const idleRoll = 1.5 * wobble(t * 0.25, 3) * DEG;
    const cap = input.head;
    const yaw = (cap ? cap.yaw : 0) * w + idleYaw * (1 - w);
    const pitch = (cap ? cap.pitch : 0) * w + idlePitch * (1 - w);
    const roll = (cap ? cap.roll : 0) * w + idleRoll * (1 - w);

    // —— 版本 B：头部必须和用户的脸对齐，面捕旋转全部给 head，不叠加低头 / 歪头，只保留轻微的眩晕摇晃 ——
    if (input.mode === 'head') {
      const wob = f.sway * 0.4 * DEG * Math.sin(t * 1.9);
      const e0 = new Euler(pitch, yaw, roll + wob, 'YXZ');
      const ident = new Quaternion();
      for (const n of ['neck', 'spine', 'chest', 'upperChest', 'leftShoulder', 'rightShoulder'] as VRMHumanBoneName[]) {
        if (this.has.has(n)) this.set(n, ident);
      }
      this.set('head', new Quaternion().setFromEuler(e0));
      return;
    }

    // —— 疲惫偏移 ——
    const sway = f.sway * DEG;
    const swayRoll = sway * Math.sin(t * 1.9);
    const swayPitch = sway * 0.45 * Math.sin(t * 1.3 + 1.1);
    const droopPitch = f.headPitch * DEG;
    const droopRoll = f.headRoll * DEG;

    const hasNeck = this.has.has('neck');
    const neckShare = hasNeck ? 0.35 : 0;
    const neckDroop = hasNeck ? 0.55 : 0;
    const e = new Euler();
    const q = new Quaternion();

    if (hasNeck) {
      e.set(pitch * neckShare + droopPitch * neckDroop + swayPitch * 0.5, yaw * neckShare, roll * neckShare + droopRoll * 0.5 + swayRoll * 0.4, 'YXZ');
      this.set('neck', q.setFromEuler(e));
    }
    e.set(
      pitch * (1 - neckShare) + droopPitch * (1 - neckDroop) + swayPitch * 0.5,
      yaw * (1 - neckShare),
      roll * (1 - neckShare) + droopRoll * 0.5 + swayRoll * 0.6,
      'YXZ',
    );
    this.set('head', q.setFromEuler(e));

    // —— 躯干：前倾 + 呼吸 + 跟随头部少量转动 + 眩晕摇晃 ——
    const lean = f.spinePitch * DEG;
    const follow = yaw * 0.12;
    const hasUpper = this.has.has('upperChest');
    const shares = hasUpper ? [0.38, 0.34, 0.28] : [0.5, 0.5, 0];
    const bodySway = swayRoll * 0.35;
    e.set(lean * shares[0] + breath * 0.2, follow * 0.3, bodySway * 0.6, 'YXZ');
    this.set('spine', q.setFromEuler(e));
    e.set(lean * shares[1] - breath * 0.5, follow * 0.35, bodySway * 0.4, 'YXZ');
    this.set('chest', q.setFromEuler(e));
    if (hasUpper) {
      e.set(lean * shares[2] - breath * 0.6, follow * 0.35, 0, 'YXZ');
      this.set('upperChest', q.setFromEuler(e));
    }

    // —— 肩膀：下沉 + 内扣 + 呼吸起伏 ——
    const drop = f.shoulderDrop * DEG;
    const shoulders: Record<Side, Quaternion> = {
      left: new Quaternion().setFromEuler(new Euler(0, -drop * 0.55, -drop + breath * 0.6, 'XYZ')),
      right: new Quaternion().setFromEuler(new Euler(0, drop * 0.55, drop - breath * 0.6, 'XYZ')),
    };
    if (this.has.has('leftShoulder')) this.set('leftShoulder', shoulders.left);
    if (this.has.has('rightShoulder')) this.set('rightShoulder', shoulders.right);

    // —— 手臂 ——
    const wc = Math.max(0, f.poseCheer);
    const wp = Math.max(0, f.posePhone);
    const ws = Math.max(0, f.poseSlump);
    const sum = wc + wp + ws || 1;
    const blend = (key: 'upper' | 'fore' | 'finger' | 'palm') =>
      new Vector3()
        .addScaledVector(ARM_POSES.cheer[key], wc / sum)
        .addScaledVector(ARM_POSES.phone[key], wp / sum)
        .addScaledVector(ARM_POSES.slump[key], ws / sum)
        .normalize();
    const pose: ArmPose = {
      upper: blend('upper'),
      fore: blend('fore'),
      finger: blend('finger'),
      palm: blend('palm'),
      curl: (ARM_POSES.cheer.curl * wc + ARM_POSES.phone.curl * wp + ARM_POSES.slump.curl * ws) / sum,
      thumbCurl: (ARM_POSES.cheer.thumbCurl * wc + ARM_POSES.phone.thumbCurl * wp + ARM_POSES.slump.thumbCurl * ws) / sum,
    };
    // 待机：手臂随呼吸轻微起伏，拇指偶尔滑动屏幕
    const idleArm = 0.03 * Math.sin(this.breathPhase + 0.6);
    const scroll = wp / sum > 0.5 ? Math.max(0, Math.sin(t * 2.4)) ** 6 : 0;
    for (const side of ['left', 'right'] as const) {
      const shoulderQ = this.has.has(`${side}Shoulder` as VRMHumanBoneName) ? shoulders[side] : new Quaternion();
      this.solveArm(side, pose, shoulderQ, idleArm, side === 'right' ? scroll : 0);
    }
  }

  private solveArm(side: Side, pose: ArmPose, shoulderQ: Quaternion, idle: number, scroll: number): void {
    const upperName = `${side}UpperArm` as VRMHumanBoneName;
    const lowerName = `${side}LowerArm` as VRMHumanBoneName;
    const handName = `${side}Hand` as VRMHumanBoneName;
    if (!this.has.has(upperName) || !this.has.has(lowerName)) return;
    const rest = this.rest[side];
    const m = (d: Vector3) => (side === 'left' ? d.clone() : new Vector3(-d.x, d.y, d.z));

    const d1 = m(pose.upper);
    d1.y += idle;
    d1.normalize();
    const d2 = m(pose.fore);
    const fingerDir = m(pose.finger);
    const palmDir = m(pose.palm);

    const shoulderInv = shoulderQ.clone().invert();
    const qU = new Quaternion().setFromUnitVectors(rest.upper, d1.clone().applyQuaternion(shoulderInv).normalize());
    const chainU = shoulderQ.clone().multiply(qU);
    const qL = new Quaternion().setFromUnitVectors(rest.fore, d2.clone().applyQuaternion(chainU.clone().invert()).normalize());
    const chainL = chainU.clone().multiply(qL);
    this.set(upperName, qU);
    this.set(lowerName, qL);

    if (this.has.has(handName)) {
      const want = basisRotation(rest.finger, rest.palm, fingerDir, palmDir);
      const qH = chainL.clone().invert().multiply(want);
      this.set(handName, qH);
    }
    for (const f of FINGERS) {
      SEGMENTS.forEach((s, i) => {
        const n = `${side}${f}${s}` as VRMHumanBoneName;
        if (!this.has.has(n)) return;
        const angle = pose.curl * (i === 0 ? 0.8 : 1.0) * (f === 'Index' ? 0.85 : 1);
        this.set(n, new Quaternion().setFromAxisAngle(rest.curlAxis, angle));
      });
    }
    THUMB.forEach((s, i) => {
      const n = `${side}${s}` as VRMHumanBoneName;
      if (!this.has.has(n)) return;
      const angle = (pose.thumbCurl + (i > 0 ? scroll * 0.35 : 0)) * (i === 0 ? 0.5 : 0.8);
      this.set(n, new Quaternion().setFromAxisAngle(rest.thumbAxis, angle));
    });
  }
}

const _m1 = new Matrix4();
const _m2 = new Matrix4();
/** 求旋转 R，使 R·f0 = f1，R·p0 = p1（p 先对 f 正交化）。 */
export function basisRotation(f0: Vector3, p0: Vector3, f1: Vector3, p1: Vector3): Quaternion {
  const a = f0.clone().normalize();
  const b = p0.clone().sub(a.clone().multiplyScalar(a.dot(p0))).normalize();
  const c = a.clone().cross(b);
  const x = f1.clone().normalize();
  const y = p1.clone().sub(x.clone().multiplyScalar(x.dot(p1))).normalize();
  const z = x.clone().cross(y);
  _m1.makeBasis(a, b, c);
  _m2.makeBasis(x, y, z);
  _m1.transpose();
  _m2.multiply(_m1);
  return new Quaternion().setFromRotationMatrix(_m2);
}
