/**
 * 实验计时器。以真实时间（performance.now）为准，切换标签页或掉帧都不会让计时变慢。
 */
export class ExperimentClock {
  private accumulated = 0;
  private startedAt: number | null = null;

  constructor(private readonly now: () => number = () => performance.now()) {}

  get running(): boolean {
    return this.startedAt !== null;
  }

  get timeSec(): number {
    const live = this.startedAt === null ? 0 : (this.now() - this.startedAt) / 1000;
    return this.accumulated + live;
  }

  start(): void {
    if (this.startedAt === null) this.startedAt = this.now();
  }

  pause(): void {
    if (this.startedAt !== null) {
      this.accumulated += (this.now() - this.startedAt) / 1000;
      this.startedAt = null;
    }
  }

  toggle(): void {
    if (this.running) this.pause();
    else this.start();
  }

  /** 归零并停止。 */
  reset(): void {
    this.accumulated = 0;
    this.startedAt = null;
  }

  /** 跳到指定时间，保持当前的运行 / 暂停状态。 */
  seek(sec: number): void {
    this.accumulated = Math.max(0, sec);
    if (this.startedAt !== null) this.startedAt = this.now();
  }
}

/** 根据阶段起始时间表计算当前阶段。thresholds[i] 是第 i 级的开始时间。 */
export function stageForTime(t: number, thresholds: readonly number[]): number {
  let stage = 0;
  for (let i = 1; i < thresholds.length; i++) {
    if (t >= thresholds[i]) stage = i;
  }
  return stage;
}

/** 校正用户输入的时间表：第 0 级固定为 0，其余单调不减、非负。 */
export function sanitizeStageTimes(times: readonly number[], count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const raw = Number(times[i]);
    let v = Number.isFinite(raw) ? Math.max(0, raw) : i * 20;
    if (i === 0) v = 0;
    if (i > 0 && v < out[i - 1]) v = out[i - 1];
    out.push(Math.round(v * 10) / 10);
  }
  return out;
}
