import {
  Bone,
  BufferAttribute,
  BufferGeometry,
  CapsuleGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshToonMaterial,
  SphereGeometry,
  type Material,
  type Object3D,
} from 'three';
import {
  VRMExpression,
  VRMExpressionManager,
  VRMExpressionMorphTargetBind,
  VRMHumanoid,
  type VRMHumanBoneName,
  type VRMHumanBones,
} from '@pixiv/three-vrm';
import type { RigSource } from './RigSource';

/**
 * 占位角色：找不到模型文件时使用，保证面捕和疲惫效果仍可测试。
 * 由简单几何体拼成（刚性绑定到骨骼），外形参考需求文档中的角色：棕色刺猬头、蓝色上衣。
 * 支持眨眼、张嘴、眉毛三类表情，其余表情缺失。
 */
export function createPlaceholderSource(): RigSource {
  const scene = new Group();
  scene.name = 'PlaceholderAvatar';
  const mat = (name: string, color: number): Material => {
    const m = new MeshToonMaterial({ color });
    m.name = name;
    return m;
  };
  const skin = mat('PH_Skin_SKIN', 0xf3c9a1);
  const hair = mat('PH_Hair_HAIR', 0x8a5631);
  const cloth = mat('PH_Tops_CLOTH', 0x2f62d8);
  const eyeMat = mat('PH_EyeWhite_EYE', 0x1b1b1f);
  const browMat = mat('PH_Brow_FACE', 0x4a2c17);
  const mouthMat = mat('PH_Mouth_FACE', 0x7a2b2b);

  const bone = (name: string, x: number, y: number, z: number, parent: Object3D): Bone => {
    const b = new Bone();
    b.name = name;
    const pw = parent.userData.world ?? [0, 0, 0];
    b.position.set(x - pw[0], y - pw[1], z - pw[2]);
    b.userData.world = [x, y, z];
    parent.add(b);
    return b;
  };
  scene.userData.world = [0, 0, 0];
  const hips = bone('hips', 0, 0.92, 0, scene);
  const spine = bone('spine', 0, 1.0, 0, hips);
  const chest = bone('chest', 0, 1.12, 0, spine);
  const upperChest = bone('upperChest', 0, 1.24, 0, chest);
  const neck = bone('neck', 0, 1.38, 0, upperChest);
  const head = bone('head', 0, 1.44, 0, neck);
  const bones: Record<string, Bone> = { hips, spine, chest, upperChest, neck, head };
  for (const [side, sx] of [['left', 1], ['right', -1]] as const) {
    const sh = bone(`${side}Shoulder`, 0.05 * sx, 1.34, 0, upperChest);
    const ua = bone(`${side}UpperArm`, 0.16 * sx, 1.34, 0, sh);
    const la = bone(`${side}LowerArm`, 0.38 * sx, 1.34, 0, ua);
    const hd = bone(`${side}Hand`, 0.58 * sx, 1.34, 0, la);
    const tip = bone(`${side}HandTip`, 0.66 * sx, 1.34, 0, hd);
    void tip;
    const eye = bone(`${side}Eye`, 0.045 * sx, 1.585, 0.1, head);
    Object.assign(bones, { [`${side}Shoulder`]: sh, [`${side}UpperArm`]: ua, [`${side}LowerArm`]: la, [`${side}Hand`]: hd, [`${side}Eye`]: eye });
    // 手臂几何
    const upper = new Mesh(new CapsuleGeometry(0.052, 0.17, 6, 12), cloth);
    upper.rotation.z = Math.PI / 2;
    upper.position.set(0.11 * sx, 0, 0);
    ua.add(upper);
    const lower = new Mesh(new CapsuleGeometry(0.046, 0.16, 6, 12), cloth);
    lower.rotation.z = Math.PI / 2;
    lower.position.set(0.1 * sx, 0, 0);
    la.add(lower);
    const hand = new Mesh(new SphereGeometry(0.05, 16, 12), skin);
    hand.scale.set(1.15, 0.8, 1);
    hand.position.set(0.04 * sx, 0, 0);
    hd.add(hand);
  }
  scene.add(hips);

  // 身体
  const torso = new Mesh(new CapsuleGeometry(0.16, 0.26, 8, 20), cloth);
  torso.position.set(0, 0.12, 0);
  chest.add(torso);
  const neckMesh = new Mesh(new CylinderGeometry(0.05, 0.055, 0.1, 16), skin);
  neckMesh.position.set(0, 0.04, 0);
  neck.add(neckMesh);

  // 头
  const at = (m: Mesh, x: number, y: number, z: number) => {
    m.position.set(x, y - 1.44, z);
    head.add(m);
    return m;
  };
  const face = at(new Mesh(new SphereGeometry(0.135, 32, 24), skin), 0, 1.575, 0);
  face.scale.set(1, 1.06, 0.95);
  const cap = at(new Mesh(new SphereGeometry(0.145, 32, 24, 0, Math.PI * 2, 0, Math.PI * 0.5), hair), 0, 1.6, -0.012);
  cap.scale.set(1.04, 0.95, 1.02);
  const spikes: [number, number, number, number, number][] = [
    [0, 1.74, 0.0, 0, 0], [0.09, 1.72, 0.0, 0, -0.55], [-0.09, 1.72, 0.0, 0, 0.55], [0.14, 1.65, 0, 0, -1.1], [-0.14, 1.65, 0, 0, 1.1],
    [0.05, 1.73, -0.07, -0.4, -0.3], [-0.05, 1.73, -0.07, -0.4, 0.3], [0, 1.68, -0.12, -1.0, 0], [0.06, 1.66, 0.11, 0.9, -0.3], [-0.05, 1.67, 0.11, 0.9, 0.35],
  ];
  for (const [x, y, z, rx, rz] of spikes) {
    const sp = at(new Mesh(new ConeGeometry(0.045, 0.1, 10), hair), x, y, z);
    sp.rotation.set(rx, 0, rz);
  }

  // 带 Morph Target 的五官
  const morphMesh = (geo: BufferGeometry, material: Material, targets: Record<string, (p: Float32Array) => void>) => {
    const base = geo.getAttribute('position').array as Float32Array;
    geo.morphAttributes.position = Object.entries(targets).map(([name, fn]) => {
      const arr = new Float32Array(base.length);
      arr.set(base);
      fn(arr);
      const attr = new BufferAttribute(arr, 3);
      attr.name = name;
      return attr;
    });
    const m = new Mesh(geo, material);
    m.updateMorphTargets();
    return m;
  };
  const scaleY = (k: number, dy = 0) => (p: Float32Array) => {
    for (let i = 0; i < p.length; i += 3) p[i + 1] = p[i + 1] * k + dy;
  };
  const eyes: Mesh[] = [];
  for (const sx of [1, -1]) {
    const eye = morphMesh(new SphereGeometry(0.018, 16, 12), eyeMat, { blink: scaleY(0.08, -0.008) });
    eye.scale.set(0.8, 1.35, 0.5);
    at(eye, 0.045 * sx, 1.585, 0.118);
    eyes.push(eye);
  }
  const brows: Mesh[] = [];
  for (const sx of [1, -1]) {
    const browGeo = new CapsuleGeometry(0.007, 0.03, 4, 8).rotateZ(Math.PI / 2);
    const brow = morphMesh(browGeo, browMat, {
      down: (p) => { for (let i = 0; i < p.length; i += 3) p[i + 1] -= 0.012; },
      innerUp: (p) => { for (let i = 0; i < p.length; i += 3) p[i + 1] += (-p[i] * sx > 0 ? 1 : 0.2) * 0.012; },
    });
    at(brow, 0.047 * sx, 1.63, 0.118);
    brows.push(brow);
  }
  const mouth = morphMesh(new SphereGeometry(0.02, 16, 12), mouthMat, {
    open: scaleY(3.2, -0.01),
    smile: (p) => { for (let i = 0; i < p.length; i += 3) { p[i] *= 1.4; p[i + 1] += Math.abs(p[i]) * 0.5 - 0.004; } },
  });
  mouth.scale.set(1.3, 0.35, 0.5);
  at(mouth, 0, 1.512, 0.122);

  scene.traverse((o) => { o.frustumCulled = false; });
  scene.updateMatrixWorld(true);

  const human: VRMHumanBones = {} as VRMHumanBones;
  for (const [name, b] of Object.entries(bones)) (human as Record<string, { node: Object3D }>)[name as VRMHumanBoneName] = { node: b };
  const humanoid = new VRMHumanoid(human, { autoUpdateHumanBones: true });
  scene.add(humanoid.normalizedHumanBonesRoot);

  const expressions = new VRMExpressionManager();
  const expr = (name: string, meshes: Mesh[], index: number) => {
    const e = new VRMExpression(name);
    for (const m of meshes) e.addBind(new VRMExpressionMorphTargetBind({ primitives: [m], index, weight: 1 }));
    expressions.registerExpression(e);
  };
  expr('eyeBlinkLeft', [eyes[0]], 0);
  expr('eyeBlinkRight', [eyes[1]], 0);
  expr('browDownLeft', [brows[0]], 0);
  expr('browDownRight', [brows[1]], 0);
  expr('browInnerUp', brows, 1);
  expr('jawOpen', [mouth], 0);
  expr('mouthSmileLeft', [mouth], 1);

  return {
    kind: 'placeholder',
    scene,
    humanoid,
    expressions,
    lookAt: null,
    meta: {
      title: '占位角色（程序生成）',
      author: '—',
      version: '—',
      specVersion: '内置',
      fileName: 'placeholder',
      license: [{ label: '说明', value: '程序生成的占位模型，仅用于在缺少模型文件时测试流程。' }],
    },
    update: () => {
      humanoid.update();
      expressions.update();
    },
    dispose: () => {
      scene.traverse((o) => {
        const m = o as Mesh;
        m.geometry?.dispose();
      });
    },
    notes: ['当前使用占位角色：请把 VRM 模型放到 public/models/avatar.vrm 后刷新页面。'],
  };
}
