import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type RefObject } from 'react';
import type { UiState } from '../core/Engine';
import type { Condition, PresentationSettings } from '../core/settings';
import { formatTime } from '../utils/math';
import { AvatarSettings, ModelPicker, WindowLayoutFields } from './AvatarSettings';
import { engine } from './engine';
import { ExperimentPreview } from './ExperimentPreview';
import { Section, Slider, Toggle } from './SettingFields';

const HOLD_MS = 650;
const MOVE_TOLERANCE = 12;

export type ExperimentSettingsEntry = { confirmEnd: boolean; wasRunning: boolean };

export function ExperimentHotspot({ stageRef, onOpen }: { stageRef: RefObject<HTMLDivElement | null>; onOpen: () => void }) {
  const hotspotRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    let press: { id: number; x: number; y: number; timer: number } | undefined;

    function cancelPress() {
      if (!press) return;
      window.clearTimeout(press.timer);
      press = undefined;
    }

    function pointerDown(event: PointerEvent) {
      if (event.pointerType !== 'touch') return;
      cancelPress();
      if (!event.isPrimary || !(event.target instanceof Node) || !stage?.contains(event.target)) return;
      const area = hotspotRef.current?.getBoundingClientRect();
      const { clientX: x, clientY: y, pointerId: id } = event;
      if (!area?.width || x < area.left || x >= area.right || y < area.top || y >= area.bottom) return;

      const timer = window.setTimeout(() => {
        cancelPress();
        onOpen();
      }, HOLD_MS);
      press = { id, x, y, timer };
    }

    function pointerMove(event: PointerEvent) {
      if (press?.id === event.pointerId && Math.hypot(event.clientX - press.x, event.clientY - press.y) > MOVE_TOLERANCE) {
        cancelPress();
      }
    }

    function pointerEnd(event: PointerEvent) {
      if (press?.id === event.pointerId) cancelPress();
    }

    window.addEventListener('pointerdown', pointerDown, { passive: true });
    window.addEventListener('pointermove', pointerMove, { passive: true });
    window.addEventListener('pointerup', pointerEnd);
    window.addEventListener('pointercancel', pointerEnd);
    window.addEventListener('blur', cancelPress);
    return () => {
      cancelPress();
      window.removeEventListener('pointerdown', pointerDown);
      window.removeEventListener('pointermove', pointerMove);
      window.removeEventListener('pointerup', pointerEnd);
      window.removeEventListener('pointercancel', pointerEnd);
      window.removeEventListener('blur', cancelPress);
    };
  }, [stageRef, onOpen]);

  return <span ref={hotspotRef} className="experiment-hotspot" aria-hidden="true" />;
}

interface ExperimentSettingsProps {
  ui: UiState;
  entry: ExperimentSettingsEntry;
  activeVideo: RefObject<HTMLVideoElement | null>;
  onClose: () => void;
}

export function ExperimentSettings({ ui, entry, activeVideo, onClose }: ExperimentSettingsProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [confirmEnd, setConfirmEnd] = useState(entry.confirmEnd);
  const [draft, setDraft] = useState<PresentationSettings>(() => {
    const { condition, glasses, layout, headLayout, tracking, autoFrame, cameraZoom } = ui.settings;
    return { condition, glasses, layout, headLayout, tracking, autoFrame, cameraZoom };
  });
  const [previewStage, setPreviewStage] = useState(0);
  const [times, setTimes] = useState(() => ui.settings.stageTimes.map(String));
  const [transition, setTransition] = useState(String(ui.settings.transitionSec));
  const [manualTransition, setManualTransition] = useState(String(ui.settings.manualTransitionSec));
  const [model, setModel] = useState<string | File | null>(null);
  const [loadingModel, setLoadingModel] = useState<{ source: string | File; progress: number } | null>(null);
  const [modelError, setModelError] = useState('');
  const [error, setError] = useState('');
  const { condition } = draft;
  const modelSource = loadingModel?.source ?? model;
  const modelUrl = typeof modelSource === 'string' ? modelSource : ui.settings.modelUrl;
  const localFileName = modelSource instanceof File ? modelSource.name : modelSource === null ? ui.avatar.localFileName : null;

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    titleRef.current?.focus();
  }, [confirmEnd]);

  useLayoutEffect(() => {
    if (!confirmEnd) engine.setPreview(draft, previewStage);
  }, [confirmEnd, draft, previewStage]);

  useLayoutEffect(() => () => engine.clearPreview(), []);

  function changeDraft(patch: Partial<PresentationSettings>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function close() {
    if (confirmEnd && entry.wasRunning) engine.startExperiment();
    dialogRef.current?.close();
    onClose();
  }

  async function changeModel(source: string | File) {
    setModelError('');
    if (source === ui.settings.modelUrl && ui.avatar.status === 'ready' && !ui.avatar.localFileName) {
      engine.restorePreviewModel();
      setModel(null);
      return;
    }
    setLoadingModel({ source, progress: 0 });
    try {
      if (await engine.loadPreviewModel(source, (progress) => setLoadingModel({ source, progress }))) setModel(source);
    } catch (err) {
      setModelError(err instanceof Error ? err.message : '角色模型未能加载，请重试。');
    } finally {
      setLoadingModel(null);
    }
  }

  function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (confirmEnd || loadingModel) return;
    const stageTimes = times.map(Number);
    if (stageTimes.some((time, index) => index > 0 && time < stageTimes[index - 1])) {
      setError('阶段开始时间须按顺序递增或相同。');
      return;
    }

    engine.savePreviewModel();
    engine.updateSettings({
      ...draft,
      stageTimes,
      transitionSec: Number(transition),
      manualTransitionSec: Number(manualTransition),
    });
    if ((event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'start') {
      engine.resetExperiment();
      engine.startExperiment();
    }
    close();
  }

  return (
    <dialog
      className={`experiment-sheet${confirmEnd ? ' is-confirming' : ''}`}
      aria-labelledby="experiment-sheet-title"
      ref={dialogRef}
      onCancel={(event) => { event.preventDefault(); close(); }}
    >
      <form
        className="experiment-sheet-layout"
        onSubmit={saveSettings}
        onInvalidCapture={(event) => {
          if (event.target instanceof HTMLInputElement) event.target.closest('details')?.setAttribute('open', '');
        }}
      >
        <header className="experiment-sheet-header">
          <h2 id="experiment-sheet-title" ref={titleRef} tabIndex={-1}>{confirmEnd ? '结束本轮实验？' : '实验设置与实时预览'}</h2>
          {!confirmEnd && <button type="button" className="btn ghost" onClick={close}>取消</button>}
        </header>
        {confirmEnd ? (
          <p className="experiment-confirm-copy">计时已暂停 · 条件 {ui.settings.condition} · 已用 {formatTime(ui.experiment.time)}</p>
        ) : (
          <div className="experiment-settings-grid">
            <ExperimentPreview
              key={condition}
              settings={draft}
              stage={previewStage}
              onStageChange={setPreviewStage}
              activeVideo={activeVideo}
              camera={ui.camera}
              tracker={ui.tracker}
            />
            <div className="experiment-sheet-body">
              <label className="experiment-field">
                <span>实验条件</span>
                <select value={condition} onChange={(event) => changeDraft({ condition: event.target.value as Condition })}>
                  <option value="A">A · 短视频 + Avatar</option>
                  <option value="B">B · Self + Avatar</option>
                  <option value="C">C · Self Only</option>
                </select>
              </label>
              {condition !== 'C' && (
                <Section title={condition === 'B' ? 'Avatar 贴脸' : 'Avatar 构图'}>
                  <AvatarSettings settings={draft} condition={condition} onChange={changeDraft} />
                </Section>
              )}
              <Section title="小窗位置与尺寸" sub="三组共用" open={condition === 'A'}>
                <WindowLayoutFields layout={draft.layout} onChange={(layout) => changeDraft({ layout })} />
              </Section>
              <Section title="摄像头构图" sub={condition === 'A' ? undefined : 'B、C 组共用构图'} open={false}>
                <Toggle label="镜像" checked={draft.tracking.mirror} onChange={(mirror) => changeDraft({ tracking: { ...draft.tracking, mirror } })} />
                {condition !== 'A' && (
                  <>
                    <Toggle label="自动大脸构图" checked={draft.autoFrame} onChange={(autoFrame) => changeDraft({ autoFrame })} />
                    <Slider label="摄像头缩放" value={draft.cameraZoom} min={1} max={2.5} step={0.05} onChange={(cameraZoom) => changeDraft({ cameraZoom })} />
                  </>
                )}
              </Section>
              {condition !== 'C' && (
                <Section title="角色模型" sub={localFileName ?? ui.models.find((entry) => entry.url === modelUrl)?.name} open={false}>
                  <fieldset disabled={!!loadingModel}>
                    <ModelPicker models={ui.models} modelUrl={modelUrl} localFileName={localFileName} onModelChange={changeModel} />
                  </fieldset>
                  {loadingModel && <progress aria-label="角色模型加载进度" value={loadingModel.progress} max={1} />}
                  {!modelSource && ui.avatar.status === 'loading' && <progress aria-label="角色模型加载进度" value={ui.avatar.progress} max={1} />}
                  {(modelError || (!modelSource && ui.avatar.error)) && <p className="err" role="alert">{modelError || ui.avatar.error}</p>}
                  {!modelSource && ui.avatar.placeholder && <p className="warn-text">当前显示的是占位角色。</p>}
                </Section>
              )}
              <Section title="阶段时间与过渡" open={false}>
                <fieldset>
                  <legend>阶段开始时间（秒）</legend>
                  <div className="experiment-stage-times">
                    {times.map((time, index) => (
                      <label className="experiment-field" key={index}>
                        <span>Stage {index}</span>
                        <input
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step={0.1}
                          value={time}
                          required
                          readOnly={index === 0}
                          onChange={(event) => {
                            const value = event.target.value;
                            setTimes((current) => current.map((previous, i) => i === index ? value : previous));
                            setError('');
                          }}
                        />
                      </label>
                    ))}
                  </div>
                </fieldset>
                <label className="experiment-field">
                  <span>自动过渡（秒）</span>
                  <input type="number" inputMode="decimal" min={0} max={5} step={0.1} required value={transition} onChange={(event) => setTransition(event.target.value)} />
                </label>
                <label className="experiment-field">
                  <span>手动切换过渡（秒）</span>
                  <input type="number" inputMode="decimal" min={0} max={2} step={0.05} required value={manualTransition} onChange={(event) => setManualTransition(event.target.value)} />
                </label>
              </Section>
            </div>
          </div>
        )}
        <footer className="experiment-sheet-actions">
          {confirmEnd ? (
            <>
              <button type="button" className="btn" onClick={close}>{entry.wasRunning ? '继续实验' : '保持暂停'}</button>
              <button
                type="button"
                className="btn danger"
                onClick={(event) => {
                  event.preventDefault();
                  engine.endExperiment();
                  setConfirmEnd(false);
                }}
              >
                结束本轮并设置
              </button>
            </>
          ) : (
            <>
              {error && <p className="err" role="alert">{error}</p>}
              <button type="submit" className="btn" value="save" disabled={!!loadingModel}>保存设置</button>
              <button type="submit" className="btn primary" value="start" disabled={!!loadingModel}>保存并开始</button>
            </>
          )}
        </footer>
      </form>
    </dialog>
  );
}
