import { useEffect, useRef } from 'react';
import { engine, useUi } from './ui/engine';
import { ControlPanel } from './ui/ControlPanel';
import { TikTokFeed } from './ui/TikTokFeed';
import { STAGES } from './fatigue/stages';

export function App() {
  const ui = useUi();
  const stageRef = useRef<HTMLDivElement>(null);

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
  const showTikTok = ui.settings.condition === 'A';
  return (
    <div className={`app ${ui.panelVisible ? '' : 'presenting'}`}>
      <main className="stage">
        <div className="phone" ref={stageRef}>
          {showTikTok && <TikTokFeed />}
          {cam.status !== 'on' && (showTikTok || ui.settings.background === 'camera') && (
            <div className={`phone-overlay${showTikTok ? ' phone-overlay-corner' : ''}`}>
              <button className={`btn primary${showTikTok ? '' : ' big'}`} onClick={() => engine.startCamera()} disabled={cam.status === 'starting'}>
                {cam.status === 'starting' ? '正在开启摄像头…' : 'Start Camera 开启摄像头'}
              </button>
              {!showTikTok && <p className="privacy">画面只在本机浏览器内处理，不上传、不保存。</p>}
              {cam.error && <p className="err">{cam.error}</p>}
            </div>
          )}
          {cam.status === 'on' && !ui.tracker.face && ui.tracker.status === 'ready' && (
            <div className="chip warn">未检测到人脸</div>
          )}
          {ui.avatar.status === 'loading' && <div className="chip info">模型加载中 {Math.round(ui.avatar.progress * 100)}%</div>}
          {ui.recording.active && <div className="chip rec">● REC {ui.recording.seconds.toFixed(0)}s</div>}
        </div>
        {!ui.panelVisible && (
          <div className="present-hint">
            条件 {ui.settings.condition} · Stage {stage.id} · {stage.nameEn} · 按 H 显示控制面板
          </div>
        )}
      </main>
      {ui.panelVisible && <ControlPanel ui={ui} />}
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
