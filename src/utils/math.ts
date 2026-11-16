export const DEG = Math.PI / 180;

export function clamp(v: number, lo = 0, hi = 1): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 把 [inLo, inHi] 线性映射到 [0, 1] 并截断。 */
export function remap01(v: number, inLo: number, inHi: number): number {
  if (inHi === inLo) return v >= inHi ? 1 : 0;
  return clamp((v - inLo) / (inHi - inLo));
}

/** 与帧率无关的指数阻尼：每秒向目标靠近的速度由 lambda 决定。 */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/** 平滑的伪随机噪声（几组正弦叠加），用于待机微动，结果大致在 [-1, 1]。 */
export function wobble(t: number, seed = 0): number {
  return (
    Math.sin(t * 0.73 + seed * 1.7) * 0.5 +
    Math.sin(t * 1.31 + seed * 3.1) * 0.3 +
    Math.sin(t * 2.17 + seed * 5.3) * 0.2
  );
}

export function formatTime(sec: number): string {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${String(m).padStart(2, '0')}:${r.toFixed(1).padStart(4, '0')}`;
}
