import { Group, Object3D, Plane, Vector3, type BufferAttribute, type Material, type Mesh, type SkinnedMesh } from 'three';
import type { RigSource } from './RigSource';
import { ExpressionBinding } from './ExpressionBinding';
import { PoseDriver } from './PoseDriver';
import { MaterialGrader } from './MaterialGrader';
import { computeFaceAnchors, type FaceAnchors } from './FaceAnchors';
import { FatigueOverlays, DEFAULT_OVERLAY_TUNING, type OverlayTuning } from './FatigueOverlays';
import { PhoneProp } from './PhoneProp';
import { GlassesProp } from './GlassesProp';
import { buildReport, type CapabilityReport } from './capabilities';
import type { OverlayTextures } from './textures';
import { materialsOf, type MaterialCategory } from './materials';
import { composeChannels } from '../core/compose';
import { emptyChannels, type Channels } from '../tracking/arkit';
import type { FaceFrame } from '../tracking/FaceProcessor';
import type { FatigueParams } from '../fatigue/stages';
import { clamp } from '../utils/math';

export interface AvatarOptions {
  overlayTuning?: Partial<OverlayTuning>;
  materialCategories?: Record<string, MaterialCategory>;
}

/** corner：版本 A，右下角半身；head：版本 B，只有头部叠在用户脸上。 */
export type AvatarMode = 'corner' | 'head';

export interface AvatarFrameInput {
  face: FaceFrame | null;
  presence: number;
  fatigue: FatigueParams;
  time: number;
  dt: number;
}

/** 构图信息（世界坐标，静止姿态）。 */
export interface AvatarFraming {
  headTopY: number;
  eyeY: number;
  chinY: number;
  waistY: number;
  centerX: number;
  faceZ: number;
  height: number;
}

/**
 * 网格里“主要骨骼是头部或其子骨骼”的顶点占比。蒙皮网格按每个顶点权重最大的骨骼判断；
 * 刚性网格看它是否挂在头部骨骼下，或者整体是否在下巴以上。
 */
function headFraction(mesh: Mesh, headSet: Set<Object3D>, chinY: number): number {
  const sk = mesh as SkinnedMesh;
  const geo = mesh.geometry;
  const si = geo.getAttribute('skinIndex') as BufferAttribute | undefined;
  const sw = geo.getAttribute('skinWeight') as BufferAttribute | undefined;
  if (sk.isSkinnedMesh && sk.skeleton && si && sw) {
    const bones = sk.skeleton.bones;
    let hit = 0;
    for (let i = 0; i < si.count; i++) {
      let best = 0;
      let bone = -1;
      for (let c = 0; c < 4; c++) {
        const w = sw.getComponent(i, c);
        if (w > best) {
          best = w;
          bone = si.getComponent(i, c);
        }
      }
      if (bone >= 0 && headSet.has(bones[bone])) hit++;
    }
    return si.count ? hit / si.count : 0;
  }
  for (let p: Object3D | null = mesh; p; p = p.parent) if (headSet.has(p)) return 1;
  geo.computeBoundingBox();
  const bb = geo.boundingBox!.clone().applyMatrix4(mesh.matrixWorld);
  return bb.min.y > chinY ? 1 : 0;
}

class AutoBlink {
  private next = 2 + Math.random() * 3;
  private t = 0;
  private phase = -1;
  update(dt: number): number {
    this.t += dt;
    if (this.phase < 0 && this.t >= this.next) {
      this.phase = 0;
      this.t = 0;
      this.next = 2.2 + Math.random() * 3.5;
    }
    if (this.phase >= 0) {
      this.phase += dt / 0.18;
      if (this.phase >= 1) {
        this.phase = -1;
        return 0;
      }
      return Math.sin(this.phase * Math.PI);
    }
    return 0;
  }
}

/**
 * 角色：把模型（RigSource）、表情绑定、姿态、调色、疲惫贴片和手机道具组合起来。
 * 每帧输入“面捕结果 + 疲惫参数”，输出到模型上。
 */
export class Avatar {
  readonly root = new Group();
  readonly binding: ExpressionBinding;
  readonly pose: PoseDriver;
  readonly grader: MaterialGrader;
  readonly anchors: FaceAnchors;
  overlays: FatigueOverlays;
  readonly phone: PhoneProp | null;
  readonly report: CapabilityReport;
  readonly framing: AvatarFraming;
  readonly channels: Channels = emptyChannels();
  private readonly autoBlink = new AutoBlink();
  overlayTuning: OverlayTuning;
  readonly glasses: GlassesProp;
  private modeValue: AvatarMode = 'corner';
  /** 版本 B 的裁切平面：只保留下巴以上的部分。clipLocal 在 head 骨骼局部坐标里，每帧换算到世界坐标。 */
  private readonly clipPlane = new Plane();
  private readonly clipLocal: Plane;
  private readonly clipMaterials: Material[] = [];
  /** head 骨骼局部坐标里的双眼中点与下巴；eyeChinDist 为两者距离（米），用于把头部缩放到用户脸的大小。 */
  private readonly eyeMidLocal: Vector3;
  private readonly chinLocal: Vector3;
  readonly eyeChinDist: number;
  /** 角色脸宽（米），版本 B 按它与用户脸宽之比缩放头部。 */
  readonly faceWidth: number;
  /** 版本 B 中隐藏的网格：几乎没有顶点绑定在头部骨骼上（例如 VRoid 的身体网格）。 */
  private readonly bodyMeshes: Mesh[] = [];

  constructor(
    readonly source: RigSource,
    private readonly textures: OverlayTextures,
    readonly options: AvatarOptions = {},
  ) {
    const h = source.humanoid;
    source.scene.updateMatrixWorld(true);
    const head = h.getRawBoneNode('head');
    if (!head) throw new Error('模型缺少 head 骨骼');

    // 1) 静止姿态下测量（必须在摆任何姿势之前）
    this.anchors = computeFaceAnchors({
      root: source.scene,
      head,
      leftEye: h.getRawBoneNode('leftEye'),
      rightEye: h.getRawBoneNode('rightEye'),
      overrides: options.materialCategories,
    });
    this.pose = new PoseDriver(h, h.normalizedHumanBonesRoot);

    // 2) 表情、调色、贴片
    this.binding = new ExpressionBinding(source.expressions, source.lookAt, source.scene);
    this.grader = new MaterialGrader(source.scene, options.materialCategories);
    this.overlayTuning = { ...DEFAULT_OVERLAY_TUNING, ...(options.overlayTuning ?? {}) };
    this.overlays = new FatigueOverlays(this.anchors, textures, this.overlayTuning);
    this.glasses = new GlassesProp(this.anchors);

    // 版本 B 用到的头部参考点与裁切平面（静止姿态下测量）
    const aw = this.anchors.world;
    const eyeMidW = aw.eyeL.clone().add(aw.eyeR).multiplyScalar(0.5);
    this.eyeChinDist = eyeMidW.distanceTo(aw.chin);
    this.eyeMidLocal = eyeMidW.clone().applyMatrix4(this.anchors.headInv);
    this.chinLocal = aw.chin.clone().applyMatrix4(this.anchors.headInv);
    const margin = 0.006 * (this.anchors.modelHeight / 1.6);
    const clipW = new Plane().setFromNormalAndCoplanarPoint(new Vector3(0, 1, 0), aw.chin.clone().add(new Vector3(0, -margin, 0)));
    this.clipLocal = clipW.clone().applyMatrix4(this.anchors.headInv);
    this.faceWidth = aw.faceWidth;
    const headSet = new Set<Object3D>();
    head.traverse((o) => headSet.add(o));
    source.scene.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh || mesh.userData.bmOverlay) return;
      for (const m of materialsOf(mesh)) if (m && !this.clipMaterials.includes(m)) this.clipMaterials.push(m);
      if (headFraction(mesh, headSet, aw.chin.y) < 0.05) this.bodyMeshes.push(mesh);
    });
    // 全部网格都算作身体时（整个角色只有一个网格），不隐藏，只靠裁切平面
    let meshCount = 0;
    source.scene.traverse((o) => {
      if ((o as Mesh).isMesh && !o.userData.bmOverlay) meshCount++;
    });
    if (this.bodyMeshes.length >= meshCount) this.bodyMeshes.length = 0;

    // 3) 手机
    const lh = h.getRawBoneNode('leftHand');
    const rh = h.getRawBoneNode('rightHand');
    const w = this.anchors.world;
    if (lh && rh) {
      const eyeMid = new Object3D();
      eyeMid.position.copy(w.eyeL.clone().add(w.eyeR).multiplyScalar(0.5).applyMatrix4(this.anchors.headInv));
      head.add(eyeMid);
      this.phone = new PhoneProp(lh, rh, eyeMid, this.anchors.modelHeight / 1.6);
      this.root.add(this.phone.root);
    } else {
      this.phone = null;
    }
    this.root.add(source.scene);

    // 4) 构图
    const spine = h.getRawBoneNode('spine') ?? h.getRawBoneNode('hips');
    const waistY = spine ? spine.getWorldPosition(new Vector3()).y : w.headTop.y - this.anchors.modelHeight * 0.45;
    this.framing = {
      headTopY: w.headTop.y,
      eyeY: (w.eyeL.y + w.eyeR.y) / 2,
      chinY: w.chin.y,
      waistY,
      centerX: (w.eyeL.x + w.eyeR.x) / 2,
      faceZ: Math.max(w.eyeL.z, w.eyeR.z),
      height: this.anchors.modelHeight,
    };

    this.report = buildReport({
      source,
      channels: this.binding.channels,
      expressionNames: this.binding.expressionNames,
      fallbackNotes: this.binding.fallbackNotes,
      extras: this.binding.extras,
      materials: this.grader.info,
      anchorsMethod: this.anchors.method,
      notes: [...this.anchors.notes, ...this.pose.notes, ...this.overlays.notes],
    });
    let kept = 0;
    source.scene.traverse((o) => {
      if ((o as Mesh).isMesh && !o.userData.bmOverlay && !this.bodyMeshes.includes(o as Mesh)) kept++;
    });
    this.report.headOnly = {
      hidden: this.bodyMeshes.length,
      kept,
      chinMeasured: aw.chinMeasured,
      faceWidthCm: Math.round(aw.faceWidth * 1000) / 10,
    };
    if (this.bodyMeshes.length === 0) {
      this.report.warnings.push('版本 B：没有可以单独隐藏的身体网格，只靠下巴下方的裁切去掉身体，低头 / 抬头时脖子切口可能露出来。');
    }
  }

  update(input: AvatarFrameInput): void {
    const { fatigue: f, dt, time } = input;
    const presence = clamp(input.presence);
    const auto = this.autoBlink.update(dt);
    const capture = input.face ? input.face.channels : null;
    composeChannels({ capture, presence, autoBlink: auto, fatigue: f }, this.channels);
    this.binding.apply(this.channels, { highlightHide: f.highlightHide });
    this.pose.update({ head: input.face ? input.face.head : null, presence, fatigue: f, time, dt, mode: this.modeValue });
    this.grader.apply(f);
    this.source.update(dt);
    this.root.updateMatrixWorld(true);
    if (this.modeValue === 'head') {
      this.clipPlane.copy(this.clipLocal).applyMatrix4(this.anchors.head.matrixWorld);
    }

    const userBlinkL = Math.max(capture ? capture.eyeBlinkLeft * presence : 0, auto * (1 - presence));
    const userBlinkR = Math.max(capture ? capture.eyeBlinkRight * presence : 0, auto * (1 - presence));
    this.overlays.update(f, userBlinkL, userBlinkR, time, dt);
    const poseSum = f.poseCheer + f.posePhone + f.poseSlump || 1;
    this.phone?.update(this.modeValue === 'head' ? 0 : f.posePhone / poseSum, f.brightness);
  }

  get mode(): AvatarMode {
    return this.modeValue;
  }

  /** 切换版本：head 模式下裁掉下巴以下的身体、隐藏手机，头顶符号移到头部右上方。 */
  setMode(mode: AvatarMode): void {
    if (mode === this.modeValue) return;
    this.modeValue = mode;
    const planes = mode === 'head' ? [this.clipPlane] : null;
    for (const m of this.clipMaterials) {
      m.clippingPlanes = planes;
      m.needsUpdate = true;
    }
    if (mode === 'head') this.clipPlane.copy(this.clipLocal).applyMatrix4(this.anchors.head.matrixWorld);
    for (const m of this.bodyMeshes) m.visible = mode !== 'head';
    this.rebuildOverlays({});
  }

  setGlasses(on: boolean): void {
    this.glasses.visible = on;
  }

  /** 当前姿态下双眼中点与下巴的世界坐标。 */
  headPoints(): { eyeMid: Vector3; chin: Vector3 } {
    const m = this.anchors.head.matrixWorld;
    return { eyeMid: this.eyeMidLocal.clone().applyMatrix4(m), chin: this.chinLocal.clone().applyMatrix4(m) };
  }

  /** 用新的微调参数重建疲惫贴片（黑眼圈位置、眼部符号大小等）。 */
  rebuildOverlays(tuning: Partial<OverlayTuning>): void {
    this.overlayTuning = { ...this.overlayTuning, ...tuning };
    this.overlays.dispose();
    this.overlays = new FatigueOverlays(this.anchors, this.textures, this.overlayTuning, this.modeValue === 'head' ? 'side' : 'above');
  }

  dispose(): void {
    this.overlays.dispose();
    this.glasses.dispose();
    this.phone?.dispose();
    this.root.removeFromParent();
    this.source.dispose();
  }
}
