import { createRoot } from 'react-dom/client';
import { App } from './App';
import { engine } from './ui/engine';
import './styles.css';
import { ARM_POSES } from './avatar/PoseDriver';
import { STAGES } from './fatigue/stages';

createRoot(document.getElementById('root')!).render(<App />);
engine.start();

// 方便在浏览器控制台调试：window.bm.debugState()
(window as unknown as { bm: typeof engine }).bm = engine;
if (import.meta.env.DEV) {
  (window as unknown as { __bmDev: unknown }).__bmDev = { ARM_POSES, STAGES };
}
