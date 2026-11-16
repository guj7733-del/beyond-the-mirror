/**
 * ARKit 52 BlendShape 名称。MediaPipe Face Landmarker 输出其中 51 个（没有 tongueOut，
 * 另有一个 _neutral）。本项目把这 52 个名称作为“中间通道”：
 * 面捕写入通道 → 疲惫层叠加 → 再绑定到具体模型的表情。
 */
export const ARKIT_NAMES = [
  'browDownLeft', 'browDownRight', 'browInnerUp', 'browOuterUpLeft', 'browOuterUpRight',
  'cheekPuff', 'cheekSquintLeft', 'cheekSquintRight',
  'eyeBlinkLeft', 'eyeBlinkRight',
  'eyeLookDownLeft', 'eyeLookDownRight', 'eyeLookInLeft', 'eyeLookInRight',
  'eyeLookOutLeft', 'eyeLookOutRight', 'eyeLookUpLeft', 'eyeLookUpRight',
  'eyeSquintLeft', 'eyeSquintRight', 'eyeWideLeft', 'eyeWideRight',
  'jawForward', 'jawLeft', 'jawOpen', 'jawRight',
  'mouthClose', 'mouthDimpleLeft', 'mouthDimpleRight', 'mouthFrownLeft', 'mouthFrownRight',
  'mouthFunnel', 'mouthLeft', 'mouthLowerDownLeft', 'mouthLowerDownRight',
  'mouthPressLeft', 'mouthPressRight', 'mouthPucker', 'mouthRight',
  'mouthRollLower', 'mouthRollUpper', 'mouthShrugLower', 'mouthShrugUpper',
  'mouthSmileLeft', 'mouthSmileRight', 'mouthStretchLeft', 'mouthStretchRight',
  'mouthUpperUpLeft', 'mouthUpperUpRight',
  'noseSneerLeft', 'noseSneerRight',
  'tongueOut',
] as const;

export type ArkitName = (typeof ARKIT_NAMES)[number];
export type Channels = Record<ArkitName, number>;

export function emptyChannels(): Channels {
  const c = {} as Channels;
  for (const n of ARKIT_NAMES) c[n] = 0;
  return c;
}

export function copyChannels(src: Channels, dst: Channels = emptyChannels()): Channels {
  for (const n of ARKIT_NAMES) dst[n] = src[n];
  return dst;
}

const ARKIT_SET = new Set<string>(ARKIT_NAMES);
export function isArkitName(n: string): n is ArkitName {
  return ARKIT_SET.has(n);
}

/** 左右互换：eyeBlinkLeft <-> eyeBlinkRight，jawLeft <-> jawRight。镜像模式下使用。 */
export function mirrorArkitName(n: ArkitName): ArkitName {
  if (n.endsWith('Left')) return (n.slice(0, -4) + 'Right') as ArkitName;
  if (n.endsWith('Right')) return (n.slice(0, -5) + 'Left') as ArkitName;
  return n;
}

/** 名称归一化：去掉大小写、下划线、常见前缀，用于匹配模型里的表情 / Morph Target 名称。 */
export function normalizeExpressionName(name: string): string {
  let s = name.toLowerCase();
  // 常见导出前缀：blendShape1.xxx / ARKit_xxx / bs_xxx
  s = s.replace(/^.*[.:|/]/, '');
  s = s.replace(/^(arkit|bs|blendshape\d*|shape)[_-]?/, '');
  s = s.replace(/[^a-z0-9]/g, '');
  return s;
}
