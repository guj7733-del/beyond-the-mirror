/**
 * One Euro Filter（Casiez et al., CHI 2012）。
 * 静止时截止频率低（去抖），快速运动时截止频率升高（低延迟）。
 */
export class OneEuroFilter {
  private x: number | null = null;
  private dx = 0;
  private tPrev = 0;

  constructor(
    public minCutoff = 1.0,
    public beta = 0.0,
    public dCutoff = 1.0,
  ) {}

  reset(): void {
    this.x = null;
    this.dx = 0;
  }

  filter(value: number, tSec: number): number {
    if (this.x === null) {
      this.x = value;
      this.dx = 0;
      this.tPrev = tSec;
      return value;
    }
    const dt = Math.max(1e-4, tSec - this.tPrev);
    this.tPrev = tSec;
    const ad = smoothingAlpha(dt, this.dCutoff);
    const dxRaw = (value - this.x) / dt;
    this.dx += ad * (dxRaw - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    const a = smoothingAlpha(dt, cutoff);
    this.x += a * (value - this.x);
    return this.x;
  }
}

function smoothingAlpha(dt: number, cutoff: number): number {
  const tau = 1 / (2 * Math.PI * Math.max(1e-3, cutoff));
  return 1 / (1 + tau / dt);
}
