import { DEFAULT_STAGE_TIMES } from '../fatigue/stages';
import { DEFAULT_TRACKING, type TrackingSettings } from '../tracking/FaceProcessor';
import { DEFAULT_LAYOUT, type AvatarLayout } from '../render/AvatarRenderer';
import type { BackgroundMode } from '../render/Compositor';

/** A：Avatar 在右下角，半身（第一版）；B：只有头部叠在用户脸上。 */
export type Version = 'A' | 'B';
/** 实验条件：A TikTok + Avatar，B 真人 + Avatar，C 仅 Avatar。 */
export type Condition = 'A' | 'B' | 'C';

/** 版本 B 的头部大小与位置微调。偏移以用户“双眼 → 下巴”的距离为单位。 */
export interface HeadLayout {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export const DEFAULT_HEAD_LAYOUT: HeadLayout = { scale: 0.92, offsetX: 0, offsetY: 0 };

export interface Settings {
  version: Version;
  condition: Condition;
  headLayout: HeadLayout;
  /** 角色是否戴眼镜，两个版本分别设置。 */
  glasses: Record<Version, boolean>;
  /** 各阶段开始时间（秒），第 0 级固定为 0。 */
  stageTimes: number[];
  /** 计时自动进入下一阶段时的过渡时间（秒）。 */
  transitionSec: number;
  /** 手动切换阶段时的过渡时间（秒），0 = 硬切。 */
  manualTransitionSec: number;
  tracking: TrackingSettings;
  layout: AvatarLayout;
  /** 自动大脸构图：根据人脸位置裁切摄像头画面。 */
  autoFrame: boolean;
  cameraZoom: number;
  background: BackgroundMode;
  chrome: boolean;
  modelUrl: string;
  calibration: { yaw: number; pitch: number; roll: number };
  preferGpu: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  version: 'A',
  condition: 'A',
  headLayout: { ...DEFAULT_HEAD_LAYOUT },
  glasses: { A: false, B: true },
  stageTimes: [...DEFAULT_STAGE_TIMES],
  transitionSec: 1.6,
  manualTransitionSec: 0.3,
  tracking: { ...DEFAULT_TRACKING },
  layout: { ...DEFAULT_LAYOUT },
  autoFrame: true,
  cameraZoom: 1,
  background: 'camera',
  chrome: true,
  modelUrl: 'models/avatar.vrm',
  calibration: { yaw: 0, pitch: 0, roll: 0 },
  preferGpu: true,
};

const KEY = 'beyond-the-mirror/settings/v1';

/** 地址栏参数 ?version=B（或 ?v=B）可以直接打开某个版本。 */
export function versionFromUrl(): Version | null {
  try {
    const q = new URLSearchParams(window.location.search);
    const v = (q.get('version') ?? q.get('v') ?? '').trim().toUpperCase();
    return v === 'A' || v === 'B' ? v : null;
  } catch {
    return null;
  }
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    const s = JSON.parse(raw) as Partial<Settings>;
    return {
      ...structuredClone(DEFAULT_SETTINGS),
      ...s,
      tracking: { ...DEFAULT_TRACKING, ...(s.tracking ?? {}) },
      layout: { ...DEFAULT_LAYOUT, ...(s.layout ?? {}) },
      headLayout: { ...DEFAULT_HEAD_LAYOUT, ...(s.headLayout ?? {}) },
      glasses: { ...DEFAULT_SETTINGS.glasses, ...(s.glasses ?? {}) },
      version: s.version === 'B' ? 'B' : 'A',
      condition: s.condition === 'B' || s.condition === 'C' ? s.condition : 'A',
      calibration: { ...DEFAULT_SETTINGS.calibration, ...(s.calibration ?? {}) },
    };
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* 隐私模式等情况下忽略 */
  }
}

export function clearSettings(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
