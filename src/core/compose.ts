import { ARKIT_NAMES, type Channels } from '../tracking/arkit';
import type { FatigueParams } from '../fatigue/stages';
import { clamp } from '../utils/math';

export interface ComposeInput {
  /** 已经过镜像、校准、平滑的面捕通道；没有人脸时为 null。 */
  capture: Channels | null;
  /** 面捕可信度 0~1。人脸丢失后逐渐降到 0，角色平滑回到中性表情。 */
  presence: number;
  /** 无面捕时的自动眨眼值 0~1。 */
  autoBlink: number;
  fatigue: FatigueParams;
}

/**
 * 面捕 + 疲惫的叠加规则（见 docs/疲惫动画实现说明.md「叠加原则」）。
 *
 * 核心思路：疲惫层只设置“下限”或“偏移”，不直接覆盖面捕值。
 *   眨眼  final = droop + (1 - droop) × 用户眨眼
 *   张嘴  final = floor + (1 - floor) × 用户张嘴
 * 所以眼皮下垂时，用户眨眼仍能让角色完全闭眼；嘴巴微张时，用户张大嘴仍能继续张开。
 */
export function composeChannels(input: ComposeInput, out: Channels): Channels {
  const { capture, presence, autoBlink, fatigue: f } = input;
  const w = clamp(presence);

  for (const n of ARKIT_NAMES) out[n] = capture ? capture[n] * w : 0;

  const idleBlink = autoBlink * (1 - w);
  const blinkL = Math.max(out.eyeBlinkLeft, idleBlink);
  const blinkR = Math.max(out.eyeBlinkRight, idleBlink);
  out.eyeBlinkLeft = floorBlend(f.eyelidDroop, blinkL);
  out.eyeBlinkRight = floorBlend(f.eyelidDroop, blinkR);

  const wideKeep = 1 - clamp(f.eyeWideSuppress);
  out.eyeWideLeft *= wideKeep;
  out.eyeWideRight *= wideKeep;

  out.jawOpen = floorBlend(f.mouthOpen, out.jawOpen);
  out.mouthClose *= 1 - clamp(f.mouthOpen * 2);

  out.browDownLeft = clamp(out.browDownLeft + f.browDown);
  out.browDownRight = clamp(out.browDownRight + f.browDown);
  out.browInnerUp = clamp(out.browInnerUp + f.browInnerUp);

  const smileKeep = 1 - clamp(f.smileSuppress);
  out.mouthSmileLeft = clamp(out.mouthSmileLeft * smileKeep + f.mouthSmile);
  out.mouthSmileRight = clamp(out.mouthSmileRight * smileKeep + f.mouthSmile);
  out.mouthFrownLeft = clamp(out.mouthFrownLeft + f.mouthFrown);
  out.mouthFrownRight = clamp(out.mouthFrownRight + f.mouthFrown);

  out.tongueOut = clamp(out.tongueOut + f.tongueOut);
  return out;
}

/** 以 floor 为下限、把 value 映射到剩余区间。 */
export function floorBlend(floor: number, value: number): number {
  const fl = clamp(floor);
  return fl + (1 - fl) * clamp(value);
}
