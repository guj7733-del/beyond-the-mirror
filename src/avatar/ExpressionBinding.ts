import { Mesh, type Object3D } from 'three';
import { VRMExpression, VRMExpressionMorphTargetBind, type VRMExpressionManager, type VRMLookAt } from '@pixiv/three-vrm';
import { ARKIT_NAMES, normalizeExpressionName, type ArkitName, type Channels } from '../tracking/arkit';
import { clamp } from '../utils/math';

export type BindingKind = 'direct' | 'fallback' | 'missing';

export interface ChannelBinding {
  channel: ArkitName;
  kind: BindingKind;
  /** 直连时为模型里的表情名；回退时为预设表情名（可能多个）。 */
  targets: string[];
}

interface FallbackRule {
  /** 预设表情名（VRM 1.0 命名）。 */
  preset: string;
  /** 这些通道都没有直连时才启用该规则。 */
  uses: ArkitName[];
  value: (c: Channels) => number;
  note: string;
}

const avg = (a: number, b: number) => (a + b) / 2;

/**
 * 回退规则：模型缺少 ARKit 同名表情时，用 VRM 标准预设表情近似。
 * 预设表情往往同时改变整张脸，所以权重都偏保守。
 */
const FALLBACK_RULES: FallbackRule[] = [
  { preset: 'blinkLeft', uses: ['eyeBlinkLeft'], value: (c) => c.eyeBlinkLeft, note: '左眼眨眼 → blinkLeft' },
  { preset: 'blinkRight', uses: ['eyeBlinkRight'], value: (c) => c.eyeBlinkRight, note: '右眼眨眼 → blinkRight' },
  { preset: 'aa', uses: ['jawOpen'], value: (c) => c.jawOpen * (1 - 0.5 * c.mouthFunnel), note: '张嘴 → aa' },
  { preset: 'oh', uses: ['mouthFunnel'], value: (c) => clamp(c.mouthFunnel * 1.2 - 0.1), note: '嘴型 O → oh' },
  { preset: 'ou', uses: ['mouthPucker'], value: (c) => clamp(c.mouthPucker * 1.1 - 0.15), note: '嘟嘴 → ou' },
  { preset: 'ee', uses: ['mouthStretchLeft', 'mouthStretchRight'], value: (c) => clamp(avg(c.mouthStretchLeft, c.mouthStretchRight) * 1.2 - 0.1), note: '咧嘴 → ee' },
  { preset: 'relaxed', uses: ['mouthSmileLeft', 'mouthSmileRight'], value: (c) => clamp(avg(c.mouthSmileLeft, c.mouthSmileRight) * 1.1), note: '微笑 → relaxed' },
  { preset: 'sad', uses: ['browInnerUp', 'mouthFrownLeft', 'mouthFrownRight'], value: (c) => clamp(Math.max(c.browInnerUp - avg(c.browOuterUpLeft, c.browOuterUpRight) * 0.6, avg(c.mouthFrownLeft, c.mouthFrownRight)) * 0.8), note: '眉头上扬 / 嘴角下垂 → sad' },
  { preset: 'angry', uses: ['browDownLeft', 'browDownRight'], value: (c) => clamp(avg(c.browDownLeft, c.browDownRight) * 0.55), note: '皱眉 → angry（弱）' },
  { preset: 'surprised', uses: ['browOuterUpLeft', 'browOuterUpRight'], value: (c) => clamp(Math.min(avg(c.browOuterUpLeft, c.browOuterUpRight), c.browInnerUp) * 0.8 + avg(c.eyeWideLeft, c.eyeWideRight) * 0.3), note: '抬眉 / 睁大眼 → surprised' },
];

/** 预设表情的别名（VRM 0.x 名称、常见大小写）。 */
const PRESET_ALIASES: Record<string, string[]> = {
  blinkLeft: ['blinkLeft', 'blink_l', 'blinkl'],
  blinkRight: ['blinkRight', 'blink_r', 'blinkr'],
  blink: ['blink'],
  aa: ['aa', 'a'],
  ih: ['ih', 'i'],
  ou: ['ou', 'u'],
  ee: ['ee', 'e'],
  oh: ['oh', 'o'],
  happy: ['happy', 'joy'],
  relaxed: ['relaxed', 'fun'],
  sad: ['sad', 'sorrow'],
  angry: ['angry'],
  surprised: ['surprised'],
};

/** 额外的“疲惫专用”表情：在模型的 Morph Target 中按名称查找。 */
const EXTRA_MORPHS: Record<'highlightHide', RegExp> = {
  highlightHide: /^(fcl_eye_highlight_hide|eye_?highlight_?hide|highlight_?hide)$/i,
};

export interface ExtraValues {
  highlightHide: number;
}

/**
 * ARKit 中间通道 → 模型表情。
 * 1. 模型有同名表情（Perfect Sync）：直连；
 * 2. 没有：用 VRM 预设表情近似（见 FALLBACK_RULES）；
 * 3. 预设也没有：记为缺失，该通道被忽略。
 * 视线（eyeLook*）缺失时改用 VRM LookAt 转动眼球。
 */
export class ExpressionBinding {
  readonly channels: ChannelBinding[] = [];
  readonly fallbackNotes: string[] = [];
  readonly extras: Partial<Record<keyof ExtraValues, string>> = {};
  private readonly direct: [ArkitName, string][] = [];
  private readonly rules: [FallbackRule, string][] = [];
  private readonly blinkBoth: string | null = null;
  private readonly useLookAt: boolean;
  readonly expressionNames: string[];

  constructor(
    private readonly manager: VRMExpressionManager,
    private readonly lookAt: VRMLookAt | null,
    scene: Object3D,
  ) {
    this.expressionNames = manager.expressions.map((e) => e.expressionName);
    const index = new Map<string, string>();
    for (const name of this.expressionNames) index.set(normalizeExpressionName(name), name);

    const directSet = new Set<ArkitName>();
    for (const ch of ARKIT_NAMES) {
      const hit = index.get(normalizeExpressionName(ch));
      if (hit) {
        this.direct.push([ch, hit]);
        directSet.add(ch);
      }
    }

    const findPreset = (preset: string): string | null => {
      for (const alias of PRESET_ALIASES[preset] ?? [preset]) {
        const hit = index.get(normalizeExpressionName(alias));
        if (hit) return hit;
      }
      return null;
    };

    const fallbackTargets = new Map<ArkitName, string[]>();
    for (const rule of FALLBACK_RULES) {
      if (rule.uses.every((u) => directSet.has(u))) continue;
      const target = findPreset(rule.preset);
      if (!target) continue;
      this.rules.push([rule, target]);
      this.fallbackNotes.push(`${rule.note}（模型表情：${target}）`);
      for (const u of rule.uses) if (!directSet.has(u)) fallbackTargets.set(u, [...(fallbackTargets.get(u) ?? []), target]);
    }
    // 只有双眼一起眨的 blink 预设
    const hasSideBlink = this.rules.some(([r]) => r.preset === 'blinkLeft' || r.preset === 'blinkRight') ||
      (directSet.has('eyeBlinkLeft') && directSet.has('eyeBlinkRight'));
    if (!hasSideBlink) {
      const both = findPreset('blink');
      if (both) {
        this.blinkBoth = both;
        this.fallbackNotes.push(`模型只有双眼眨眼表情，左右眼取平均 → ${both}`);
        for (const u of ['eyeBlinkLeft', 'eyeBlinkRight'] as ArkitName[]) fallbackTargets.set(u, [both]);
      }
    }

    const lookChannels = ARKIT_NAMES.filter((n) => n.startsWith('eyeLook'));
    this.useLookAt = !!lookAt && lookChannels.some((n) => !directSet.has(n));
    if (this.useLookAt) {
      this.fallbackNotes.push('视线 eyeLook* → VRM LookAt（转动眼球骨骼或视线表情）');
      for (const n of lookChannels) if (!directSet.has(n)) fallbackTargets.set(n, ['LookAt']);
    }

    for (const ch of ARKIT_NAMES) {
      const d = this.direct.find(([c]) => c === ch);
      if (d) this.channels.push({ channel: ch, kind: 'direct', targets: [d[1]] });
      else if (fallbackTargets.has(ch)) this.channels.push({ channel: ch, kind: 'fallback', targets: fallbackTargets.get(ch)! });
      else this.channels.push({ channel: ch, kind: 'missing', targets: [] });
    }

    this.registerExtraMorphs(scene);
  }

  /** 查找模型里的“隐藏高光”等 Morph Target，注册成额外表情，供疲惫层使用。 */
  private registerExtraMorphs(scene: Object3D): void {
    for (const [key, re] of Object.entries(EXTRA_MORPHS) as [keyof ExtraValues, RegExp][]) {
      const prims: Mesh[] = [];
      let index = -1;
      scene.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh || !mesh.morphTargetDictionary) return;
        for (const [name, i] of Object.entries(mesh.morphTargetDictionary)) {
          if (re.test(name)) {
            prims.push(mesh);
            index = i;
            break;
          }
        }
      });
      if (prims.length && index >= 0) {
        const name = `bm_${key}`;
        if (this.manager.getExpression(name)) {
          this.extras[key] = name;
          continue;
        }
        const exp = new VRMExpression(name);
        // 同一个 glTF mesh 拆分出的各 primitive 共享同一套 morph 索引
        const byIndex = new Map<number, Mesh[]>();
        for (const p of prims) {
          const i = Object.entries(p.morphTargetDictionary!).find(([n]) => re.test(n))![1];
          byIndex.set(i, [...(byIndex.get(i) ?? []), p]);
        }
        for (const [i, meshes] of byIndex) exp.addBind(new VRMExpressionMorphTargetBind({ primitives: meshes, index: i, weight: 1 }));
        this.manager.registerExpression(exp);
        this.extras[key] = name;
      }
    }
  }

  get directCount(): number {
    return this.channels.filter((c) => c.kind === 'direct').length;
  }

  apply(c: Channels, extra: ExtraValues): void {
    const m = this.manager;
    for (const [ch, name] of this.direct) m.setValue(name, c[ch]);
    const acc = new Map<string, number>();
    for (const [rule, target] of this.rules) acc.set(target, Math.max(acc.get(target) ?? 0, rule.value(c)));
    for (const [target, value] of acc) m.setValue(target, clamp(value));
    if (this.blinkBoth) m.setValue(this.blinkBoth, clamp((c.eyeBlinkLeft + c.eyeBlinkRight) / 2));
    if (this.extras.highlightHide) m.setValue(this.extras.highlightHide, clamp(extra.highlightHide));

    if (this.useLookAt && this.lookAt) {
      // 角色左侧为正：左眼向外看 + 右眼向内看
      const horiz = ((c.eyeLookOutLeft - c.eyeLookInLeft) + (c.eyeLookInRight - c.eyeLookOutRight)) / 2;
      const vert = (c.eyeLookUpLeft + c.eyeLookUpRight - c.eyeLookDownLeft - c.eyeLookDownRight) / 2;
      this.lookAt.yaw = horiz * 18;
      this.lookAt.pitch = vert * 12;
    }
  }
}
