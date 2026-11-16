import { FATIGUE_KEYS, STAGES, cloneParams, type FatigueParams } from './stages';

/**
 * 疲惫状态控制器：只负责“当前应该处于哪个阶段、参数过渡到哪里”。
 * 它不读取摄像头，也不接触模型。
 */
export class FatigueController {
  readonly current: FatigueParams = cloneParams(STAGES[0].params);
  private target = 0;
  /** 阶段切换的过渡时间（秒）。 */
  transitionSec = 1.6;

  get targetStage(): number {
    return this.target;
  }

  setStage(stage: number, instant = false): void {
    const s = Math.max(0, Math.min(STAGES.length - 1, Math.round(stage)));
    this.target = s;
    if (instant) Object.assign(this.current, STAGES[s].params);
  }

  /** 每帧调用。指数逼近目标参数，约 transitionSec 秒后到达 99%。 */
  update(dt: number): FatigueParams {
    const goal = STAGES[this.target].params;
    const k = this.transitionSec <= 0.01 ? 1 : 1 - Math.exp((-dt * 4.6) / this.transitionSec);
    for (const key of FATIGUE_KEYS) {
      const cur = this.current[key];
      this.current[key] = cur + (goal[key] - cur) * k;
    }
    return this.current;
  }
}
