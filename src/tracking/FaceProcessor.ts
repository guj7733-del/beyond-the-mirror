import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { ARKIT_NAMES, emptyChannels, isArkitName, mirrorArkitName, type Channels } from './arkit';
import { OneEuroFilter } from './OneEuroFilter';
import type { FacePoints, RawFace } from './FaceTracker';
import { clamp, lerp, remap01 } from '../utils/math';

export interface TrackingSettings {
  /** 镜像：用户闭左眼 → 角色屏幕同侧的眼睛闭上（像照镜子）。 */
  mirror: boolean;
  /** 眨眼映射区间：低于 low 视为睁眼，高于 high 视为闭眼。 */
  blinkLow: number;
  blinkHigh: number;
  /** 双眼差异较小时同步两眼，减少单眼抖动。 */
  linkBlink: boolean;
  /** 张嘴增益。 */
  jawGain: number;
  /** 头部转动增益。 */
  headGain: number;
  /** 平滑强度 0~1（越大越稳、延迟越高）。 */
  smoothing: number;
}

export const DEFAULT_TRACKING: TrackingSettings = {
  mirror: true,
  blinkLow: 0.12,
  blinkHigh: 0.55,
  linkBlink: true,
  jawGain: 1.3,
  headGain: 1.0,
  smoothing: 0.5,
};

export interface HeadPose {
  /** 弧度，角色空间：yaw 正值 = 角色向自己的左边转；pitch 正值 = 低头；roll 正值 = 向角色右肩歪。 */
  yaw: number;
  pitch: number;
  roll: number;
}

export interface FaceFrame {
  present: boolean;
  channels: Channels;
  head: HeadPose;
  /** MediaPipe 原始分数（调试用，未镜像）。 */
  raw: Record<string, number>;
  /** 人脸包围盒（归一化，未镜像），用于自动构图。 */
  box: RawFace['box'];
  /** 平滑后的关键点（归一化，未镜像），用于把头部叠到脸上。 */
  points: FacePoints | null;
  lastSeenMs: number;
}

const DEG = 180 / Math.PI;
const LIMIT = { yaw: 55, pitch: 40, roll: 40 };

/**
 * 把 MediaPipe 原始输出整理成角色可直接使用的数据：
 * 左右镜像 → 眨眼 / 张嘴重映射 → One Euro 平滑 → 头部姿态（含中性位校准）。
 */
export class FaceProcessor {
  settings: TrackingSettings = { ...DEFAULT_TRACKING };
  readonly frame: FaceFrame = {
    present: false,
    channels: emptyChannels(),
    head: { yaw: 0, pitch: 0, roll: 0 },
    raw: {},
    box: null,
    points: null,
    lastSeenMs: -Infinity,
  };

  private readonly filters = new Map<string, OneEuroFilter>();
  private readonly headFilters = [new OneEuroFilter(), new OneEuroFilter(), new OneEuroFilter()];
  /** eyeMid、chin、forehead、cheekL、cheekR 各 xyz */
  private readonly pointFilters = Array.from({ length: 15 }, () => new OneEuroFilter());
  /** 用户闭嘴时“双眼 → 下巴”与脸宽之比（慢速更新），用来去掉张嘴对下巴位置的影响。 */
  restChinRatio = 0.85;
  /** 视频宽高比。关键点 x、z 以画面宽度归一化，y 以高度归一化，算距离前要统一单位。 */
  aspect = 16 / 9;
  private neutral = { yaw: 0, pitch: 0, roll: 0 };
  private lastPoseDeg = { yaw: 0, pitch: 0, roll: 0 };
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly pos = new Vector3();
  private readonly scl = new Vector3();
  private readonly e = new Euler();

  constructor() {
    for (const n of ARKIT_NAMES) this.filters.set(n, new OneEuroFilter());
    this.applySmoothing();
  }

  update(settings: Partial<TrackingSettings>): void {
    Object.assign(this.settings, settings);
    this.applySmoothing();
  }

  private applySmoothing(): void {
    const s = clamp(this.settings.smoothing);
    for (const f of this.filters.values()) {
      f.minCutoff = lerp(4.0, 0.7, s);
      f.beta = lerp(2.0, 0.6, s);
    }
    for (const f of this.headFilters) {
      f.minCutoff = lerp(2.5, 0.35, s);
      f.beta = lerp(0.08, 0.025, s);
    }
    // 关键点是归一化坐标（0~1），速度数值小，beta 相应取大
    for (const f of this.pointFilters) {
      f.minCutoff = lerp(3.0, 0.6, s);
      f.beta = lerp(40, 10, s);
    }
  }

  /** 把当前头部姿态记为“正脸”。摄像头放得偏高或偏低时使用。 */
  calibrate(): void {
    this.neutral = { ...this.lastPoseDeg };
  }

  resetCalibration(): void {
    this.neutral = { yaw: 0, pitch: 0, roll: 0 };
  }

  get calibration(): { yaw: number; pitch: number; roll: number } {
    return { ...this.neutral };
  }

  setCalibration(c: { yaw: number; pitch: number; roll: number }): void {
    this.neutral = { ...c };
  }

  process(raw: RawFace | null, nowMs: number): FaceFrame {
    const fr = this.frame;
    if (!raw) {
      fr.present = false;
      return fr;
    }
    const t = nowMs / 1000;
    const s = this.settings;
    fr.present = true;
    fr.lastSeenMs = nowMs;
    fr.raw = raw.blendshapes;
    fr.box = raw.box;
    if (raw.points) {
      const P = raw.points;
      const src = [...P.eyeMid, ...P.chin, ...P.forehead, ...P.cheekL, ...P.cheekR];
      const v = src.map((x, i) => this.pointFilters[i].filter(x, t));
      fr.points = {
        eyeMid: [v[0], v[1], v[2]],
        chin: [v[3], v[4], v[5]],
        forehead: [v[6], v[7], v[8]],
        cheekL: [v[9], v[10], v[11]],
        cheekR: [v[12], v[13], v[14]],
      };
      // 闭嘴时更新“下巴比例”（时间常数约 2 秒），张嘴时保持不变
      const jaw = raw.blendshapes.jawOpen ?? 0;
      if (jaw < 0.12) {
        const d = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], (a[1] - b[1]) / this.aspect, a[2] - b[2]);
        const width = d(P.cheekL, P.cheekR);
        if (width > 1e-4) {
          const ratio = d(P.eyeMid, P.chin) / width;
          if (ratio > 0.4 && ratio < 1.6) this.restChinRatio += (ratio - this.restChinRatio) * Math.min(1, 1 / 60);
        }
      }
    }

    // 1) 镜像 + 重映射
    const tmp = emptyChannels();
    for (const [name, score] of Object.entries(raw.blendshapes)) {
      if (!isArkitName(name)) continue;
      const target = s.mirror ? mirrorArkitName(name) : name;
      tmp[target] = score;
    }
    let bl = remap01(tmp.eyeBlinkLeft, s.blinkLow, s.blinkHigh);
    let br = remap01(tmp.eyeBlinkRight, s.blinkLow, s.blinkHigh);
    if (s.linkBlink && Math.abs(bl - br) < 0.3) {
      const avg = (bl + br) / 2;
      bl = avg;
      br = avg;
    }
    tmp.eyeBlinkLeft = bl;
    tmp.eyeBlinkRight = br;
    tmp.jawOpen = clamp(tmp.jawOpen * s.jawGain);

    // 2) 平滑
    for (const n of ARKIT_NAMES) {
      fr.channels[n] = clamp(this.filters.get(n)!.filter(tmp[n], t));
    }

    // 3) 头部姿态
    if (raw.matrix && raw.matrix.length === 16) {
      this.m.fromArray(raw.matrix);
      this.m.decompose(this.pos, this.q, this.scl);
      this.e.setFromQuaternion(this.q, 'YXZ');
      let yaw = this.e.y * DEG;
      const pitch = this.e.x * DEG;
      let roll = this.e.z * DEG;
      if (s.mirror) {
        yaw = -yaw;
        roll = -roll;
      }
      this.lastPoseDeg = { yaw, pitch, roll };
      const g = s.headGain;
      const y = clampDeg((yaw - this.neutral.yaw) * g, LIMIT.yaw);
      const p = clampDeg((pitch - this.neutral.pitch) * g, LIMIT.pitch);
      const r = clampDeg((roll - this.neutral.roll) * g, LIMIT.roll);
      fr.head.yaw = this.headFilters[0].filter(y, t) / DEG;
      fr.head.pitch = this.headFilters[1].filter(p, t) / DEG;
      fr.head.roll = this.headFilters[2].filter(r, t) / DEG;
    }
    return fr;
  }

  /** 人脸丢失较久后重置滤波器，避免重新出现时从旧值慢慢滑过来。 */
  resetFilters(): void {
    for (const f of this.filters.values()) f.reset();
    for (const f of this.headFilters) f.reset();
    for (const f of this.pointFilters) f.reset();
  }
}

function clampDeg(v: number, lim: number): number {
  return v < -lim ? -lim : v > lim ? lim : v;
}
