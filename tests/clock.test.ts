import { describe, expect, it } from 'vitest';
import { ExperimentClock, sanitizeStageTimes, stageForTime } from '../src/fatigue/ExperimentClock';
import { DEFAULT_STAGE_TIMES } from '../src/fatigue/stages';

describe('ExperimentClock', () => {
  it('计时、暂停、继续、跳转、重置', () => {
    let now = 0;
    const c = new ExperimentClock(() => now);
    expect(c.running).toBe(false);
    c.start();
    now = 5000;
    expect(c.timeSec).toBeCloseTo(5);
    c.pause();
    now = 9000;
    expect(c.timeSec).toBeCloseTo(5);
    c.start();
    now = 10000;
    expect(c.timeSec).toBeCloseTo(6);
    c.seek(42);
    expect(c.timeSec).toBeCloseTo(42);
    now = 11000;
    expect(c.timeSec).toBeCloseTo(43);
    c.reset();
    expect(c.timeSec).toBe(0);
    expect(c.running).toBe(false);
  });

  it('结束保留本轮用时，再次开始时从零计时', () => {
    let now = 0;
    const clock = new ExperimentClock(() => now);
    expect(clock.status).toBe('idle');
    clock.start();
    now = 2500;
    clock.pause();
    expect(clock.status).toBe('paused');
    clock.end();
    now = 9000;
    expect(clock.status).toBe('ended');
    expect(clock.timeSec).toBe(2.5);
    clock.start();
    expect(clock.status).toBe('running');
    expect(clock.timeSec).toBe(0);
  });
});

describe('stageForTime', () => {
  it('默认时间表 0/20/40/60/80/100 秒', () => {
    expect(DEFAULT_STAGE_TIMES).toEqual([0, 20, 40, 60, 80, 100]);
    expect(stageForTime(0, DEFAULT_STAGE_TIMES)).toBe(0);
    expect(stageForTime(19.9, DEFAULT_STAGE_TIMES)).toBe(0);
    expect(stageForTime(20, DEFAULT_STAGE_TIMES)).toBe(1);
    expect(stageForTime(59.99, DEFAULT_STAGE_TIMES)).toBe(2);
    expect(stageForTime(80, DEFAULT_STAGE_TIMES)).toBe(4);
    expect(stageForTime(1000, DEFAULT_STAGE_TIMES)).toBe(5);
  });
  it('相同时间点时取更高阶段', () => {
    expect(stageForTime(10, [0, 10, 10, 30, 40, 50])).toBe(2);
  });
});

describe('sanitizeStageTimes', () => {
  it('第 0 级固定为 0，保证单调不减，非法值有兜底', () => {
    expect(sanitizeStageTimes([5, 30, 10, -4, Number.NaN, 90], 6)).toEqual([0, 30, 30, 30, 80, 90]);
    expect(sanitizeStageTimes([0, 12.34], 3)).toEqual([0, 12.3, 40]);
  });
});
