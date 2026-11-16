import { describe, expect, it } from 'vitest';
import { OneEuroFilter } from '../src/tracking/OneEuroFilter';

describe('OneEuroFilter', () => {
  it('恒定输入保持不变', () => {
    const f = new OneEuroFilter(1, 0.5);
    for (let i = 0; i < 30; i++) expect(f.filter(0.4, i / 30)).toBeCloseTo(0.4);
  });

  it('降低静止时的抖动', () => {
    const f = new OneEuroFilter(1, 0.5);
    let rawVar = 0;
    let outVar = 0;
    let prevRaw = 0.5;
    let prevOut = 0.5;
    for (let i = 0; i < 300; i++) {
      const raw = 0.5 + (i % 2 ? 0.05 : -0.05);
      const out = f.filter(raw, i / 30);
      if (i > 30) {
        rawVar += (raw - prevRaw) ** 2;
        outVar += (out - prevOut) ** 2;
      }
      prevRaw = raw;
      prevOut = out;
    }
    expect(outVar).toBeLessThan(rawVar * 0.2);
  });

  it('阶跃输入在约 0.3 秒内基本跟上（眨眼不能拖太久）', () => {
    const f = new OneEuroFilter(1.5, 1.3);
    f.filter(0, 0);
    let v = 0;
    for (let i = 1; i <= 10; i++) v = f.filter(1, i / 30);
    expect(v).toBeGreaterThan(0.85);
  });
});
