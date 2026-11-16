/**
 * 六级疲惫状态的视觉参数。
 *
 * 这里只描述“每个阶段要达到什么样子”，不关心模型结构：
 * - 表情类参数（eyelidDroop、mouthOpen……）作用在 ARKit 中间通道上，由 compose.ts 与面捕叠加；
 * - 贴片 / 符号类参数（darkCircle、spiralEyes……）控制 FatigueOverlays 中的透明图层；
 * - 调色类参数（saturation、skinPallor……）控制 MaterialGrader 注入的 shader uniform；
 * - 姿态类参数（headPitch、spinePitch……）作为面捕头部旋转之上的“偏移量”。
 *
 * 研究者如需调整某一级的强度，直接改下面 STAGES 中对应的数值即可。
 */

export interface FatigueParams {
  // —— 表情（0~1）——
  /** 眼皮下垂：作为眨眼值的下限。用户眨眼时仍可完全闭眼。 */
  eyelidDroop: number;
  /** 压低用户“睁大眼”的幅度（疲惫时眼睛睁不大）。 */
  eyeWideSuppress: number;
  /** 眉毛下压（叠加到 browDownLeft/Right）。 */
  browDown: number;
  /** 眉头上扬（叠加到 browInnerUp），与 browDown 组合成“沮丧眉”。 */
  browInnerUp: number;
  /** 嘴巴微张：作为 jawOpen 的下限。 */
  mouthOpen: number;
  /** 嘴角下垂（叠加到 mouthFrownLeft/Right）。 */
  mouthFrown: number;
  /** 额外微笑（Stage 0 的精神状态）。 */
  mouthSmile: number;
  /** 压低用户自己的笑容幅度。 */
  smileSuppress: number;
  /** 吐舌（模型有 tongueOut 时生效）。 */
  tongueOut: number;
  /** 隐藏眼睛高光（VRoid 模型的 Fcl_EYE_Highlight_Hide），让眼神失去光彩。 */
  highlightHide: number;
  /** 眼睛材质变暗变灰。 */
  irisDim: number;

  // —— 贴片 / 漫画符号（0~1 为不透明度）——
  darkCircle: number;
  eyeBag: number;
  foreheadLines: number;
  spiralEyes: number;
  xEyes: number;
  sparkle: number;
  sigh: number;
  swirl: number;
  cloud: number;

  // —— 调色 ——
  /** 头发、衣服等非皮肤材质的饱和度（1 = 原色，0 = 灰）。 */
  saturation: number;
  /** 皮肤饱和度。 */
  skinSaturation: number;
  /** 皮肤向冷灰色偏移的程度（失去红润感）。 */
  skinPallor: number;
  /** 整体亮度倍数。 */
  brightness: number;

  // —— 姿态（角度，度）——
  /** 低头（正值向下）。 */
  headPitch: number;
  /** 歪头（正值向角色右肩）。 */
  headRoll: number;
  /** 上身前倾。 */
  spinePitch: number;
  /** 肩膀下沉。 */
  shoulderDrop: number;
  /** 眩晕摇晃幅度。 */
  sway: number;
  /** 呼吸速度（次/分钟）。 */
  breathRate: number;
  /** 呼吸幅度倍数。 */
  breathDepth: number;

  // —— 手臂姿势权重（会被归一化）——
  poseCheer: number;
  posePhone: number;
  poseSlump: number;
}

export type FatigueKey = keyof FatigueParams;

export interface StageDef {
  id: number;
  key: string;
  nameEn: string;
  nameZh: string;
  /** 默认触发时间（秒），可在控制面板中修改。 */
  defaultStartSec: number;
  summary: string;
  params: FatigueParams;
}

const BASE: FatigueParams = {
  eyelidDroop: 0, eyeWideSuppress: 0, browDown: 0, browInnerUp: 0, mouthOpen: 0, mouthFrown: 0,
  mouthSmile: 0, smileSuppress: 0, tongueOut: 0, highlightHide: 0, irisDim: 0,
  darkCircle: 0, eyeBag: 0, foreheadLines: 0, spiralEyes: 0, xEyes: 0,
  sparkle: 0, sigh: 0, swirl: 0, cloud: 0,
  saturation: 1, skinSaturation: 1, skinPallor: 0, brightness: 1,
  headPitch: 0, headRoll: 0, spinePitch: 0, shoulderDrop: 0, sway: 0, breathRate: 15, breathDepth: 1,
  poseCheer: 0, posePhone: 1, poseSlump: 0,
};

function p(overrides: Partial<FatigueParams>): FatigueParams {
  return { ...BASE, ...overrides };
}

export const STAGES: StageDef[] = [
  {
    id: 0, key: 'normal', nameEn: 'Normal', nameZh: '正常', defaultStartSec: 0,
    summary: '正常肤色、明亮眼睛、自然表情；头部与肩颈直立。版本 A 从一开始就双手举着手机。',
    params: p({ mouthSmile: 0.3, sparkle: 1, posePhone: 1, breathRate: 16 }),
  },
  {
    id: 1, key: 'slightly_tired', nameEn: 'Slightly Tired', nameZh: '轻微疲惫', defaultStartSec: 20,
    summary: '眼皮轻微下垂、浅淡眼下阴影、眉毛略微下压，整体饱和度略降。',
    params: p({
      eyelidDroop: 0.28, eyeWideSuppress: 0.3, browDown: 0.3, smileSuppress: 0.4, highlightHide: 0.25,
      darkCircle: 0.3, eyeBag: 0.1,
      saturation: 0.86, skinSaturation: 0.86, skinPallor: 0.06, brightness: 0.99,
      headPitch: 3, spinePitch: 2, shoulderDrop: 2, breathRate: 14,
    }),
  },
  {
    id: 2, key: 'eye_bags', nameEn: 'Eye Bags', nameZh: '黑眼圈 / 眼袋', defaultStartSec: 40,
    summary: '黑眼圈明显加深、眼袋扩大、眼睛疲惫、嘴巴略微张开，肤色失去红润感。',
    params: p({
      eyelidDroop: 0.42, eyeWideSuppress: 0.6, browDown: 0.3, browInnerUp: 0.15, mouthOpen: 0.2, mouthFrown: 0.15,
      smileSuppress: 0.7, highlightHide: 0.6, irisDim: 0.15,
      darkCircle: 0.7, eyeBag: 0.75,
      saturation: 0.74, skinSaturation: 0.6, skinPallor: 0.22, brightness: 0.97,
      headPitch: 6, spinePitch: 4, shoulderDrop: 4, breathRate: 13,
    }),
  },
  {
    id: 3, key: 'depressed', nameEn: 'Depressed', nameZh: '低落', defaultStartSec: 60,
    summary: '黑眼圈进一步加深、眼睛半闭、眉毛沮丧、头部明显低垂、肩膀下沉，整体去饱和。',
    params: p({
      eyelidDroop: 0.56, eyeWideSuppress: 0.85, browDown: 0.1, browInnerUp: 0.65, mouthOpen: 0.12, mouthFrown: 0.55,
      smileSuppress: 0.9, highlightHide: 1, irisDim: 0.3,
      darkCircle: 0.85, eyeBag: 0.9, foreheadLines: 0.85, sigh: 1,
      saturation: 0.5, skinSaturation: 0.35, skinPallor: 0.42, brightness: 0.93,
      headPitch: 14, headRoll: 3, spinePitch: 9, shoulderDrop: 9, breathRate: 11, breathDepth: 1.3,
    }),
  },
  {
    id: 4, key: 'dizzy', nameEn: 'Dizzy', nameZh: '眩晕', defaultStartSec: 80,
    summary: '面部灰暗、眼睛出现旋转或螺旋效果、额头出现压力线，头部和肩颈更加松垮。',
    params: p({
      eyelidDroop: 0.3, eyeWideSuppress: 1, browDown: 0, browInnerUp: 0.55, mouthOpen: 0.3, mouthFrown: 0.35,
      smileSuppress: 1, highlightHide: 1, irisDim: 0.4,
      darkCircle: 0.9, eyeBag: 0.95, foreheadLines: 1, spiralEyes: 1, swirl: 1,
      saturation: 0.36, skinSaturation: 0.12, skinPallor: 0.66, brightness: 0.89,
      headPitch: 12, spinePitch: 11, shoulderDrop: 11, sway: 6, breathRate: 12, breathDepth: 1.2,
    }),
  },
  {
    id: 5, key: 'extremely_exhausted', nameEn: 'Extremely Exhausted', nameZh: '极度疲惫', defaultStartSec: 100,
    summary: '整体接近灰色、黑眼圈最明显、闭眼或漫画式失神、嘴巴微张、头部明显下垂、肩膀塌下。',
    params: p({
      eyelidDroop: 0.96, eyeWideSuppress: 1, browInnerUp: 0.45, mouthOpen: 0.32, mouthFrown: 0.2,
      smileSuppress: 1, tongueOut: 0.65, highlightHide: 1, irisDim: 0.5,
      darkCircle: 1, eyeBag: 1, foreheadLines: 0.55, xEyes: 1, cloud: 1,
      saturation: 0.1, skinSaturation: 0.04, skinPallor: 0.85, brightness: 0.84,
      headPitch: 15, headRoll: 13, spinePitch: 16, shoulderDrop: 14, sway: 1.5, breathRate: 9, breathDepth: 1.6,
      poseCheer: 0, posePhone: 0, poseSlump: 1,
    }),
  },
];

export const STAGE_COUNT = STAGES.length;
export const DEFAULT_STAGE_TIMES = STAGES.map((s) => s.defaultStartSec);
export const FATIGUE_KEYS = Object.keys(BASE) as FatigueKey[];

export function cloneParams(src: FatigueParams): FatigueParams {
  return { ...src };
}
