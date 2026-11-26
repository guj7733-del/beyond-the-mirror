import { useCallback, useEffect, useRef, useState } from 'react';
import { engine, useUi } from './ui/engine';
import { ControlPanel } from './ui/ControlPanel';
import { LocalVideos } from './ui/LocalVideos';
import { ExperimentHotspot, ExperimentSettings, type ExperimentSettingsEntry } from './ui/ExperimentSettings';
import { STAGES } from './fatigue/stages';

export function App() {
  const ui = useUi();
  const stageRef = useRef<HTMLDivElement>(null);
  const activeVideo = useRef<HTMLVideoElement>(null);
  const [settingsEntry, setSettingsEntry] = useState<ExperimentSettingsEntry | null>(null);

  const openSettings = useCallback(() => {
    const { status } = engine.store.get().experiment;
    if (status === 'running') engine.pauseExperiment();
    setSettingsEntry({ confirmEnd: status === 'running' || status === 'paused', wasRunning: status === 'running' });
  }, []);

  useEffect(() => {
    const host = stageRef.current;
    if (!host) return;
    const c = engine.compositor.canvas;
    c.className = 'composite';
    host.prepend(c);
    return () => {
      c.remove();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t instanceof Element && t.closest('.experiment-sheet[open]')) return;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === ' ') {
        e.preventDefault();
        engine.toggleExperiment();
      } else if (k === 'r') engine.resetExperiment();
      else if (k === 'c') engine.toggleCamera();
      else if (k === 'h') engine.togglePanel();
      else if (k === 'a') engine.setManualStage(null);
      else if (k === 'p') engine.snapshot();
      else if (k === 'v') engine.toggleRecording();
      else if (k === 'k') engine.calibrate();
      else if (k === 'm') engine.toggleVersion();
      else if (/^[0-5]$/.test(k)) engine.setManualStage(Number(k));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const cam = ui.camera;
  const stage = STAGES[ui.experiment.stage];
  const showsAvatar = ui.settings.condition !== 'C';
  return (
    <div className={`app ${ui.panelVisible ? '' : 'presenting'}`}>
      <main className="stage">
        <div className="phone" ref={stageRef}>
          <LocalVideos activeVideo={activeVideo} />
          {cam.status !== 'on' && (
            <div className="phone-overlay">
              <button className="btn primary" onClick={() => engine.startCamera()} disabled={cam.status === 'starting'}>
                {cam.status === 'starting' ? '正在开启摄像头…' : 'Start Camera 开启摄像头'}
              </button>
              {cam.error && <p className="err">{cam.error}</p>}
            </div>
          )}
          {showsAvatar && cam.status === 'on' && !ui.tracker.face && ui.tracker.status === 'ready' && (
            <div className="chip warn">未检测到人脸</div>
          )}
          {showsAvatar && ui.avatar.status === 'loading' && <div className="chip info">模型加载中 {Math.round(ui.avatar.progress * 100)}%</div>}
          {ui.recording.active && <div className="chip rec">● REC {ui.recording.seconds.toFixed(0)}s</div>}
          <ExperimentHotspot stageRef={stageRef} onOpen={openSettings} />
        </div>
        {!ui.panelVisible && (
          <div className="present-hint">
            条件 {ui.settings.condition} · Stage {stage.id} · {stage.nameEn} · 按 H 显示控制面板
          </div>
        )}
      </main>
      {ui.panelVisible && <ControlPanel ui={ui} onOpenSettings={openSettings} />}
      {settingsEntry && <ExperimentSettings ui={ui} entry={settingsEntry} activeVideo={activeVideo} onClose={() => setSettingsEntry(null)} />}
      {ui.message && <Toast key={ui.message.id} text={ui.message.text} kind={ui.message.kind} />}
    </div>
  );
}

function Toast({ text, kind }: { text: string; kind: 'info' | 'error' }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    const t = setTimeout(() => el?.classList.add('hide'), kind === 'error' ? 7000 : 3000);
    return () => clearTimeout(t);
  }, [kind]);
  return (
    <div ref={ref} className={`toast ${kind}`}>
      {text}
    </div>
  );
}
