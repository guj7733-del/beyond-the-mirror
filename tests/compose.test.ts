import { describe, expect, it } from 'vitest';
import { composeChannels, floorBlend } from '../src/core/compose';
import { emptyChannels } from '../src/tracking/arkit';
import { STAGES } from '../src/fatigue/stages';

describe('叠加规则', () => {
  it('floorBlend：疲惫值是下限，用户值映射到剩余区间', () => {
    expect(floorBlend(0.5, 0)).toBeCloseTo(0.5);
    expect(floorBlend(0.5, 1)).toBeCloseTo(1);
    expect(floorBlend(0.5, 0.5)).toBeCloseTo(0.75);
    expect(floorBlend(0, 0.3)).toBeCloseTo(0.3);
  });

  it('各阶段下，用户眨眼仍能让角色完全闭眼，用户张大嘴仍能继续张开', () => {
    for (const st of STAGES) {
      const cap = emptyChannels();
      const out = emptyChannels();
      composeChannels({ capture: cap, presence: 1, autoBlink: 0, fatigue: st.params }, out);
      const restBlink = out.eyeBlinkLeft;
      const restJaw = out.jawOpen;
      expect(restBlink).toBeCloseTo(st.params.eyelidDroop);
      cap.eyeBlinkLeft = 1;
      cap.jawOpen = 1;
      composeChannels({ capture: cap, presence: 1, autoBlink: 0, fatigue: st.params }, out);
      expect(out.eyeBlinkLeft).toBeCloseTo(1);
      expect(out.jawOpen).toBeCloseTo(1);
      expect(out.jawOpen).toBeGreaterThanOrEqual(restJaw);
    }
  });

  it('没有人脸时（presence=0）忽略面捕值，使用自动眨眼', () => {
    const cap = emptyChannels();
    cap.jawOpen = 0.9;
    cap.eyeBlinkLeft = 0.9;
    const out = emptyChannels();
    composeChannels({ capture: cap, presence: 0, autoBlink: 0.6, fatigue: STAGES[0].params }, out);
    expect(out.jawOpen).toBeCloseTo(0);
    expect(out.eyeBlinkLeft).toBeCloseTo(0.6);
  });

  it('疲惫阶段压低用户笑容、叠加嘴角下垂', () => {
    const cap = emptyChannels();
    cap.mouthSmileLeft = 1;
    const out = emptyChannels();
    composeChannels({ capture: cap, presence: 1, autoBlink: 0, fatigue: STAGES[3].params }, out);
    expect(out.mouthSmileLeft).toBeLessThan(0.2);
    expect(out.mouthFrownLeft).toBeGreaterThan(0.4);
  });
});
