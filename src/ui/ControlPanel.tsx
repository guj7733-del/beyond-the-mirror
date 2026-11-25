import { useState, type ReactNode } from 'react';
import { engine } from './engine';
import type { UiState } from '../core/Engine';
import { STAGES } from '../fatigue/stages';
import { DEFAULT_LAYOUT, type AvatarLayout } from '../render/AvatarRenderer';
import { DEFAULT_HEAD_LAYOUT, type HeadLayout } from '../core/settings';
import { DEFAULT_TRACKING, type TrackingSettings } from '../tracking/FaceProcessor';
import { DEFAULT_STAGE_TIMES } from '../fatigue/stages';
import { formatTime } from '../utils/math';
import { DebugPanel } from './DebugPanel';
import type { BackgroundMode } from '../render/Compositor';

function Section({ title, sub, children, open = true }: { title: string; sub?: string; children: ReactNode; open?: boolean }) {
  return (
    <details className="section" open={open}>
      <summary>
        <span>{title}</span>
        {sub && <em>{sub}</em>}
      </summary>
      <div className="section-body">{children}</div>
    </details>
  );
}

function Slider(props: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; fmt?: (v: number) => string }) {
  return (
    <label className="slider">
      <span className="slider-label">{props.label}</span>
      <input type="range" min={props.min} max={props.max} step={props.step} value={props.value} onChange={(e) => props.onChange(Number(e.target.value))} />
      <span className="slider-value">{props.fmt ? props.fmt(props.value) : props.value.toFixed(2)}</span>
    </label>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function ControlPanel({ ui }: { ui: UiState }) {
  const s = ui.settings;
  const ex = ui.experiment;
  const stage = STAGES[ex.stage];
  const maxT = Math.max(120, Math.ceil((s.stageTimes[s.stageTimes.length - 1] + 30) / 10) * 10);
  const setLayout = (p: Partial<AvatarLayout>) => engine.updateSettings({ layout: { ...s.layout, ...p } });
  const setHead = (p: Partial<HeadLayout>) => engine.updateSettings({ headLayout: { ...s.headLayout, ...p } });
  const isB = s.condition !== 'A';
  const setTracking = (p: Partial<TrackingSettings>) => engine.updateSettings({ tracking: { ...s.tracking, ...p } });
  const [timesDraft, setTimesDraft] = useState<string[] | null>(null);
  const times = timesDraft ?? s.stageTimes.map(String);
  const cam = ui.camera;

  return (
    <aside className="panel">
      <header className="panel-head">
        <div>
          <h1>Beyond the Mirror</h1>
          <p>Webcam-driven Avatar Fatigue Prototype</p>
        </div>
        <button className="btn ghost" title="隐藏控制面板（H）" onClick={() => engine.togglePanel(false)}>
          隐藏 H
        </button>
      </header>

      <div className="version-switch" role="group" aria-label="实验条件">
        <button className={`btn ${s.condition === 'A' ? 'active' : ''}`} onClick={() => engine.setCondition('A')} title="播放短视频，右下角显示 Avatar">
          <b>A · 短视频 + Avatar</b><span>视频 + 角色</span>
        </button>
        <button className={`btn ${s.condition === 'B' ? 'active' : ''}`} onClick={() => engine.setCondition('B')} title="Self + Avatar：真人与 Avatar 同时显示">
          <b>B · Self + Avatar</b><span>真人 + Avatar</span>
        </button>
        <button className={`btn ${s.condition === 'C' ? 'active' : ''}`} onClick={() => engine.setCondition('C')} title="Avatar Only：隐藏真人画面，保留面捕驱动 Avatar">
          <b>C · Avatar Only</b><span>仅 Avatar</span>
        </button>
      </div>

      <Section title="实验 Experiment" sub={ex.running ? '计时中' : '已暂停'}>
        <div className="readout">
          <div>
            <small>Current Time</small>
            <strong className="mono">{formatTime(ex.time)}</strong>
          </div>
          <div>
            <small>Current Stage</small>
            <strong>
              Stage {stage.id} · {stage.nameEn}
            </strong>
            <span className="muted">
              {stage.nameZh} · {ex.manual === null ? '跟随计时' : '手动锁定'}
            </span>
          </div>
        </div>
        <div className="row">
          <button className={`btn ${ex.running ? '' : 'primary'}`} onClick={() => engine.toggleExperiment()}>
            {ex.running ? 'Pause Experiment' : 'Start Experiment'}
          </button>
          <button className="btn" onClick={() => engine.resetExperiment()}>
            Reset Experiment
          </button>
        </div>
        <div className="timeline">
          <input type="range" min={0} max={maxT} step={0.1} value={Math.min(ex.time, maxT)} onChange={(e) => engine.seek(Number(e.target.value))} aria-label="Time Progress Slider" />
          <div className="ticks">
            {s.stageTimes.map((t, i) => (
              <span key={i} style={{ left: `${(t / maxT) * 100}%` }} className={i === ex.autoStage ? 'on' : ''}>
                {i}
              </span>
            ))}
          </div>
        </div>
        <div className="stage-buttons" role="group" aria-label="Manual Stage Selector">
          <button className={`btn small ${ex.manual === null ? 'active' : ''}`} onClick={() => engine.setManualStage(null)} title="跟随计时（A）">
            Auto
          </button>
          {STAGES.map((st) => (
            <button key={st.id} className={`btn small ${ex.manual === st.id ? 'active' : ''} ${ex.stage === st.id ? 'current' : ''}`} onClick={() => engine.setManualStage(st.id)} title={`${st.nameZh}：${st.summary}（快捷键 ${st.id}）`}>
              {st.id}
            </button>
          ))}
        </div>
        <p className="hint">{stage.summary}</p>
        <div className="times">
          {STAGES.map((st, i) => (
            <label key={st.id}>
              <span>S{i}</span>
              <input
                type="number"
                min={0}
                step={1}
                value={times[i]}
                disabled={i === 0}
                onChange={(e) => {
                  const next = [...times];
                  next[i] = e.target.value;
                  setTimesDraft(next);
                }}
                onBlur={() => {
                  if (timesDraft) engine.updateSettings({ stageTimes: timesDraft.map(Number) });
                  setTimesDraft(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                }}
              />
            </label>
          ))}
          <button className="btn small" onClick={() => engine.updateSettings({ stageTimes: [...DEFAULT_STAGE_TIMES] })}>
            默认
          </button>
        </div>
        <Slider label="自动过渡" value={s.transitionSec} min={0} max={5} step={0.1} fmt={(v) => `${v.toFixed(1)} s`} onChange={(v) => engine.updateSettings({ transitionSec: v })} />
        <Slider label="手动切换过渡" value={s.manualTransitionSec} min={0} max={2} step={0.05} fmt={(v) => (v === 0 ? '硬切' : `${v.toFixed(2)} s`)} onChange={(v) => engine.updateSettings({ manualTransitionSec: v })} />
      </Section>

      <Section title="摄像头 Camera" sub={cam.status === 'on' ? '已开启' : cam.status === 'starting' ? '开启中' : '未开启'}>
        <div className="row">
          <button className={`btn ${cam.status === 'on' ? '' : 'primary'}`} onClick={() => engine.toggleCamera()} disabled={cam.status === 'starting'}>
            {cam.status === 'on' ? 'Stop Camera' : 'Start Camera'}
          </button>
          <button className="btn" onClick={() => engine.calibrate()} title="把当前头部姿态设为正脸（K）" disabled={!ui.tracker.face}>
            校准正脸
          </button>
          <button className="btn ghost small" onClick={() => engine.resetCalibration()}>
            重置
          </button>
        </div>
        {cam.devices.length > 1 && (
          <select value={cam.deviceId} onChange={(e) => engine.startCamera(e.target.value)}>
            {cam.devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        )}
        {cam.status === 'on' && (
          <p className="muted">
            {cam.label} · {cam.size}
          </p>
        )}
        {cam.error && <p className="err">{cam.error}</p>}
        <div className="row wrap">
          <Toggle label="镜像" checked={s.tracking.mirror} onChange={(v) => setTracking({ mirror: v })} />
          {isB && <Toggle label="自动大脸构图" checked={s.autoFrame} onChange={(v) => engine.updateSettings({ autoFrame: v })} />}
        </div>
        {isB && <Slider label="画面缩放" value={s.cameraZoom} min={1} max={2.5} step={0.05} onChange={(v) => engine.updateSettings({ cameraZoom: v })} />}
      </Section>

      <Section title="角色 Avatar" sub={ui.avatar.status === 'ready' ? ui.avatar.name : ui.avatar.status === 'loading' ? '加载中' : ''}>
        <div className="row">
          <select value={s.modelUrl} onChange={(e) => engine.loadModel(e.target.value)}>
            {ui.models.map((m) => (
              <option key={m.url} value={m.url}>
                {m.name}
              </option>
            ))}
            {!ui.models.some((m) => m.url === s.modelUrl) && <option value={s.modelUrl}>{s.modelUrl}</option>}
          </select>
          <label className="btn file">
            本地文件…
            <input
              type="file"
              accept=".vrm,.glb,.gltf"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) engine.loadModel(f);
                e.target.value = '';
              }}
            />
          </label>
        </div>
        {ui.avatar.status === 'loading' && <progress value={ui.avatar.progress} max={1} />}
        {ui.avatar.error && <p className="err">{ui.avatar.error}</p>}
        {ui.avatar.placeholder && <p className="warn-text">当前显示的是占位角色。</p>}
        {ui.avatar.report && (
          <p className={ui.avatar.report.warnings.length ? 'warn-text' : 'muted'}>
            {ui.avatar.report.meta.specVersion} · ARKit 直连 {ui.avatar.report.counts.direct}/52
            {ui.avatar.report.warnings.length ? ` · 模型检查有 ${ui.avatar.report.warnings.length} 条提示，详见“调试 → 模型检查”` : ' · 模型检查无异常'}
          </p>
        )}
        <Toggle label={`角色戴眼镜（版本 ${s.version}）`} checked={!!s.glasses[s.version]} onChange={(v) => engine.updateSettings({ glasses: { ...s.glasses, [s.version]: v } })} />
        {!isB && (
          <>
            <Slider label="宽度" value={s.layout.widthPct} min={0.25} max={1} step={0.01} onChange={(v) => setLayout({ widthPct: v })} />
            <Slider label="高度" value={s.layout.heightPct} min={0.2} max={0.9} step={0.01} onChange={(v) => setLayout({ heightPct: v })} />
            <Slider label="右边距" value={s.layout.rightPct} min={0} max={0.5} step={0.005} onChange={(v) => setLayout({ rightPct: v })} />
            <Slider label="下边距" value={s.layout.bottomPct} min={0} max={0.5} step={0.005} onChange={(v) => setLayout({ bottomPct: v })} />
            <Slider label="角色缩放" value={s.layout.zoom} min={0.5} max={2} step={0.01} onChange={(v) => setLayout({ zoom: v })} />
            <Slider label="上下平移" value={s.layout.offsetY} min={-0.5} max={0.5} step={0.01} onChange={(v) => setLayout({ offsetY: v })} />
            <Slider label="左右平移" value={s.layout.offsetX} min={-0.5} max={0.5} step={0.01} onChange={(v) => setLayout({ offsetX: v })} />
            <Slider label="朝向" value={s.layout.yawDeg} min={-45} max={45} step={1} fmt={(v) => `${v.toFixed(0)}°`} onChange={(v) => setLayout({ yawDeg: v })} />
            <button className="btn small" onClick={() => engine.updateSettings({ layout: { ...DEFAULT_LAYOUT } })}>
              恢复默认布局
            </button>
          </>
        )}
        {isB && (
          <>
            <Slider label="头部大小" value={s.headLayout.scale} min={0.6} max={1.8} step={0.01} onChange={(v) => setHead({ scale: v })} />
            <Slider label="上下偏移" value={s.headLayout.offsetY} min={-0.6} max={0.6} step={0.01} onChange={(v) => setHead({ offsetY: v })} />
            <Slider label="左右偏移" value={s.headLayout.offsetX} min={-0.6} max={0.6} step={0.01} onChange={(v) => setHead({ offsetX: v })} />
            <p className="hint">头部按用户脸宽缩放，角色下巴对齐用户闭嘴时的下巴。没开摄像头时放在画面中央，方便预览；摄像头开着但没检测到人脸时，头部会淡出。</p>
            <button className="btn small" onClick={() => engine.updateSettings({ headLayout: { ...DEFAULT_HEAD_LAYOUT } })}>
              恢复默认
            </button>
          </>
        )}
      </Section>

      <Section title="贴片微调 Overlay" sub="替换模型后对齐眼部效果" open={false}>
        {ui.avatar.tuning && (
          <>
            <Slider label="黑眼圈上下" value={ui.avatar.tuning.darkCircleOffsetY} min={-1} max={1} step={0.02} onChange={(v) => engine.setOverlayTuning({ darkCircleOffsetY: v })} />
            <Slider label="黑眼圈大小" value={ui.avatar.tuning.darkCircleScale} min={0.5} max={2} step={0.02} onChange={(v) => engine.setOverlayTuning({ darkCircleScale: v })} />
            <Slider label="眼部符号大小" value={ui.avatar.tuning.eyeSymbolScale} min={0.5} max={2} step={0.02} onChange={(v) => engine.setOverlayTuning({ eyeSymbolScale: v })} />
            <Slider label="眼部符号上下" value={ui.avatar.tuning.eyeSymbolOffsetY} min={-1} max={1} step={0.02} onChange={(v) => engine.setOverlayTuning({ eyeSymbolOffsetY: v })} />
            <Slider label="头顶符号高度" value={ui.avatar.tuning.symbolOffsetY} min={-0.1} max={0.2} step={0.005} onChange={(v) => engine.setOverlayTuning({ symbolOffsetY: v })} />
            <Slider label="头顶符号大小" value={ui.avatar.tuning.symbolScale} min={0.5} max={2} step={0.02} onChange={(v) => engine.setOverlayTuning({ symbolScale: v })} />
            <p className="hint">调整时可先按 4 / 5 切到螺旋眼、× 眼阶段观察。参数按模型分别保存在本浏览器；点“导出模型配置”得到 *.config.json，放到模型文件旁边即可随模型生效。</p>
            <div className="row">
              <button className="btn small" onClick={() => engine.setOverlayTuning({ darkCircleOffsetY: 0, darkCircleScale: 1, eyeSymbolScale: 1, eyeSymbolOffsetY: 0, symbolOffsetY: 0, symbolScale: 1 })}>
                恢复默认
              </button>
              <button className="btn small" onClick={() => engine.exportModelConfig()}>
                导出模型配置
              </button>
            </div>
          </>
        )}
      </Section>

      <Section title="面捕参数 Tracking" open={false}>
        <Slider label="平滑强度" value={s.tracking.smoothing} min={0} max={1} step={0.05} onChange={(v) => setTracking({ smoothing: v })} />
        <Slider label="眨眼起点" value={s.tracking.blinkLow} min={0} max={0.5} step={0.01} onChange={(v) => setTracking({ blinkLow: v })} />
        <Slider label="眨眼终点" value={s.tracking.blinkHigh} min={0.2} max={1} step={0.01} onChange={(v) => setTracking({ blinkHigh: Math.max(v, s.tracking.blinkLow + 0.05) })} />
        <Slider label="张嘴增益" value={s.tracking.jawGain} min={0.5} max={3} step={0.05} onChange={(v) => setTracking({ jawGain: v })} />
        <Slider label="头部增益" value={s.tracking.headGain} min={0} max={2} step={0.05} onChange={(v) => setTracking({ headGain: v })} />
        <Toggle label="双眼同步（减少单眼抖动）" checked={s.tracking.linkBlink} onChange={(v) => setTracking({ linkBlink: v })} />
        <button className="btn small" onClick={() => engine.updateSettings({ tracking: { ...DEFAULT_TRACKING, mirror: s.tracking.mirror } })}>
          恢复默认面捕参数
        </button>
      </Section>

      <Section title="录制与导出 Record" sub={ui.recording.active ? `录制中 ${ui.recording.seconds.toFixed(0)}s` : ''}>
        <div className="row wrap">
          <button className={`btn ${ui.recording.active ? 'danger' : 'primary'}`} onClick={() => engine.toggleRecording()}>
            {ui.recording.active ? '■ 停止录制' : '● 开始录制'}
          </button>
          <button className="btn" onClick={() => engine.snapshot()}>
            截图 PNG
          </button>
          <button className="btn" onClick={() => engine.exportAvatarPng()}>
            角色透明 PNG
          </button>
          <button className="btn" onClick={() => engine.exportStageSheet()}>
            导出六阶段立绘
          </button>
        </div>
        <p className="hint">
          {isB ? '录制左侧 9:16 画面（1080×1920，30fps），浏览器支持时为 MP4，否则为 WebM。' : '截图和录制仅采集角色画布。需要同时录下短视频和角色时，请使用系统录屏。'}
        </p>
        {isB && (
          <>
            <div className="row wrap">
              <span className="muted">背景</span>
              {(
                [
                  ['camera', '摄像头'],
                  ['dark', '深色'],
                  ['green', '绿幕'],
                  ['transparent', '透明'],
                ] as [BackgroundMode, string][]
              ).map(([k, label]) => (
                <button key={k} className={`btn small ${s.background === k ? 'active' : ''}`} onClick={() => engine.updateSettings({ background: k })}>
                  {label}
                </button>
              ))}
            </div>
            <Toggle label="显示短视频界面元素" checked={s.chrome} onChange={(v) => engine.updateSettings({ chrome: v })} />
          </>
        )}
      </Section>

      <Section title="调试 Debug" open={false}>
        <DebugPanel ui={ui} />
      </Section>

      <footer className="panel-foot">
        <p>
          快捷键：M 切换版本 A/B · 空格 开始/暂停 · R 重置 · 0–5 切换阶段 · A 跟随计时 · C 摄像头 · K 校准 · P 截图 · V 录制 · H 隐藏面板
        </p>
        <button className="btn ghost small" onClick={() => engine.resetSettings()}>
          恢复全部默认设置
        </button>
      </footer>
    </aside>
  );
}
