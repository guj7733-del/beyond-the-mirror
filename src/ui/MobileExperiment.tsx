import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type RefObject } from 'react';
import type { UiState } from '../core/Engine';
import type { Condition } from '../core/settings';
import { formatTime } from '../utils/math';
import { AvatarSettings, type AvatarSettingValues } from './AvatarSettings';
import { engine } from './engine';
import { Section } from './SettingFields';

const HOLD_MS = 650;
const MOVE_TOLERANCE = 12;

type Entry = { confirmEnd: boolean; wasRunning: boolean };

export function MobileExperiment({ stageRef, ui }: { stageRef: RefObject<HTMLDivElement | null>; ui: UiState }) {
  const hotspotRef = useRef<HTMLSpanElement>(null);
  const [entry, setEntry] = useState<Entry | null>(null);

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
        const { status } = engine.store.get().experiment;
        engine.pauseExperiment();
        setEntry({ confirmEnd: status === 'running' || status === 'paused', wasRunning: status === 'running' });
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
  }, [stageRef]);

  return (
    <>
      <span ref={hotspotRef} className="experiment-hotspot" aria-hidden="true" />
      {entry && <ExperimentSheet ui={ui} entry={entry} onClose={() => setEntry(null)} />}
    </>
  );
}

function ExperimentSheet({ ui, entry, onClose }: { ui: UiState; entry: Entry; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [confirmEnd, setConfirmEnd] = useState(entry.confirmEnd);
  const [condition, setCondition] = useState(ui.settings.condition);
  const [times, setTimes] = useState(() => ui.settings.stageTimes.map(String));
  const [transition, setTransition] = useState(String(ui.settings.transitionSec));
  const [manualTransition, setManualTransition] = useState(String(ui.settings.manualTransitionSec));
  const [avatarDraft, setAvatarDraft] = useState<AvatarSettingValues>(() => {
    const { glasses, layout, headLayout } = ui.settings;
    return { glasses, layout, headLayout };
  });
  const [modelSource, setModelSource] = useState<string | File | null>(null);
  const [loadingModel, setLoadingModel] = useState(false);
  const [error, setError] = useState('');
  const version = condition === 'A' ? 'A' : 'B';
  const modelUrl = typeof modelSource === 'string' ? modelSource : ui.settings.modelUrl;
  const localFileName = modelSource instanceof File ? modelSource.name : modelSource === null ? ui.avatar.localFileName : null;

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    titleRef.current?.focus();
  }, [confirmEnd]);

  function close() {
    dialogRef.current?.close();
    onClose();
  }

  function cancel() {
    if (confirmEnd && entry.wasRunning) engine.startExperiment();
    close();
  }

  function changeModel(source: string | File) {
    const currentModel = source === ui.settings.modelUrl && ui.avatar.status === 'ready' && !ui.avatar.localFileName;
    setModelSource(currentModel ? null : source);
    setError('');
  }

  async function startNextRound(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (confirmEnd || loadingModel) return;
    const stageTimes = times.map(Number);
    if (stageTimes.some((time, index) => index > 0 && time < stageTimes[index - 1])) {
      setError('阶段开始时间须按顺序递增或相同。');
      return;
    }

    if (modelSource) {
      setLoadingModel(true);
      setError('');
      try {
        if (!await engine.loadModel(modelSource)) {
          setError(engine.store.get().avatar.error ?? '角色模型未能加载，请重试。');
          return;
        }
      } catch {
        setError('角色模型未能加载，请重试。');
        return;
      } finally {
        setLoadingModel(false);
      }
    }

    engine.updateSettings({
      ...avatarDraft,
      condition,
      version,
      stageTimes,
      transitionSec: Number(transition),
      manualTransitionSec: Number(manualTransition),
    });
    engine.resetExperiment();
    engine.startExperiment();
    close();
  }

  return (
    <dialog
      className="experiment-sheet"
      aria-labelledby="experiment-sheet-title"
      ref={dialogRef}
      onCancel={(event) => { event.preventDefault(); if (!loadingModel) cancel(); }}
    >
      <form className="experiment-sheet-layout" onSubmit={startNextRound}>
        <header className="experiment-sheet-header">
          <h2 id="experiment-sheet-title" ref={titleRef} tabIndex={-1}>{confirmEnd ? '结束本轮实验？' : '实验设置'}</h2>
          {!confirmEnd && <button type="button" className="btn ghost" disabled={loadingModel} onClick={close}>关闭</button>}
        </header>
        <div className="experiment-sheet-body">
          {confirmEnd ? (
            <p>计时已暂停 · 条件 {ui.settings.condition} · 已用 {formatTime(ui.experiment.time)}</p>
          ) : (
            <fieldset className="experiment-draft" disabled={loadingModel}>
              <label className="experiment-field">
                <span>实验条件</span>
                <select value={condition} onChange={(event) => setCondition(event.target.value as Condition)}>
                  <option value="A">A · 短视频 + Avatar</option>
                  <option value="B">B · 真人 + Avatar</option>
                  <option value="C">C · 仅 Avatar</option>
                </select>
              </label>
              <Section title="角色 Avatar" open={false}>
                <AvatarSettings
                  settings={avatarDraft}
                  condition={condition}
                  version={version}
                  models={ui.models}
                  modelUrl={modelUrl}
                  localFileName={localFileName}
                  onModelChange={changeModel}
                  onChange={(patch) => setAvatarDraft((current) => ({ ...current, ...patch }))}
                />
              </Section>
              <fieldset>
                <legend>阶段开始时间（秒）</legend>
                <div className="experiment-stage-times">
                  {times.map((time, index) => (
                    <label className="experiment-field" key={index}>
                      <span>Stage {index}</span>
                      <input
                        type="number"
                        inputMode="decimal"
                        min={index === 1 ? 0.1 : 0}
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
            </fieldset>
          )}
        </div>
        <footer className="experiment-sheet-actions">
          {confirmEnd ? (
            <>
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
              <button type="button" className="btn" onClick={cancel}>{entry.wasRunning ? '继续实验' : '保持暂停'}</button>
            </>
          ) : (
            <>
              {error && <p className="err" role="alert">{error}</p>}
              {loadingModel && <progress aria-label="角色模型加载进度" value={ui.avatar.progress} max={1} />}
              <button type="submit" className="btn primary" disabled={loadingModel}>{loadingModel ? '正在加载角色模型…' : '确认并开始'}</button>
            </>
          )}
        </footer>
      </form>
    </dialog>
  );
}
