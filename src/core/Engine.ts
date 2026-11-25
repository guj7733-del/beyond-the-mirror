import { Store } from './store';
import { DEFAULT_SETTINGS, clearSettings, loadSettings, saveSettings, versionFromUrl, type Settings, type Version, type Condition } from './settings';
import { CameraController, CameraError } from '../tracking/CameraController';
import { FaceTracker } from '../tracking/FaceTracker';
import { FaceProcessor } from '../tracking/FaceProcessor';
import { ExperimentClock, sanitizeStageTimes, stageForTime } from '../fatigue/ExperimentClock';
import { FatigueController } from '../fatigue/FatigueController';
import { STAGES, type FatigueParams } from '../fatigue/stages';
import { AvatarLoadError, loadAvatarSource } from '../avatar/AvatarLoader';
import { Avatar, type AvatarOptions } from '../avatar/Avatar';
import { createOverlayTextures, type OverlayTextures } from '../avatar/textures';
import { OVERLAY_TEXTURE_OVERRIDES } from '../config/overlayTextures';
import { AvatarRenderer } from '../render/AvatarRenderer';
import { Compositor, type HeadOverlayInput } from '../render/Compositor';
import type { CapabilityReport } from '../avatar/capabilities';
import { createPlaceholderSource } from '../avatar/Placeholder';
import type { OverlayTuning } from '../avatar/FatigueOverlays';
import { damp, smoothstep } from '../utils/math';

export interface ModelEntry {
  name: string;
  url: string;
}

export interface LiveValue {
  name: string;
  capture: number;
  final: number;
}

export interface UiState {
  settings: Settings;
  camera: {
    status: 'off' | 'starting' | 'on' | 'error';
    error: string | null;
    label: string;
    size: string;
    devices: { id: string; label: string }[];
    deviceId: string;
  };
  tracker: { status: 'idle' | 'loading' | 'ready' | 'error'; delegate: string; error: string | null; fps: number; ms: number; face: boolean; presence: number };
  avatar: { status: 'idle' | 'loading' | 'ready' | 'error'; progress: number; error: string | null; report: CapabilityReport | null; name: string; placeholder: boolean; tuning: OverlayTuning | null };
  experiment: { running: boolean; time: number; autoStage: number; stage: number; manual: number | null; blend: number };
  renderFps: number;
  recording: { active: boolean; seconds: number; mime: string };
  live: { values: LiveValue[]; head: { yaw: number; pitch: number; roll: number } };
  models: ModelEntry[];
  panelVisible: boolean;
  message: { text: string; kind: 'info' | 'error'; id: number } | null;
}

const LIVE_KEYS = [
  'eyeBlinkLeft', 'eyeBlinkRight', 'jawOpen', 'browInnerUp', 'browDownLeft', 'browOuterUpLeft',
  'mouthSmileLeft', 'mouthFrownLeft', 'mouthFunnel', 'mouthPucker', 'eyeWideLeft', 'cheekPuff',
] as const;

const BASE = import.meta.env.BASE_URL;
/** 版本 B 头部画布的边长（像素）。 */
const HEAD_PX = 1024;

export class Engine {
  readonly store: Store<UiState>;
  readonly camera = new CameraController();
  readonly tracker = new FaceTracker();
  readonly processor = new FaceProcessor();
  readonly clock = new ExperimentClock();
  readonly fatigue = new FatigueController();
  readonly renderer = new AvatarRenderer();
  readonly compositor = new Compositor(1080, 1920);
  avatar: Avatar | null = null;

  private settings: Settings;
  private manual: number | null = null;
  private presence = 0;
  private time = 0;
  private last = performance.now();
  private raf = 0;
  private lastVideoTime = -1;
  private filtersReset = false;
  private textures: Promise<OverlayTextures>;
  private trackerInit: Promise<void> | null = null;
  private fastUntil = 0;
  private uiTimer = 0;
  private frames = 0;
  private trackFrames = 0;
  private trackMs = 0;
  private fpsTimer = 0;
  private recorder: MediaRecorder | null = null;
  private recordStart = 0;
  private msgId = 0;
  private loadToken = 0;
  private exporting = false;
  private currentModelKey = '';
  private newVideoFrame = false;
  private rvfcArmed = false;

  constructor() {
    this.settings = loadSettings();
    this.settings.stageTimes = sanitizeStageTimes(this.settings.stageTimes, STAGES.length);
    const urlVersion = versionFromUrl();
    if (urlVersion) {
      this.settings.version = urlVersion;
      saveSettings(this.settings);
    }
    this.processor.update(this.settings.tracking);
    this.processor.setCalibration(this.settings.calibration);
    this.store = new Store<UiState>({
      settings: this.settings,
      camera: { status: 'off', error: null, label: '', size: '', devices: [], deviceId: '' },
      tracker: { status: 'idle', delegate: '', error: null, fps: 0, ms: 0, face: false, presence: 0 },
      avatar: { status: 'idle', progress: 0, error: null, report: null, name: '', placeholder: false, tuning: null },
      experiment: { running: false, time: 0, autoStage: 0, stage: 0, manual: null, blend: 1 },
      renderFps: 0,
      recording: { active: false, seconds: 0, mime: '' },
      live: { values: [], head: { yaw: 0, pitch: 0, roll: 0 } },
      models: [{ name: 'avatar.vrm（默认）', url: 'models/avatar.vrm' }],
      panelVisible: true,
      message: null,
    });
    this.textures = createOverlayTextures(
      Object.fromEntries(Object.entries(OVERLAY_TEXTURE_OVERRIDES).map(([k, v]) => [k, BASE + v])),
    );
    this.fatigue.setStage(0, true);
  }

  // ————————————————— 生命周期 —————————————————

  start(): void {
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);
    void this.loadModelList();
    void this.loadModel(this.settings.modelUrl);
    void this.ensureTracker();
    void this.refreshDevices();
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.stopRecording();
    this.camera.stop();
    this.tracker.close();
    this.avatar?.dispose();
    this.renderer.dispose();
  }

  private toast(text: string, kind: 'info' | 'error' = 'info'): void {
    this.store.set({ message: { text, kind, id: ++this.msgId } });
  }

  // ————————————————— 摄像头与面捕 —————————————————

  private ensureTracker(): Promise<void> {
    if (!this.trackerInit) {
      this.store.set((s) => ({ tracker: { ...s.tracker, status: 'loading', error: null } }));
      this.trackerInit = this.tracker
        .init(`${BASE}mediapipe`, this.settings.preferGpu)
        .then((delegate) => {
          this.store.set((s) => ({ tracker: { ...s.tracker, status: 'ready', delegate } }));
        })
        .catch((err) => {
          console.error('[FaceTracker]', err);
          this.trackerInit = null;
          this.store.set((s) => ({
            tracker: { ...s.tracker, status: 'error', error: `面捕模型加载失败：${(err as Error)?.message ?? err}。请确认 public/mediapipe/ 下有 wasm/ 和 face_landmarker.task（可运行 npm run setup-assets）。` },
          }));
        });
    }
    return this.trackerInit;
  }

  async refreshDevices(): Promise<void> {
    const list = await CameraController.listDevices().catch(() => []);
    this.store.set((s) => ({
      camera: { ...s.camera, devices: list.map((d, i) => ({ id: d.deviceId, label: d.label || `摄像头 ${i + 1}` })) },
    }));
  }

  async startCamera(deviceId?: string): Promise<void> {
    const id = deviceId ?? (this.store.get().camera.deviceId || undefined);
    this.store.set((s) => ({ camera: { ...s.camera, status: 'starting', error: null } }));
    try {
      const info = await this.camera.start(id);
      if (info.width > 0 && info.height > 0) this.processor.aspect = info.width / info.height;
      this.lastVideoTime = -1;
      this.rvfcArmed = false;
      this.armVideoFrameCallback();
      this.store.set((s) => ({
        camera: { ...s.camera, status: 'on', error: null, label: info.label, size: `${info.width}×${info.height}`, deviceId: info.deviceId ?? s.camera.deviceId },
      }));
      void this.refreshDevices();
      void this.ensureTracker();
    } catch (err) {
      const msg = err instanceof CameraError ? err.message : `摄像头启动失败：${(err as Error)?.message ?? err}`;
      this.store.set((s) => ({ camera: { ...s.camera, status: 'error', error: msg } }));
      this.toast(msg, 'error');
    }
  }

  /** 只在摄像头有新帧时做面捕（requestVideoFrameCallback），避免对同一帧重复检测。 */
  private armVideoFrameCallback(): void {
    const v = this.camera.video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
    if (!v.requestVideoFrameCallback || this.rvfcArmed) return;
    this.rvfcArmed = true;
    const cb = () => {
      this.newVideoFrame = true;
      if (this.camera.active) v.requestVideoFrameCallback!(cb);
      else this.rvfcArmed = false;
    };
    v.requestVideoFrameCallback(cb);
  }

  stopCamera(): void {
    this.camera.stop();
    this.store.set((s) => ({ camera: { ...s.camera, status: 'off', label: '', size: '' } }));
  }

  toggleCamera(): void {
    if (this.camera.active || this.camera.status === 'starting') this.stopCamera();
    else void this.startCamera();
  }

  calibrate(): void {
    if (!this.store.get().tracker.face) {
      this.toast('需要先检测到人脸才能校准。', 'error');
      return;
    }
    this.processor.calibrate();
    this.updateSettings({ calibration: this.processor.calibration });
    this.toast('已把当前头部姿态设为正脸。');
  }

  resetCalibration(): void {
    this.processor.resetCalibration();
    this.updateSettings({ calibration: this.processor.calibration });
  }

  // ————————————————— 实验控制 —————————————————

  startExperiment(): void {
    this.clock.start();
    this.pushExperiment();
  }

  pauseExperiment(): void {
    this.clock.pause();
    this.pushExperiment();
  }

  toggleExperiment(): void {
    this.clock.toggle();
    this.pushExperiment();
  }

  /** 计时归零、回到 Stage 0（立即）。 */
  resetExperiment(): void {
    this.clock.reset();
    this.manual = null;
    this.fatigue.setStage(0, true);
    this.pushExperiment();
  }

  seek(sec: number): void {
    this.clock.seek(sec);
    this.manual = null;
    this.fastUntil = performance.now() + 600;
    this.pushExperiment();
  }

  /** 手动锁定阶段；传 null 回到“跟随计时”。 */
  setManualStage(stage: number | null): void {
    this.manual = stage;
    if (stage !== null) this.fatigue.setStage(stage, this.settings.manualTransitionSec <= 0.01);
    else this.fastUntil = performance.now() + 600;
    this.pushExperiment();
  }

  private pushExperiment(): void {
    const t = this.clock.timeSec;
    const auto = stageForTime(t, this.settings.stageTimes);
    this.store.set({
      experiment: {
        running: this.clock.running,
        time: t,
        autoStage: auto,
        stage: this.manual ?? auto,
        manual: this.manual,
        blend: this.stageBlend(),
      },
    });
  }

  private stageBlend(): number {
    // 当前参数距离目标阶段的接近程度（0~1），用于界面显示过渡进度
    const goal = STAGES[this.fatigue.targetStage].params;
    const cur = this.fatigue.current;
    const d = Math.abs(goal.saturation - cur.saturation) + Math.abs(goal.headPitch - cur.headPitch) / 30;
    return Math.max(0, 1 - d * 3);
  }

  // ————————————————— 设置 —————————————————

  updateSettings(patch: Partial<Settings>): void {
    const next: Settings = { ...this.settings, ...patch };
    if (patch.stageTimes) next.stageTimes = sanitizeStageTimes(patch.stageTimes, STAGES.length);
    if (patch.tracking) {
      next.tracking = { ...this.settings.tracking, ...patch.tracking };
      this.processor.update(next.tracking);
    }
    if (patch.layout) next.layout = { ...this.settings.layout, ...patch.layout };
    this.settings = next;
    saveSettings(next);
    this.store.set({ settings: next });
    this.pushExperiment();
  }

  resetSettings(): void {
    clearSettings();
    const keepModel = this.settings.modelUrl;
    this.settings = { ...structuredClone(DEFAULT_SETTINGS), modelUrl: keepModel };
    this.processor.update(this.settings.tracking);
    this.processor.setCalibration(this.settings.calibration);
    saveSettings(this.settings);
    this.store.set({ settings: this.settings });
    this.toast('已恢复默认设置。');
  }

  /** 切换版本：A 右下角半身 / B 头部叠在脸上。 */
  setVersion(v: Version): void {
    this.updateSettings({ version: v, condition: v === 'A' ? 'A' : 'B' });
    this.toast(v === 'B' ? '版本 B：Avatar 只有头部，叠在用户脸上。' : '版本 A：Avatar 半身在画面右下角。');
  }

  /** 选择实验条件。C 复用头部 Avatar 构图，但隐藏真人摄像头画面。 */
  setCondition(condition: Condition): void {
    this.updateSettings({ condition, version: condition === 'A' ? 'A' : 'B' });
    const labels = { A: '短视频 + Avatar：视频 + 右下角角色', B: 'Self + Avatar：真人 + Avatar', C: 'Avatar Only：仅 Avatar' };
    this.toast(`条件 ${condition}：${labels[condition]}`);
  }

  toggleVersion(): void {
    this.setVersion(this.settings.version === 'B' ? 'A' : 'B');
  }

  togglePanel(force?: boolean): void {
    this.store.set((s) => ({ panelVisible: force ?? !s.panelVisible }));
  }

  // ————————————————— 模型 —————————————————

  private async loadModelList(): Promise<void> {
    try {
      const res = await fetch(`${BASE}models/models.json`, { cache: 'no-cache' });
      if (!res.ok) return;
      const list = (await res.json()) as ModelEntry[];
      if (Array.isArray(list) && list.length) this.store.set({ models: list });
    } catch {
      /* 没有清单文件时只用默认模型 */
    }
  }

  private async loadModelOptions(url: string): Promise<AvatarOptions> {
    const cfgUrl = url.replace(/\.(vrm|glb|gltf)$/i, '.config.json');
    if (cfgUrl === url) return {};
    try {
      const res = await fetch(BASE + cfgUrl, { cache: 'no-cache' });
      if (!res.ok) return {};
      const ct = res.headers.get('content-type') ?? '';
      if (!ct.includes('json')) return {};
      return (await res.json()) as AvatarOptions;
    } catch {
      return {};
    }
  }

  async loadModel(src: string | File): Promise<void> {
    const token = ++this.loadToken;
    const name = typeof src === 'string' ? src.split('/').pop() ?? src : src.name;
    this.store.set((s) => ({ avatar: { ...s.avatar, status: 'loading', progress: 0, error: null, name } }));
    try {
      const [textures, options] = await Promise.all([
        this.textures,
        typeof src === 'string' ? this.loadModelOptions(src) : Promise.resolve<AvatarOptions>({}),
      ]);
      const source = await loadAvatarSource(typeof src === 'string' ? BASE + src : src, (p) => {
        if (token === this.loadToken) this.store.set((s) => ({ avatar: { ...s.avatar, progress: p } }));
      });
      if (token !== this.loadToken) {
        source.dispose();
        return;
      }
      const saved = typeof src === 'string' ? loadTuning(src) : null;
      const avatar = new Avatar(source, textures, { ...options, overlayTuning: { ...(options.overlayTuning ?? {}), ...(saved ?? {}) } });
      this.swapAvatar(avatar);
      this.currentModelKey = typeof src === 'string' ? src : `file:${src.name}`;
      this.store.set({ avatar: { status: 'ready', progress: 1, error: null, report: avatar.report, name: source.meta.fileName, placeholder: false, tuning: avatar.overlayTuning } });
      if (typeof src === 'string') this.updateSettings({ modelUrl: src });
      console.info('[Avatar] 模型能力检查：', avatar.report);
      for (const w of avatar.report.warnings) console.warn('[Avatar] ', w);
    } catch (err) {
      if (token !== this.loadToken) return;
      const msg = err instanceof AvatarLoadError ? err.message : `模型加载失败：${(err as Error)?.message ?? err}`;
      console.error('[Avatar]', err);
      this.store.set((s) => ({ avatar: { ...s.avatar, status: 'error', error: msg } }));
      this.toast(msg, 'error');
      if (!this.avatar) await this.loadPlaceholder();
    }
  }

  private async loadPlaceholder(): Promise<void> {
    const textures = await this.textures;
    const avatar = new Avatar(createPlaceholderSource(), textures);
    this.swapAvatar(avatar);
    this.currentModelKey = 'placeholder';
    this.store.set((s) => ({ avatar: { ...s.avatar, report: avatar.report, placeholder: true, tuning: avatar.overlayTuning } }));
  }

  /** 微调疲惫贴片（第 4 阶段替换模型时对齐眼睛位置用），按模型分别记住。 */
  setOverlayTuning(patch: Partial<OverlayTuning>): void {
    if (!this.avatar) return;
    this.avatar.rebuildOverlays(patch);
    saveTuning(this.currentModelKey, this.avatar.overlayTuning);
    this.store.set((s) => ({ avatar: { ...s.avatar, tuning: this.avatar!.overlayTuning } }));
  }

  /** 下载当前模型的配置文件（贴片微调 + 材质分组），放到模型旁边即可随模型生效。 */
  exportModelConfig(): void {
    if (!this.avatar) return;
    const cfg = {
      overlayTuning: this.avatar.overlayTuning,
      materialCategories: this.avatar.options.materialCategories ?? {},
    };
    const base = (this.avatar.source.meta.fileName || 'avatar').replace(/\.(vrm|glb|gltf)$/i, '');
    download(new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' }), `${base}.config.json`);
  }

  private swapAvatar(next: Avatar): void {
    const old = this.avatar;
    this.avatar = next;
    this.renderer.setAvatar(next);
    old?.dispose();
  }

  // ————————————————— 主循环 —————————————————

  private loop = (now: number): void => {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.time += dt;
    if (this.exporting) return;

    // 1) 面捕（只在有新视频帧时检测）
    const v = this.camera.video;
    const fresh = this.rvfcArmed ? this.newVideoFrame : v.currentTime !== this.lastVideoTime;
    if (this.camera.active && this.tracker.ready && v.readyState >= 2 && fresh) {
      this.lastVideoTime = v.currentTime;
      this.newVideoFrame = false;
      const t0 = performance.now();
      try {
        const raw = this.tracker.detect(v, now);
        this.processor.process(raw, now);
      } catch (err) {
        console.warn('[FaceTracker] detect 失败', err);
      }
      this.trackMs = this.trackMs * 0.9 + (performance.now() - t0) * 0.1;
      this.trackFrames++;
    }
    const fr = this.processor.frame;
    const seen = this.camera.active && now - fr.lastSeenMs < 250;
    this.presence = damp(this.presence, seen ? 1 : 0, seen ? 10 : 2.5, dt);
    if (!seen && now - fr.lastSeenMs > 1500 && !this.filtersReset) {
      this.processor.resetFilters();
      this.filtersReset = true;
    } else if (seen) this.filtersReset = false;

    // 2) 实验计时 → 疲惫阶段
    const auto = stageForTime(this.clock.timeSec, this.settings.stageTimes);
    const stage = this.manual ?? auto;
    if (stage !== this.fatigue.targetStage) this.fatigue.setStage(stage, false);
    const fast = this.manual !== null || now < this.fastUntil;
    this.fatigue.transitionSec = fast ? this.settings.manualTransitionSec : this.settings.transitionSec;
    const params = this.fatigue.update(dt);

    // 3) 角色
    this.renderFrame(params, dt, fr.present || this.presence > 0.001 ? fr : null);

    // 4) 界面状态（10Hz）
    this.frames++;
    this.fpsTimer += dt;
    this.uiTimer += dt;
    if (this.fpsTimer >= 1) {
      const fps = this.frames / this.fpsTimer;
      const tfps = this.trackFrames / this.fpsTimer;
      this.frames = 0;
      this.trackFrames = 0;
      this.fpsTimer = 0;
      this.store.set((s) => ({ renderFps: Math.round(fps), tracker: { ...s.tracker, fps: Math.round(tfps), ms: Math.round(this.trackMs * 10) / 10 } }));
    }
    if (this.uiTimer >= 0.1) {
      this.uiTimer = 0;
      this.pushExperiment();
      const finalCh = this.avatar?.channels;
      this.store.set((s) => ({
        tracker: { ...s.tracker, face: seen, presence: this.presence },
        live: {
          values: LIVE_KEYS.map((k) => ({ name: k, capture: fr.channels[k] * this.presence, final: finalCh ? finalCh[k] : 0 })),
          head: { yaw: fr.head.yaw * 57.3, pitch: fr.head.pitch * 57.3, roll: fr.head.roll * 57.3 },
        },
        recording: this.recorder ? { ...s.recording, seconds: (performance.now() - this.recordStart) / 1000 } : s.recording,
      }));
      if (this.camera.status === 'off' && this.store.get().camera.status === 'on') this.stopCamera();
    }
  };

  private renderFrame(params: FatigueParams, dt: number, face: typeof this.processor.frame | null): void {
    const s = this.settings;
    const headMode = s.condition !== 'A';
    if (this.avatar) {
      this.avatar.setMode(headMode ? 'head' : 'corner');
      this.avatar.setGlasses(!!s.glasses[s.version]);
      this.avatar.update({ face, presence: this.presence, fatigue: params, time: this.time, dt });
    }
    const rect = this.compositor.avatarRectFor(s.layout);
    let headOverlay: HeadOverlayInput | null = null;
    if (headMode) {
      this.renderer.setSize(HEAD_PX, HEAD_PX);
      this.renderer.frameHead();
      this.renderer.render();
      if (this.avatar) headOverlay = this.headOverlayInput();
    } else {
      this.renderer.setSize(rect.w, rect.h);
      this.renderer.frame(s.layout);
      this.renderer.render();
    }
    const d = new Date();
    this.compositor.draw({
      video: this.camera.active && s.condition === 'B' ? this.camera.video : null,
      mirror: s.tracking.mirror,
      background: s.condition === 'A' ? 'transparent' : s.condition === 'C' ? 'dark' : s.background,
      cameraZoom: s.cameraZoom,
      autoFrame: s.autoFrame,
      faceFraction: headMode ? 0.3 : 0.4,
      faceBox: this.presence > 0.5 ? this.processor.frame.box : null,
      avatar: this.avatar && !headMode ? this.renderer.canvas : null,
      avatarRect: rect,
      headOverlay,
      chrome: headMode && s.chrome,
      clock: `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`,
      dt,
    });
  }

  /** 版本 B：头部画布 + 对齐信息。摄像头开着但没检测到人脸时淡出；摄像头关闭时放在画面中央。 */
  private headOverlayInput(): HeadOverlayInput | null {
    if (!this.avatar) return null;
    const pts = this.avatar.headPoints();
    const chinPx = this.renderer.project(pts.chin);
    const widthPx = this.avatar.faceWidth * this.renderer.pixelsPerMeter(pts.eyeMid);
    const camOn = this.camera.active;
    const points = this.processor.frame.points;
    const face = camOn && points && this.presence > 0.01 ? points : null;
    const opacity = camOn ? smoothstep(0.02, 0.5, this.presence) : 1;
    const hl = this.settings.headLayout;
    return {
      canvas: this.renderer.canvas,
      chinPx,
      widthPx,
      face,
      restChinRatio: this.processor.restChinRatio,
      scale: hl.scale,
      offsetX: hl.offsetX,
      offsetY: hl.offsetY,
      opacity,
    };
  }

  // ————————————————— 导出 —————————————————

  private stamp(): string {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  }

  snapshot(): void {
    const stage = this.store.get().experiment.stage;
    this.compositor.canvas.toBlob((b) => b && download(b, `beyond-the-mirror_${this.settings.version}_stage${stage}_${this.stamp()}.png`), 'image/png');
  }

  /** 导出当前角色（透明背景 PNG）。 */
  exportAvatarPng(): void {
    const stage = this.store.get().experiment.stage;
    this.renderer.canvas.toBlob((b) => b && download(b, `avatar_stage${stage}_${this.stamp()}.png`), 'image/png');
  }

  /**
   * 六阶段立绘：依次把角色切到 Stage 0–5（不叠加面捕，保持中性表情），
   * 渲染到一张横排图里，适合直接放进 Poster。
   */
  async exportStageSheet(): Promise<void> {
    if (!this.avatar || this.exporting) return;
    this.exporting = true;
    const headMode = this.settings.version === 'B';
    const cellW = 720;
    const cellH = headMode ? 720 : 960;
    const pad = 40;
    const labelH = 120;
    const sheet = document.createElement('canvas');
    sheet.width = STAGES.length * cellW + (STAGES.length + 1) * pad;
    sheet.height = cellH + labelH + pad * 2;
    const g = sheet.getContext('2d')!;
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, sheet.width, sheet.height);
    const prevStage = this.fatigue.targetStage;
    const prevParams = { ...this.fatigue.current };
    try {
      this.renderer.setSize(cellW, cellH);
      if (headMode) this.renderer.frameHead();
      else this.renderer.frame(this.settings.layout);
      for (let i = 0; i < STAGES.length; i++) {
        this.fatigue.setStage(i, true);
        const p = this.fatigue.current;
        // 多跑几帧让弹簧骨骼（头发）稳定
        for (let k = 0; k < 40; k++) this.avatar.update({ face: null, presence: 0, fatigue: p, time: 1.2 + k / 60, dt: 1 / 60 });
        this.renderer.render();
        const x = pad + i * (cellW + pad);
        g.drawImage(this.renderer.canvas, x, pad, cellW, cellH);
        g.fillStyle = '#1d1d1f';
        g.font = '600 40px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
        g.textAlign = 'center';
        g.fillText(`Stage ${i} · ${STAGES[i].nameEn}`, x + cellW / 2, pad + cellH + 50);
        g.fillStyle = '#6e6e73';
        g.font = '400 34px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
        g.fillText(`${STAGES[i].nameZh} · ${this.settings.stageTimes[i]}s`, x + cellW / 2, pad + cellH + 98);
        await new Promise((r) => setTimeout(r, 0));
      }
      await new Promise<void>((resolve) =>
        sheet.toBlob((b) => {
          if (b) download(b, `beyond-the-mirror_${headMode ? 'B-head' : 'A-corner'}_six-stages_${this.stamp()}.png`);
          resolve();
        }, 'image/png'),
      );
    } finally {
      this.fatigue.setStage(prevStage, true);
      Object.assign(this.fatigue.current, prevParams);
      this.exporting = false;
    }
  }

  startRecording(): void {
    if (this.recorder) return;
    if (typeof MediaRecorder === 'undefined') {
      this.toast('当前浏览器不支持 MediaRecorder 录制，请改用系统录屏。', 'error');
      return;
    }
    const mime = ['video/mp4;codecs=avc1.640028', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) =>
      MediaRecorder.isTypeSupported(m),
    );
    const stream = this.compositor.canvas.captureStream(30);
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12_000_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    rec.onstop = () => {
      const type = rec.mimeType || mime || 'video/webm';
      const ext = type.includes('mp4') ? 'mp4' : 'webm';
      download(new Blob(chunks, { type }), `beyond-the-mirror_${this.settings.version}_demo_${this.stamp()}.${ext}`);
      stream.getTracks().forEach((t) => t.stop());
    };
    rec.start(1000);
    this.recorder = rec;
    this.recordStart = performance.now();
    this.store.set({ recording: { active: true, seconds: 0, mime: rec.mimeType || mime || '' } });
  }

  stopRecording(): void {
    if (!this.recorder) return;
    this.recorder.stop();
    this.recorder = null;
    this.store.set((s) => ({ recording: { ...s.recording, active: false } }));
  }

  toggleRecording(): void {
    if (this.recorder) this.stopRecording();
    else this.startRecording();
  }

  /** 调试 / 自动化测试用。 */
  debugState(): Record<string, unknown> {
    return {
      presence: this.presence,
      stage: this.fatigue.targetStage,
      params: { ...this.fatigue.current },
      channels: this.avatar ? { ...this.avatar.channels } : null,
      head: { ...this.processor.frame.head },
      raw: { ...this.processor.frame.raw },
      box: this.processor.frame.box,
      points: this.processor.frame.points,
      version: this.settings.version,
      headPlacement: this.compositor.lastHead,
      tracker: this.tracker.delegate,
    };
  }
}

const TUNING_KEY = 'beyond-the-mirror/overlay-tuning/v1';
function loadTuning(model: string): Partial<OverlayTuning> | null {
  try {
    const all = JSON.parse(localStorage.getItem(TUNING_KEY) ?? '{}') as Record<string, Partial<OverlayTuning>>;
    return all[model] ?? null;
  } catch {
    return null;
  }
}
function saveTuning(model: string, t: OverlayTuning): void {
  try {
    const all = JSON.parse(localStorage.getItem(TUNING_KEY) ?? '{}') as Record<string, OverlayTuning>;
    all[model] = t;
    localStorage.setItem(TUNING_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
