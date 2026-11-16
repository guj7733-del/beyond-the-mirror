import { describe, expect, it } from 'vitest';
import { FatigueController } from '../src/fatigue/FatigueController';
import { STAGES } from '../src/fatigue/stages';

describe('六级疲惫参数', () => {
  const p = STAGES.map((s) => s.params);
  it('共 6 级，名称与需求文档一致', () => {
    expect(STAGES.map((s) => s.nameEn)).toEqual(['Normal', 'Slightly Tired', 'Eye Bags', 'Depressed', 'Dizzy', 'Extremely Exhausted']);
  });
  it('整体趋势：饱和度递减、黑眼圈递增、Stage 5 最灰且黑眼圈最重', () => {
    for (let i = 1; i < 6; i++) {
      expect(p[i].saturation).toBeLessThanOrEqual(p[i - 1].saturation);
      expect(p[i].skinSaturation).toBeLessThanOrEqual(p[i - 1].skinSaturation);
      expect(p[i].darkCircle).toBeGreaterThanOrEqual(p[i - 1].darkCircle);
    }
    expect(p[5].saturation).toBe(Math.min(...p.map((x) => x.saturation)));
    expect(p[5].darkCircle).toBe(1);
  });
  it('版本 A 从 Stage 0 起就举着手机（修改意见 2）', () => {
    expect(p[0].posePhone).toBe(1);
    expect(p[0].poseCheer).toBe(0);
    for (let i = 0; i < 5; i++) expect(p[i].posePhone).toBe(1);
  });

  it('关键视觉特征出现在对应阶段', () => {
    expect(p[0].darkCircle).toBe(0);
    expect(p[2].mouthOpen).toBeGreaterThan(0);
    expect(p[3].headPitch).toBeGreaterThan(p[1].headPitch);
    expect(p[4].spiralEyes).toBe(1);
    expect(p[4].foreheadLines).toBeGreaterThan(0.5);
    expect(p[5].xEyes).toBe(1);
    expect(p[5].eyelidDroop).toBeGreaterThan(0.9);
  });
});

describe('FatigueController', () => {
  it('过渡时间内逼近目标；instant 立即到位', () => {
    const f = new FatigueController();
    f.transitionSec = 1;
    f.setStage(5);
    for (let i = 0; i < 60; i++) f.update(1 / 60);
    expect(f.current.saturation).toBeCloseTo(STAGES[5].params.saturation, 1);
    f.setStage(0, true);
    expect(f.current.saturation).toBe(1);
    expect(f.current.darkCircle).toBe(0);
  });
});
