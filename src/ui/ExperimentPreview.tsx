import { useEffect, useRef, useState, type RefObject } from 'react';
import type { UiState } from '../core/Engine';
import type { PresentationSettings } from '../core/settings';
import { STAGES } from '../fatigue/stages';
import { engine } from './engine';

interface ExperimentPreviewProps {
  settings: PresentationSettings;
  stage: number;
  onStageChange: (stage: number) => void;
  activeVideo: RefObject<HTMLVideoElement | null>;
  camera: UiState['camera'];
  tracker: UiState['tracker'];
}

export function ExperimentPreview({ settings, stage, onStageChange, activeVideo, camera, tracker }: ExperimentPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [showWindow, setShowWindow] = useState(settings.condition !== 'A');
  const { condition, layout } = settings;

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    const { canvas: composite, width, height } = engine.compositor;
    const region = showWindow ? engine.compositor.avatarRectFor(layout) : { x: 0, y: 0, w: width, h: height };
    const scale = 640 / Math.max(region.w, region.h);
    canvas.width = Math.round(region.w * scale);
    canvas.height = Math.round(region.h * scale);
    const sx = canvas.width / region.w;
    const sy = canvas.height / region.h;
    ctx.setTransform(sx, 0, 0, sy, -region.x * sx, -region.y * sy);

    let raf = 0;
    function draw() {
      ctx.fillStyle = '#000';
      ctx.fillRect(region.x, region.y, region.w, region.h);
      const video = activeVideo.current;
      if (video && video.readyState >= 2 && video.videoWidth && video.videoHeight) {
        const fit = Math.min(width / video.videoWidth, height / video.videoHeight);
        const w = video.videoWidth * fit;
        const h = video.videoHeight * fit;
        ctx.drawImage(video, (width - w) / 2, (height - h) / 2, w, h);
      }
      ctx.drawImage(composite, 0, 0);
      raf = requestAnimationFrame(draw);
    }
    draw();
    return () => cancelAnimationFrame(raf);
  }, [activeVideo, layout, showWindow]);

  const cameraOn = camera.status === 'on';
  const lookingForFace = condition === 'B' && cameraOn && !tracker.face;

  return (
    <section className="experiment-preview" aria-label="实时画面预览">
      <div className="preview-toolbar">
        <div className="row" role="group" aria-label="预览范围">
          <button type="button" className={`btn small ${showWindow ? '' : 'active'}`} aria-pressed={!showWindow} onClick={() => setShowWindow(false)}>全画面</button>
          <button type="button" className={`btn small ${showWindow ? 'active' : ''}`} aria-pressed={showWindow} onClick={() => setShowWindow(true)}>放大小窗</button>
        </div>
        {condition !== 'C' && (
          <select aria-label="预览阶段" value={stage} onChange={(event) => onStageChange(Number(event.target.value))}>
            {STAGES.map(({ id, nameZh }) => <option key={id} value={id}>Stage {id} · {nameZh}</option>)}
          </select>
        )}
      </div>
      <div className="preview-frame">
        <canvas ref={canvasRef} aria-label={showWindow ? '右下角小窗实时画面' : '实验全画面预览'} />
      </div>
      <div className="preview-camera">
        <button type="button" className="btn small" onClick={() => engine.toggleCamera()} disabled={camera.status === 'starting'}>
          {cameraOn ? '关闭摄像头' : camera.status === 'starting' ? '正在开启…' : '开启摄像头'}
        </button>
        {condition === 'B' && !cameraOn && !camera.error && <p className="hint">开启摄像头查看真人和 Avatar 的叠加。</p>}
        {lookingForFace && (
          <p className={tracker.error ? 'err' : 'hint'}>
            {tracker.error ?? (tracker.status === 'ready' ? '请看向镜头，检测到人脸后会显示 Avatar。' : '正在加载面捕…')}
          </p>
        )}
        {camera.error && <p role="alert" className="err">{camera.error}</p>}
      </div>
    </section>
  );
}
