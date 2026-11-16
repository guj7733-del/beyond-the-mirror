import type { VRMHumanBoneName } from '@pixiv/three-vrm';
import type { RigSource, RigKind } from './RigSource';
import type { ModelMeta } from './meta';
import type { ChannelBinding } from './ExpressionBinding';
import type { GradedMaterialInfo } from './MaterialGrader';

export interface BoneCheck {
  name: VRMHumanBoneName | string;
  present: boolean;
  level: 'required' | 'recommended' | 'optional';
  usage: string;
}

export interface CapabilityReport {
  kind: RigKind;
  meta: ModelMeta;
  bones: BoneCheck[];
  expressionNames: string[];
  channels: ChannelBinding[];
  counts: { direct: number; fallback: number; missing: number };
  fallbackNotes: string[];
  extras: string[];
  materials: GradedMaterialInfo[];
  anchorsMethod: string;
  /** 降级说明：缺什么、程序怎么处理。 */
  warnings: string[];
  morphTargetCount: number;
  /** 版本 B（只画头部）的准备情况。 */
  headOnly?: { hidden: number; kept: number; chinMeasured: boolean; faceWidthCm: number };
}

const BONES: [VRMHumanBoneName, BoneCheck['level'], string][] = [
  ['head', 'required', '头部转动；黑眼圈等贴片挂在头部'],
  ['neck', 'recommended', '与头部分担转动和低头'],
  ['spine', 'recommended', '上身前倾、呼吸'],
  ['chest', 'recommended', '上身前倾、呼吸'],
  ['upperChest', 'optional', '上身前倾（缺少时由 chest 承担）'],
  ['leftShoulder', 'optional', '肩膀下沉'],
  ['rightShoulder', 'optional', '肩膀下沉'],
  ['leftUpperArm', 'recommended', '手臂姿势'],
  ['rightUpperArm', 'recommended', '手臂姿势'],
  ['leftLowerArm', 'recommended', '手臂姿势'],
  ['rightLowerArm', 'recommended', '手臂姿势'],
  ['leftHand', 'recommended', '手部朝向、手机位置'],
  ['rightHand', 'recommended', '手部朝向、手机位置'],
  ['leftEye', 'optional', '视线；眼部贴片定位'],
  ['rightEye', 'optional', '视线；眼部贴片定位'],
  ['leftIndexProximal', 'optional', '手指弯曲（握拳 / 握手机）'],
  ['rightIndexProximal', 'optional', '手指弯曲（握拳 / 握手机）'],
];

export function buildReport(args: {
  source: RigSource;
  channels: ChannelBinding[];
  expressionNames: string[];
  fallbackNotes: string[];
  extras: Record<string, string | undefined>;
  materials: GradedMaterialInfo[];
  anchorsMethod: string;
  notes: string[];
}): CapabilityReport {
  const { source } = args;
  const bones: BoneCheck[] = BONES.map(([name, level, usage]) => ({
    name,
    level,
    usage,
    present: !!source.humanoid.getRawBoneNode(name),
  }));
  const counts = { direct: 0, fallback: 0, missing: 0 };
  for (const c of args.channels) counts[c.kind]++;
  const warnings: string[] = [...source.notes];
  for (const b of bones) {
    if (b.present) continue;
    if (b.level === 'required') warnings.push(`缺少必需骨骼 ${b.name}：${b.usage}无法工作。`);
    else if (b.level === 'recommended') warnings.push(`缺少骨骼 ${b.name}（${b.usage}），相关动作会被跳过。`);
  }
  if (counts.direct === 0 && counts.fallback === 0) warnings.push('模型没有任何可用的面部表情：面捕只能驱动头部转动。');
  else if (counts.direct < 20) {
    const blinkOk = args.channels.filter((c) => c.channel.startsWith('eyeBlink') && c.kind !== 'missing').length === 2;
    const mouthOk = args.channels.find((c) => c.channel === 'jawOpen')?.kind !== 'missing';
    warnings.push(
      `模型不是 Perfect Sync（ARKit 52 表情直连 ${counts.direct} 个），已启用预设表情回退。` +
        `${blinkOk ? '' : '眨眼不可用。'}${mouthOk ? '' : '张嘴不可用。'}`,
    );
  }
  const missingBrows = args.channels.filter((c) => c.channel.startsWith('brow') && c.kind === 'missing').length;
  if (missingBrows >= 4) warnings.push('眉毛相关表情缺失：用户抬眉 / 皱眉、疲惫阶段的“眉毛下压 / 沮丧眉”不会显示。');
  if (!args.extras.highlightHide) warnings.push('没有“隐藏眼睛高光”的 Morph Target：眼神变暗改由眼睛材质变灰实现。');
  if (!args.channels.find((c) => c.channel === 'tongueOut' && c.kind === 'direct')) warnings.push('没有 tongueOut 表情：Stage 5 不吐舌。');
  const ungraded = args.materials.filter((m) => !m.patched);
  if (ungraded.length) warnings.push(`有 ${ungraded.length} 个材质的着色器无法注入调色代码，去饱和对它们无效：${ungraded.map((m) => m.name).join('、')}`);
  warnings.push(...args.notes);

  let morphTargetCount = 0;
  source.scene.traverse((o) => {
    const d = (o as { morphTargetDictionary?: Record<string, number> }).morphTargetDictionary;
    if (d) morphTargetCount = Math.max(morphTargetCount, Object.keys(d).length);
  });

  return {
    kind: source.kind,
    meta: source.meta,
    bones,
    expressionNames: args.expressionNames,
    channels: args.channels,
    counts,
    fallbackNotes: args.fallbackNotes,
    extras: Object.entries(args.extras)
      .filter(([, v]) => !!v)
      .map(([k, v]) => `${k} → ${v}`),
    materials: args.materials,
    anchorsMethod: args.anchorsMethod,
    warnings,
    morphTargetCount,
  };
}
