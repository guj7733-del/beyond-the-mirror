import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Matrix3,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Quaternion,
  Raycaster,
  SkinnedMesh,
  Vector3,
} from 'three';
import { categorizeMaterialName, baseMaterialName, materialsOf, type MaterialCategory } from './materials';

export interface BakedMesh {
  mesh: Mesh;
  category: MaterialCategory;
  materialName: string;
}

/** 世界坐标下（静止姿态）的面部关键位置。 */
export interface FaceAnchorsWorld {
  eyeL: Vector3;
  eyeR: Vector3;
  eyeW: number;
  eyeH: number;
  underEyeL: Vector3;
  underEyeR: Vector3;
  forehead: Vector3;
  foreheadW: number;
  foreheadH: number;
  headTop: Vector3;
  mouthSide: Vector3;
  headCenter: Vector3;
  /** 下巴最低点（面部中线上）。头部叠脸版本用它确定裁切线和缩放。 */
  chin: Vector3;
  /** 下巴是否由射线测得（false 表示按比例估算）。 */
  chinMeasured: boolean;
  /** 脸宽：下巴到眼睛之间、头部前半部分的皮肤顶点的左右范围（不含耳朵）。 */
  faceWidth: number;
}

export interface FaceAnchors {
  head: Object3D;
  /** 静止姿态下 head 骨骼的世界矩阵的逆，用于把世界坐标换算到 head 局部坐标。 */
  headInv: Matrix4;
  headWorldQuat: Quaternion;
  /** head 骨骼的世界缩放（部分 Mixamo 模型的骨架带 0.01 缩放）。 */
  headWorldScale: Vector3;
  world: FaceAnchorsWorld;
  baked: BakedMesh[];
  method: 'eye-mesh' | 'eye-bones' | 'estimated';
  notes: string[];
  /** 模型整体高度（米），用于估算尺寸。 */
  modelHeight: number;
  modelBottomY: number;
}

const _v = new Vector3();
const _n = new Vector3();

/** 遍历几何体中真正被三角形引用的顶点（有索引时按索引去重）。 */
function forEachUsedVertex(geom: BufferGeometry, fn: (p: Vector3) => void): void {
  const pos = geom.getAttribute('position') as BufferAttribute;
  const p = new Vector3();
  const index = geom.index;
  if (!index) {
    for (let i = 0; i < pos.count; i++) fn(p.fromBufferAttribute(pos, i));
    return;
  }
  const seen = new Uint8Array(pos.count);
  for (let k = 0; k < index.count; k++) {
    const i = index.getX(k);
    if (seen[i]) continue;
    seen[i] = 1;
    fn(p.fromBufferAttribute(pos, i));
  }
}

/** 把（蒙皮）网格在当前姿态下的顶点烘焙成世界坐标几何体，供射线检测和贴花投射使用。 */
export function bakeMesh(src: Mesh): Mesh | null {
  const geom = src.geometry as BufferGeometry;
  const pos = geom.getAttribute('position') as BufferAttribute | undefined;
  if (!pos) return null;
  const count = pos.count;
  const outPos = new Float32Array(count * 3);
  const nrm = geom.getAttribute('normal') as BufferAttribute | undefined;
  const outNrm = new Float32Array(count * 3);
  const skinned = (src as SkinnedMesh).isSkinnedMesh ? (src as SkinnedMesh) : null;
  const normalMatrix = new Matrix3().getNormalMatrix(src.matrixWorld);
  for (let i = 0; i < count; i++) {
    _v.fromBufferAttribute(pos, i);
    if (skinned && skinned.geometry.getAttribute('skinIndex')) skinned.applyBoneTransform(i, _v);
    _v.applyMatrix4(src.matrixWorld);
    outPos[i * 3] = _v.x;
    outPos[i * 3 + 1] = _v.y;
    outPos[i * 3 + 2] = _v.z;
    if (nrm) {
      _n.fromBufferAttribute(nrm, i).applyMatrix3(normalMatrix).normalize();
      outNrm[i * 3] = _n.x;
      outNrm[i * 3 + 1] = _n.y;
      outNrm[i * 3 + 2] = _n.z;
    } else {
      outNrm[i * 3 + 2] = 1;
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(outPos, 3));
  g.setAttribute('normal', new BufferAttribute(outNrm, 3));
  if (geom.index) g.setIndex(geom.index.clone());
  const uv = geom.getAttribute('uv');
  if (uv) g.setAttribute('uv', (uv as BufferAttribute).clone());
  g.computeBoundingBox();
  g.computeBoundingSphere();
  const m = new Mesh(g, new MeshBasicMaterial({ side: DoubleSide }));
  m.matrixAutoUpdate = false;
  m.updateMatrixWorld(true);
  return m;
}

export function bakeAll(root: Object3D, overrides?: Record<string, MaterialCategory>): BakedMesh[] {
  root.updateMatrixWorld(true);
  const out: BakedMesh[] = [];
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh || mesh.userData.bmOverlay || !mesh.visible) return;
    const mats = materialsOf(mesh);
    const mat = mats[0];
    if (!mat) return;
    const materialName = baseMaterialName(mat);
    const baked = bakeMesh(mesh);
    if (!baked) return;
    out.push({ mesh: baked, category: categorizeMaterialName(materialName, overrides), materialName });
  });
  return out;
}

const ray = new Raycaster();
/** 从角色正前方向 -Z 打射线，返回第一个命中点（世界坐标）。 */
export function frontHit(x: number, y: number, fromZ: number, meshes: Mesh[]): Vector3 | null {
  if (meshes.length === 0) return null;
  ray.set(new Vector3(x, y, fromZ), new Vector3(0, 0, -1));
  ray.far = fromZ + 10;
  const hits = ray.intersectObjects(meshes, false);
  return hits.length ? hits[0].point.clone() : null;
}

interface AnchorInput {
  root: Object3D;
  head: Object3D;
  leftEye: Object3D | null;
  rightEye: Object3D | null;
  overrides?: Record<string, MaterialCategory>;
}

/**
 * 在静止姿态下（加载完成、尚未摆姿势）计算眼睛、眼下、额头、头顶等位置。
 * 优先级：眼白网格的包围盒 → 眼睛骨骼 + 射线 → 按头部骨骼估算。
 */
export function computeFaceAnchors(input: AnchorInput): FaceAnchors {
  const { root, head } = input;
  const notes: string[] = [];
  const baked = bakeAll(root, input.overrides);
  head.updateMatrixWorld(true);
  const headPos = head.getWorldPosition(new Vector3());
  const headWorldQuat = head.getWorldQuaternion(new Quaternion());

  const all = new Box3();
  for (const b of baked) forEachUsedVertex(b.mesh.geometry, (p) => all.expandByPoint(p));
  const modelBottomY = all.min.y;
  const modelHeight = Math.max(0.3, all.max.y - all.min.y);
  const scale = modelHeight / 1.6;
  const fromZ = headPos.z + 2 * scale;

  const everything = baked.map((b) => b.mesh);
  const faceCandidates = baked.filter((b) => b.category === 'skin' || b.category === 'face' || b.category === 'eye').map((b) => b.mesh);
  // 材质名无法识别时（例如 Mixamo 模型），所有网格都当作面部网格参与定位
  const faceMeshes = faceCandidates.length ? faceCandidates : everything;
  const skinMeshes = baked.filter((b) => b.category === 'skin').map((b) => b.mesh);

  // —— 1. 眼白 / 眼睛网格的包围盒 ——
  let method: FaceAnchors['method'] = 'estimated';
  let eyeL: Vector3 | null = null;
  let eyeR: Vector3 | null = null;
  let eyeW = 0.045 * scale;
  let eyeH = 0.03 * scale;
  const eyeBaked = baked.filter((b) => b.category === 'eye');
  const whites = eyeBaked.filter((b) => /white|sclera/i.test(b.materialName));
  const eyeSource = whites.length ? whites : eyeBaked;
  if (eyeSource.length) {
    const boxL = new Box3();
    const boxR = new Box3();
    const radius = 0.3 * scale;
    for (const b of eyeSource) {
      forEachUsedVertex(b.mesh.geometry, (p) => {
        if (p.distanceTo(headPos) > radius) return;
        if (p.x >= headPos.x) boxL.expandByPoint(p);
        else boxR.expandByPoint(p);
      });
    }
    const okBox = (b: Box3) => !b.isEmpty() && b.max.x - b.min.x > 0.004 * scale && b.max.y - b.min.y > 0.002 * scale;
    if (okBox(boxL) && okBox(boxR)) {
      eyeL = boxL.getCenter(new Vector3());
      eyeL.z = boxL.max.z;
      eyeR = boxR.getCenter(new Vector3());
      eyeR.z = boxR.max.z;
      eyeW = ((boxL.max.x - boxL.min.x) + (boxR.max.x - boxR.min.x)) / 2;
      eyeH = ((boxL.max.y - boxL.min.y) + (boxR.max.y - boxR.min.y)) / 2;
      method = 'eye-mesh';
    }
  }
  // —— 2. 眼睛骨骼 ——
  if (!eyeL && input.leftEye && input.rightEye) {
    const l = input.leftEye.getWorldPosition(new Vector3());
    const r = input.rightEye.getWorldPosition(new Vector3());
    const spacing = Math.abs(l.x - r.x);
    eyeW = spacing * 0.48;
    eyeH = spacing * 0.36;
    const hl = frontHit(l.x, l.y, fromZ, faceMeshes);
    const hr = frontHit(r.x, r.y, fromZ, faceMeshes);
    eyeL = new Vector3(l.x, l.y, hl ? hl.z : l.z + 0.01 * scale);
    eyeR = new Vector3(r.x, r.y, hr ? hr.z : r.z + 0.01 * scale);
    method = 'eye-bones';
    notes.push('没有识别到眼白网格，眼部贴片按眼睛骨骼定位。');
  }
  // —— 3. 估算 ——
  if (!eyeL || !eyeR) {
    const spacing = 0.062 * scale;
    const y = headPos.y + 0.075 * scale;
    const hl = frontHit(headPos.x + spacing / 2, y, fromZ, faceMeshes.length ? faceMeshes : everything);
    const hr = frontHit(headPos.x - spacing / 2, y, fromZ, faceMeshes.length ? faceMeshes : everything);
    eyeL = new Vector3(headPos.x + spacing / 2, y, hl ? hl.z : headPos.z + 0.09 * scale);
    eyeR = new Vector3(headPos.x - spacing / 2, y, hr ? hr.z : headPos.z + 0.09 * scale);
    eyeW = spacing * 0.48;
    eyeH = spacing * 0.36;
    notes.push('模型没有眼睛骨骼或眼白网格，眼部贴片位置为估算值，可在模型配置中微调。');
  }

  const spacing = Math.abs(eyeL.x - eyeR.x);
  const eyeY = (eyeL.y + eyeR.y) / 2;
  const midX = (eyeL.x + eyeR.x) / 2;
  const frontZ = Math.max(eyeL.z, eyeR.z);

  // 眼下：贴在下眼睑下方的皮肤上
  const underY = (e: Vector3) => e.y - eyeH * 0.5 - eyeH * 0.12;
  const skinTargets = skinMeshes.length ? skinMeshes : faceMeshes;
  const ul = frontHit(eyeL.x, underY(eyeL), fromZ, skinTargets);
  const ur = frontHit(eyeR.x, underY(eyeR), fromZ, skinTargets);
  const underEyeL = new Vector3(eyeL.x, underY(eyeL), ul ? ul.z : frontZ);
  const underEyeR = new Vector3(eyeR.x, underY(eyeR), ur ? ur.z : frontZ);
  if (!skinMeshes.length) notes.push('没有识别到皮肤材质，黑眼圈贴片投射到所有面部网格上。');

  // 额头：下沿约在眉毛处，向上覆盖刘海；取正前方最外层（可能是刘海）
  const foreheadW = spacing * 1.6;
  const foreheadH = foreheadW * 0.95;
  const foreheadY = eyeY + eyeH * 0.5 + foreheadH * 0.38;
  const fh = frontHit(midX, foreheadY, fromZ, everything);
  const forehead = new Vector3(midX, foreheadY, (fh ? fh.z : frontZ) + 0.004 * scale);

  // 头顶：头部附近顶点的最高点
  let topY = headPos.y + 0.2 * scale;
  {
    const scan = (list: BakedMesh[]) => {
      let best = -Infinity;
      for (const b of list) {
        forEachUsedVertex(b.mesh.geometry, (q) => {
          const dx = q.x - headPos.x;
          const dz = q.z - headPos.z;
          if (dx * dx + dz * dz > (0.22 * scale) ** 2) return;
          if (q.y > best) best = q.y;
        });
      }
      return best;
    };
    let best = scan(baked.filter((b) => b.category === 'hair' || b.category === 'skin' || b.category === 'face'));
    if (!Number.isFinite(best) || best <= headPos.y) best = scan(baked);
    if (Number.isFinite(best) && best > headPos.y) topY = best;
  }
  const headTop = new Vector3(headPos.x, topY, headPos.z);

  // 下巴：沿面部中线从眼睛往下逐行打射线，命中点突然向后跳（越过下巴落到脖子上）
  // 或不再命中时，上一行就是下巴。
  const chinTargets = baked.filter((b) => b.category === 'skin' || b.category === 'face').map((b) => b.mesh);
  let chin: Vector3 | null = null;
  {
    const step = 0.003 * scale;
    let prev: Vector3 | null = null;
    for (let y = eyeY - eyeH; y > eyeY - 0.3 * scale; y -= step) {
      const hit = frontHit(midX, y, fromZ, chinTargets.length ? chinTargets : everything);
      if (prev && (!hit || prev.z - hit.z > 0.02 * scale)) {
        chin = prev;
        break;
      }
      if (hit) prev = hit;
    }
  }
  const chinMeasured = !!chin;
  // 脸宽：只取头部前半部分（排除耳朵），高度在下巴和眼睛上沿之间
  let faceWidth = spacing * 1.9;
  {
    let minX = Infinity;
    let maxX = -Infinity;
    const yLo = (chin ?? new Vector3(0, eyeY - (topY - eyeY) * 0.75, 0)).y;
    const yHi = eyeY + eyeH * 0.5;
    const zMin = headPos.z + 0.25 * (frontZ - headPos.z);
    for (const b of baked) {
      if (b.category !== 'skin' && b.category !== 'face') continue;
      forEachUsedVertex(b.mesh.geometry, (q) => {
        if (q.y < yLo || q.y > yHi || q.z < zMin) return;
        if (Math.abs(q.x - midX) > 0.25 * scale) return;
        if (q.x < minX) minX = q.x;
        if (q.x > maxX) maxX = q.x;
      });
    }
    if (Number.isFinite(minX) && maxX - minX > spacing) faceWidth = maxX - minX;
  }
  if (!chin) {
    chin = new Vector3(midX, eyeY - (topY - eyeY) * 0.75, frontZ - 0.02 * scale);
    notes.push('没有测到下巴位置，头部叠脸版本的裁切线按比例估算。');
  }
  const headCenter = new Vector3(midX, (eyeY + topY) / 2 - eyeH, headPos.z);
  // 角色右侧（屏幕左侧）嘴边，用于叹气符号
  const mouthSide = new Vector3(midX - spacing * 0.95, eyeY - eyeH * 2.5, frontZ + 0.025 * scale);

  const headInv = head.matrixWorld.clone().invert();
  return {
    head,
    headInv,
    headWorldQuat,
    headWorldScale: head.getWorldScale(new Vector3()),
    world: {
      eyeL, eyeR, eyeW, eyeH, underEyeL, underEyeR,
      forehead, foreheadW, foreheadH,
      headTop, mouthSide, headCenter, chin, chinMeasured, faceWidth,
    },
    baked,
    method,
    notes,
    modelHeight,
    modelBottomY,
  };
}
