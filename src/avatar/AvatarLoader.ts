import { Object3D, Mesh, Vector3, type Material } from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  VRMExpression,
  VRMExpressionManager,
  VRMExpressionMorphTargetBind,
  VRMHumanoid,
  VRMLoaderPlugin,
  VRMUtils,
  type VRM,
  type VRMHumanBoneName,
  type VRMHumanBones,
} from '@pixiv/three-vrm';
import type { RigSource } from './RigSource';
import { readVrmMeta, type ModelMeta } from './meta';
import { ARKIT_NAMES, normalizeExpressionName } from '../tracking/arkit';

export class AvatarLoadError extends Error {}

export async function loadAvatarSource(
  source: string | File,
  onProgress?: (ratio: number) => void,
): Promise<RigSource> {
  const isFile = typeof source !== 'string';
  const fileName = isFile ? source.name : decodeURIComponent(source.split('/').pop() || source);
  let buffer: ArrayBuffer;
  if (isFile) {
    buffer = await source.arrayBuffer();
  } else {
    buffer = await fetchModel(source, fileName, onProgress);
  }
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser, { autoUpdateHumanBones: true }));
  let gltf: GLTF;
  try {
    gltf = await loader.parseAsync(buffer, isFile ? '' : source.replace(/[^/]*$/, ''));
  } catch (err) {
    throw new AvatarLoadError(`模型 ${fileName} 解析失败：${(err as Error)?.message ?? err}。请确认文件是 .vrm 或 .glb（glTF 2.0）格式。`);
  }
  const vrm = gltf.userData.vrm as VRM | undefined;
  if (vrm) return fromVrm(vrm, fileName);
  return adaptGltf(gltf, fileName);
}

/** 下载模型并报告进度；文件不存在时给出明确提示（开发服务器对不存在的路径会返回 index.html）。 */
async function fetchModel(url: string, fileName: string, onProgress?: (r: number) => void): Promise<ArrayBuffer> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new AvatarLoadError(`无法读取模型 ${fileName}：${(err as Error)?.message ?? err}`);
  }
  const type = res.headers.get('content-type') ?? '';
  if (!res.ok || type.includes('text/html')) {
    throw new AvatarLoadError(`找不到模型文件：${fileName}。请把模型放到 public/models/ 下（默认路径 public/models/avatar.vrm），然后刷新页面。`);
  }
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || !total) return res.arrayBuffer();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress?.(Math.min(1, loaded / total));
  }
  const out = new Uint8Array(loaded);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out.buffer;
}

function fromVrm(vrm: VRM, fileName: string): RigSource {
  const isV0 = (vrm.meta as { metaVersion?: string })?.metaVersion === '0';
  VRMUtils.removeUnnecessaryVertices(vrm.scene);
  if (isV0) VRMUtils.rotateVRM0(vrm);
  vrm.scene.traverse((o) => {
    o.frustumCulled = false;
  });
  if (!vrm.expressionManager) throw new AvatarLoadError('该 VRM 没有表情数据（expressionManager 为空），无法面捕。');
  return {
    kind: isV0 ? 'vrm0' : 'vrm1',
    scene: vrm.scene,
    humanoid: vrm.humanoid,
    expressions: vrm.expressionManager,
    lookAt: vrm.lookAt ?? null,
    meta: readVrmMeta(vrm, fileName),
    update: (dt) => vrm.update(dt),
    dispose: () => VRMUtils.deepDispose(vrm.scene),
    vrm,
    notes: [],
  };
}

// ———————————————————— 普通 GLB 适配 ————————————————————

const SIDE = (side: 'Left' | 'Right') => {
  const l = side === 'Left';
  const s = l ? 'l' : 'r';
  return { full: side, s, S: s.toUpperCase(), l };
};

/** 常见命名：Mixamo（mixamorig:LeftArm）、VRM 风格（LeftUpperArm）、Blender（upper_arm.L / UpperArm_L）。 */
function bonePatterns(): Partial<Record<VRMHumanBoneName, RegExp[]>> {
  const p: Partial<Record<VRMHumanBoneName, RegExp[]>> = {
    hips: [/^(mixamorig\d*[:_]?)?hips$/i, /^pelvis$/i, /^hip$/i, /^root_?hips$/i, /^J_Bip_C_Hips$/i],
    spine: [/^(mixamorig\d*[:_]?)?spine$/i, /^spine[._]?0*1$/i, /^J_Bip_C_Spine$/i],
    chest: [/^(mixamorig\d*[:_]?)?spine1$/i, /^chest$/i, /^spine[._]?0*2$/i, /^J_Bip_C_Chest$/i],
    upperChest: [/^(mixamorig\d*[:_]?)?spine2$/i, /^upper_?chest$/i, /^spine[._]?0*3$/i, /^J_Bip_C_UpperChest$/i],
    neck: [/^(mixamorig\d*[:_]?)?neck$/i, /^neck[._]?0*1$/i, /^J_Bip_C_Neck$/i],
    head: [/^(mixamorig\d*[:_]?)?head$/i, /^J_Bip_C_Head$/i],
  };
  for (const side of ['Left', 'Right'] as const) {
    const { full, s, S } = SIDE(side);
    const tail = `([._ -]?(${s}|${S}|${full}))`;
    const head = `((${full}|${s}|${S})[._ -]?)`;
    const both = (core: string) => [
      new RegExp(`^(mixamorig\\d*[:_]?)?${full}${core}$`, 'i'),
      new RegExp(`^${head}${core}$`, 'i'),
      new RegExp(`^${core}${tail}$`, 'i'),
      // VRoid 导出的骨骼名：J_Bip_L_UpperArm / J_Adj_L_FaceEye
      new RegExp(`^J_(Bip|Adj)_${S}_${core}$`, 'i'),
    ];
    p[`${side.toLowerCase()}Shoulder` as VRMHumanBoneName] = [...both('shoulder'), ...both('clavicle')];
    p[`${side.toLowerCase()}UpperArm` as VRMHumanBoneName] = [...both('upper_?arm'), new RegExp(`^(mixamorig\\d*[:_]?)?${full}arm$`, 'i')];
    p[`${side.toLowerCase()}LowerArm` as VRMHumanBoneName] = [...both('lower_?arm'), ...both('fore_?arm')];
    p[`${side.toLowerCase()}Hand` as VRMHumanBoneName] = both('hand');
    p[`${side.toLowerCase()}Eye` as VRMHumanBoneName] = [...both('eye'), new RegExp(`^J_Adj_${S}_FaceEye$`, 'i')];
    p[`${side.toLowerCase()}UpperLeg` as VRMHumanBoneName] = [...both('upper_?leg'), ...both('thigh'), new RegExp(`^(mixamorig\\d*[:_]?)?${full}upleg$`, 'i')];
    p[`${side.toLowerCase()}LowerLeg` as VRMHumanBoneName] = [...both('lower_?leg'), ...both('shin'), ...both('calf'), new RegExp(`^(mixamorig\\d*[:_]?)?${full}leg$`, 'i')];
    p[`${side.toLowerCase()}Foot` as VRMHumanBoneName] = both('foot');
    for (const f of ['Thumb', 'Index', 'Middle', 'Ring', 'Little'] as const) {
      const alias = f === 'Little' ? '(little|pinky)' : f.toLowerCase();
      const segs = f === 'Thumb' ? ['Metacarpal', 'Proximal', 'Distal'] : ['Proximal', 'Intermediate', 'Distal'];
      segs.forEach((seg, i) => {
        const name = `${side.toLowerCase()}${f}${seg}` as VRMHumanBoneName;
        const n = i + 1;
        p[name] = [
          new RegExp(`^(mixamorig\\d*[:_]?)?${full}hand${alias}${n}$`, 'i'),
          ...both(`${alias}[._]?${seg.toLowerCase()}`),
          ...both(`${alias}[._]?0*${n}`),
          new RegExp(`^J_Bip_${S}_${f === 'Little' ? 'Little' : f}${n}$`, 'i'),
        ];
      });
    }
  }
  return p;
}

export function adaptGltf(gltf: GLTF, fileName: string): RigSource {
  const scene = gltf.scene;
  const notes: string[] = ['这是普通 GLB（非 VRM）：骨骼按名称猜测，静止姿势应为 T-pose 或 A-pose。'];
  // 多个 primitive 共用一份顶点缓冲时，去掉每个 primitive 里没用到的顶点（也减少显存）
  VRMUtils.removeUnnecessaryVertices(scene);
  const nodes: Object3D[] = [];
  scene.traverse((o) => {
    o.frustumCulled = false;
    if ((o as { isBone?: boolean }).isBone || o.type === 'Object3D' || o.type === 'Bone') nodes.push(o);
  });
  const patterns = bonePatterns();
  const human: VRMHumanBones = {} as VRMHumanBones;
  for (const [bone, list] of Object.entries(patterns) as [VRMHumanBoneName, RegExp[]][]) {
    const node = nodes.find((n) => list.some((re) => re.test(n.name)));
    if (node) (human as Record<string, { node: Object3D }>)[bone] = { node };
  }
  if (!human.head) {
    throw new AvatarLoadError(`GLB 模型 ${fileName} 中没有找到头部骨骼（head / Head / mixamorig:Head）。建议先在 Blender 中用 VRM Add-on 导出为 VRM。`);
  }
  // 先在模型原始坐标系里建立 normalized 骨骼（与 three-vrm 处理 VRM0 的方式一致），再判断朝向。
  // 本项目约定角色面朝 +Z；VRoid / UniVRM 导出的普通 glTF 往往面朝 -Z，需要整体转 180°。
  const backwards = facesNegativeZ(scene, human);
  const humanoid = new VRMHumanoid(human, { autoUpdateHumanBones: true });
  scene.add(humanoid.normalizedHumanBonesRoot);
  if (backwards) {
    scene.rotation.y = Math.PI;
    notes.push('检测到模型面朝 -Z，已自动旋转 180°。');
  }
  scene.updateMatrixWorld(true);

  // 表情：ARKit 同名 Morph Target + 常见口型 / 眨眼名称
  const expressions = new VRMExpressionManager();
  const morphOwners = new Map<string, { meshes: Mesh[]; index: number; original: string }[]>();
  scene.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh || !mesh.morphTargetDictionary) return;
    for (const [name, index] of Object.entries(mesh.morphTargetDictionary)) {
      const key = normalizeExpressionName(name);
      const list = morphOwners.get(key) ?? [];
      const same = list.find((x) => x.index === index && x.original === name);
      if (same) same.meshes.push(mesh);
      else list.push({ meshes: [mesh], index, original: name });
      morphOwners.set(key, list);
    }
  });
  const register = (exprName: string, morphKeys: string[]) => {
    for (const k of morphKeys) {
      const owners = morphOwners.get(k);
      if (!owners) continue;
      const exp = new VRMExpression(exprName);
      for (const o of owners) exp.addBind(new VRMExpressionMorphTargetBind({ primitives: o.meshes, index: o.index, weight: 1 }));
      expressions.registerExpression(exp);
      return true;
    }
    return false;
  };
  let arkitCount = 0;
  for (const n of ARKIT_NAMES) if (register(n, [normalizeExpressionName(n)])) arkitCount++;
  const presetMorphs: Record<string, string[]> = {
    blink: ['blink', 'eyesclosed', 'eyeclose'],
    blinkLeft: ['blinkleft', 'blinkl', 'eyeclosedleft', 'eyeclosel'],
    blinkRight: ['blinkright', 'blinkr', 'eyeclosedright', 'eyecloser'],
    aa: ['aa', 'visemeaa', 'mouthopen', 'a'],
    ih: ['ih', 'visemei', 'i'],
    ou: ['ou', 'visemeu', 'u'],
    ee: ['ee', 'visemee', 'e'],
    oh: ['oh', 'visemeo', 'o'],
    happy: ['happy', 'joy', 'smile'],
    relaxed: ['relaxed', 'fun'],
    sad: ['sad', 'sorrow'],
    angry: ['angry'],
    surprised: ['surprised'],
  };
  for (const [preset, keys] of Object.entries(presetMorphs)) register(preset, keys);
  if (expressions.expressions.length === 0) notes.push('GLB 中没有可识别的 Morph Target，角色无法做面部表情，只有头部和身体会动。');
  else notes.push(`GLB 中识别到 ${arkitCount} 个 ARKit 同名 Morph Target、${expressions.expressions.length - arkitCount} 个预设表情。`);

  const meta: ModelMeta = {
    title: fileName,
    author: '—',
    version: '—',
    specVersion: 'glTF 2.0（非 VRM）',
    fileName,
    license: [{ label: '说明', value: 'GLB 文件不包含 VRM 授权字段，请另行核对模型授权。' }],
  };
  return {
    kind: 'glb',
    scene,
    humanoid,
    expressions,
    lookAt: null,
    meta,
    update: () => {
      humanoid.update();
      expressions.update();
    },
    dispose: () => VRMUtils.deepDispose(scene),
    notes,
  };
}

function facesNegativeZ(scene: Object3D, human: VRMHumanBones): boolean {
  scene.updateMatrixWorld(true);
  const pos = (name: VRMHumanBoneName) => {
    const n = (human as Record<string, { node: Object3D } | undefined>)[name]?.node;
    return n ? n.getWorldPosition(new Vector3()) : null;
  };
  const head = pos('head');
  const le = pos('leftEye');
  const re = pos('rightEye');
  if (head && le && re) {
    const dz = (le.z + re.z) / 2 - head.z;
    if (Math.abs(dz) > 1e-4) return dz < 0;
  }
  const la = pos('leftUpperArm');
  const ra = pos('rightUpperArm');
  if (la && ra && Math.abs(la.x - ra.x) > 1e-4) return la.x < ra.x;
  return false;
}

export function disposeMaterial(m: Material | Material[]): void {
  (Array.isArray(m) ? m : [m]).forEach((x) => x.dispose());
}
