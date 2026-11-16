#!/usr/bin/env node
/**
 * 模型检查（命令行，不需要浏览器）。
 *   npm run inspect-model                      # 默认检查 public/models/avatar.vrm
 *   npm run inspect-model -- path/to/model.vrm # 检查指定文件（.vrm / .glb）
 *   npm run inspect-model -- model.vrm --md    # 输出 Markdown（可直接贴进文档）
 *
 * 输出：格式与版本、授权字段、人形骨骼（缺失项）、表情列表、ARKit 52 覆盖情况、
 * Morph Target 名称、材质及其调色分组。浏览器里的“调试 → 模型检查”给出同样的信息，
 * 并额外说明运行时采用的降级方式。
 */
import fs from 'node:fs';
import path from 'node:path';

const ARKIT = [
  'browDownLeft', 'browDownRight', 'browInnerUp', 'browOuterUpLeft', 'browOuterUpRight', 'cheekPuff', 'cheekSquintLeft', 'cheekSquintRight',
  'eyeBlinkLeft', 'eyeBlinkRight', 'eyeLookDownLeft', 'eyeLookDownRight', 'eyeLookInLeft', 'eyeLookInRight', 'eyeLookOutLeft', 'eyeLookOutRight',
  'eyeLookUpLeft', 'eyeLookUpRight', 'eyeSquintLeft', 'eyeSquintRight', 'eyeWideLeft', 'eyeWideRight', 'jawForward', 'jawLeft', 'jawOpen', 'jawRight',
  'mouthClose', 'mouthDimpleLeft', 'mouthDimpleRight', 'mouthFrownLeft', 'mouthFrownRight', 'mouthFunnel', 'mouthLeft', 'mouthLowerDownLeft',
  'mouthLowerDownRight', 'mouthPressLeft', 'mouthPressRight', 'mouthPucker', 'mouthRight', 'mouthRollLower', 'mouthRollUpper', 'mouthShrugLower',
  'mouthShrugUpper', 'mouthSmileLeft', 'mouthSmileRight', 'mouthStretchLeft', 'mouthStretchRight', 'mouthUpperUpLeft', 'mouthUpperUpRight',
  'noseSneerLeft', 'noseSneerRight', 'tongueOut',
];
const BONES = [
  ['head', '必需'], ['neck', '推荐'], ['spine', '推荐'], ['chest', '推荐'], ['upperChest', '可选'], ['leftShoulder', '可选'], ['rightShoulder', '可选'],
  ['leftUpperArm', '推荐'], ['rightUpperArm', '推荐'], ['leftLowerArm', '推荐'], ['rightLowerArm', '推荐'], ['leftHand', '推荐'], ['rightHand', '推荐'],
  ['leftEye', '可选'], ['rightEye', '可选'], ['leftIndexProximal', '可选'], ['rightIndexProximal', '可选'],
];
const norm = (n) => n.toLowerCase().replace(/^.*[.:|/]/, '').replace(/^(arkit|bs|blendshape\d*|shape)[_-]?/, '').replace(/[^a-z0-9]/g, '');

function categorize(name) {
  const m = name.match(/_(SKIN|HAIR|CLOTH|EYE|FACE)$/);
  if (m) return { SKIN: 'skin', HAIR: 'hair', CLOTH: 'cloth', EYE: 'eye', FACE: 'face' }[m[1]];
  if (/eye(?!lash|line|brow)|iris|pupil|highlight|sclera|瞳|目/i.test(name)) return 'eye';
  if (/brow|lash|eyeline|mouth|teeth|tooth|tongue|lip|眉|睫/i.test(name)) return 'face';
  if (/hair|bang|fringe|ponytail|髪|发/i.test(name)) return 'hair';
  if (/cloth|top|bottom|shirt|jacket|coat|dress|skirt|pant|shoe|sock|hood|uniform|outfit|衣|服|鞋/i.test(name)) return 'cloth';
  if (/skin|body|face|head|neck|arm|hand|leg|肌|肤|顔|脸/i.test(name)) return 'skin';
  return 'other';
}

function readGlbJson(file) {
  const buf = fs.readFileSync(file);
  if (buf.toString('ascii', 0, 4) !== 'glTF') throw new Error('不是 GLB 二进制文件（.vrm 与 .glb 都应以 glTF 头开始）');
  const len = buf.readUInt32LE(12);
  const type = buf.toString('ascii', 16, 20);
  if (type !== 'JSON') throw new Error('GLB 第一个数据块不是 JSON');
  return { json: JSON.parse(buf.toString('utf8', 20, 20 + len)), size: buf.length };
}

const args = process.argv.slice(2);
const md = args.includes('--md');
const file = args.find((a) => !a.startsWith('--')) ?? 'public/models/avatar.vrm';
if (!fs.existsSync(file)) {
  console.error(`找不到文件：${file}`);
  process.exit(1);
}
const { json, size } = readGlbJson(file);
const ext = json.extensions ?? {};
const lines = [];
const out = (s = '') => lines.push(s);
const vrm0 = ext.VRM;
const vrm1 = ext.VRMC_vrm;
out(`# 模型检查：${path.basename(file)}`);
out();
out(`- 文件大小：${(size / 1024 / 1024).toFixed(1)} MB`);
out(`- 格式：${vrm0 ? `VRM 0.x（specVersion ${vrm0.specVersion ?? '?'}，导出工具 ${vrm0.exporterVersion ?? '?'}）` : vrm1 ? `VRM 1.0（specVersion ${vrm1.specVersion}）` : 'glTF 2.0（非 VRM）'}`);
out(`- 网格 ${json.meshes?.length ?? 0} 个，材质 ${json.materials?.length ?? 0} 个，节点 ${json.nodes?.length ?? 0} 个，蒙皮 ${json.skins?.length ?? 0} 个`);
out();

// 授权
out('## 授权字段（请人工核对）');
out();
const meta = vrm0?.meta ?? vrm1?.meta;
if (meta) {
  for (const [k, v] of Object.entries(meta)) {
    if (k === 'texture' || k === 'thumbnailImage') continue;
    out(`- ${k}: ${Array.isArray(v) ? v.join(', ') : v}`);
  }
} else out('- （GLB 不含 VRM 授权字段，请另行确认模型授权）');
out();

// 骨骼
out('## 人形骨骼');
out();
let boneMap = {};
if (vrm0) for (const b of vrm0.humanoid?.humanBones ?? []) boneMap[b.bone] = json.nodes[b.node]?.name;
else if (vrm1) for (const [k, b] of Object.entries(vrm1.humanoid?.humanBones ?? {})) boneMap[k] = json.nodes[b.node]?.name;
if (!vrm0 && !vrm1) {
  out('- 非 VRM：运行时按骨骼名称猜测（Mixamo / VRoid J_Bip / LeftUpperArm / upper_arm.L 等命名）。节点名称示例：');
  out(`  ${(json.nodes ?? []).slice(0, 40).map((n) => n.name).filter(Boolean).join(', ')}`);
} else {
  out(`- 共 ${Object.keys(boneMap).length} 根`);
  const missing = BONES.filter(([b]) => !boneMap[b]);
  out(`- 本项目用到的骨骼：${BONES.map(([b, lv]) => `${b}${boneMap[b] ? '✓' : '✗'}(${lv})`).join('，')}`);
  if (missing.length) out(`- **缺失：${missing.map(([b, lv]) => `${b}（${lv}）`).join('、')}**`);
}
out();

// 表情
out('## 表情');
out();
const exprNames = [];
if (vrm0) {
  for (const g of vrm0.blendShapeMaster?.blendShapeGroups ?? []) exprNames.push({ name: g.name, preset: g.presetName, binds: g.binds?.length ?? 0 });
} else if (vrm1) {
  for (const [k, v] of Object.entries(vrm1.expressions?.preset ?? {})) exprNames.push({ name: k, preset: k, binds: v.morphTargetBinds?.length ?? 0 });
  for (const [k, v] of Object.entries(vrm1.expressions?.custom ?? {})) exprNames.push({ name: k, preset: 'custom', binds: v.morphTargetBinds?.length ?? 0 });
}
const morphNames = new Set();
for (const m of json.meshes ?? []) {
  const names = m.extras?.targetNames ?? m.primitives?.[0]?.extras?.targetNames ?? [];
  names.forEach((n) => morphNames.add(n));
}
if (exprNames.length) {
  const presets = exprNames.filter((e) => e.preset && e.preset !== 'unknown' && e.preset !== 'custom');
  out(`- VRM 表情 ${exprNames.length} 个；预设：${presets.map((e) => e.name).join(', ') || '无'}`);
}
const pool = new Set([...exprNames.map((e) => norm(e.name)), ...(!vrm0 && !vrm1 ? [...morphNames].map(norm) : [])]);
const direct = ARKIT.filter((a) => pool.has(norm(a)));
const missingArkit = ARKIT.filter((a) => !pool.has(norm(a)));
out(`- ARKit 52（Perfect Sync）同名表情：**${direct.length} / 52**${direct.length === 52 ? '（完整，面捕直连）' : direct.length ? '（部分，缺失项走预设回退）' : '（无，面捕走 VRM 预设回退）'}`);
if (missingArkit.length && missingArkit.length < 52) out(`- 缺少：${missingArkit.join(', ')}`);
const extras = [...morphNames].filter((n) => /highlight_?hide/i.test(n));
out(`- 疲惫专用 Morph：${extras.length ? extras.join(', ') + '（用于眼神失去高光）' : '无（改用眼睛材质变暗）'}`);
out(`- Morph Target 共 ${morphNames.size} 个${morphNames.size ? `：${[...morphNames].slice(0, 30).join(', ')}${morphNames.size > 30 ? ' …' : ''}` : ''}`);
out();

// 材质
out('## 材质与调色分组');
out();
const shaders = new Map((vrm0?.materialProperties ?? []).map((m) => [m.name, m.shader]));
const counts = {};
for (const m of json.materials ?? []) {
  const c = categorize(m.name ?? '');
  counts[c] = (counts[c] ?? 0) + 1;
  out(`- ${m.name} → ${c}${shaders.get(m.name) ? `（${shaders.get(m.name)}）` : ''}`);
}
out();
out(`分组统计：${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join('，')}`);
if (!counts.skin) out('提示：没有识别到 skin 分组。黑眼圈贴花会投射到所有面部网格；可在 models/<模型名>.config.json 的 materialCategories 中手动指定。');

console.log(md ? lines.join('\n') : lines.join('\n').replace(/\*\*/g, ''));
