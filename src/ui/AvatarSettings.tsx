import type { ReactNode } from 'react';
import type { ModelEntry } from '../core/Engine';
import { DEFAULT_HEAD_LAYOUT, type Settings } from '../core/settings';
import { DEFAULT_LAYOUT } from '../render/AvatarRenderer';
import { Slider, Toggle } from './SettingFields';

export type AvatarSettingValues = Pick<Settings, 'glasses' | 'layout' | 'headLayout'>;

interface AvatarSettingsProps {
  settings: AvatarSettingValues;
  condition: Settings['condition'];
  version: Settings['version'];
  models: ModelEntry[];
  modelUrl: string;
  localFileName: string | null;
  onModelChange: (source: string | File) => void;
  onChange: (patch: Partial<AvatarSettingValues>) => void;
  children?: ReactNode;
}

export function AvatarSettings({ settings, condition, version, models, modelUrl, localFileName, onModelChange, onChange, children }: AvatarSettingsProps) {
  const { glasses, layout, headLayout } = settings;
  const setLayout = (patch: Partial<Settings['layout']>) => onChange({ layout: { ...layout, ...patch } });
  const setHead = (patch: Partial<Settings['headLayout']>) => onChange({ headLayout: { ...headLayout, ...patch } });

  return (
    <>
      <div className="row avatar-model-picker">
        <select aria-label="角色模型" value={localFileName ? '' : modelUrl} onChange={(event) => onModelChange(event.target.value)}>
          {localFileName && <option value="" disabled>{localFileName}（本地文件）</option>}
          {models.map((model) => <option key={model.url} value={model.url}>{model.name}</option>)}
          {!models.some((model) => model.url === modelUrl) && <option value={modelUrl}>{modelUrl}</option>}
        </select>
        <label className="btn file">
          本地文件…
          <input
            type="file"
            accept=".vrm,.glb,.gltf"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onModelChange(file);
              event.target.value = '';
            }}
          />
        </label>
      </div>
      {children}
      <Toggle label={`角色戴眼镜（版本 ${version}）`} checked={!!glasses[version]} onChange={(value) => onChange({ glasses: { ...glasses, [version]: value } })} />
      {condition === 'A' ? (
        <>
          <Slider label="宽度" value={layout.widthPct} min={0.25} max={1} step={0.01} onChange={(value) => setLayout({ widthPct: value })} />
          <Slider label="高度" value={layout.heightPct} min={0.2} max={0.9} step={0.01} onChange={(value) => setLayout({ heightPct: value })} />
          <Slider label="右边距" value={layout.rightPct} min={0} max={0.5} step={0.005} onChange={(value) => setLayout({ rightPct: value })} />
          <Slider label="下边距" value={layout.bottomPct} min={0} max={0.5} step={0.005} onChange={(value) => setLayout({ bottomPct: value })} />
          <Slider label="角色缩放" value={layout.zoom} min={0.5} max={2} step={0.01} onChange={(value) => setLayout({ zoom: value })} />
          <Slider label="上下平移" value={layout.offsetY} min={-0.5} max={0.5} step={0.01} onChange={(value) => setLayout({ offsetY: value })} />
          <Slider label="左右平移" value={layout.offsetX} min={-0.5} max={0.5} step={0.01} onChange={(value) => setLayout({ offsetX: value })} />
          <Slider label="朝向" value={layout.yawDeg} min={-45} max={45} step={1} fmt={(value) => `${value.toFixed(0)}°`} onChange={(value) => setLayout({ yawDeg: value })} />
          <button type="button" className="btn small" onClick={() => onChange({ layout: { ...DEFAULT_LAYOUT } })}>
            恢复默认布局
          </button>
        </>
      ) : (
        <>
          <Slider label="头部大小" value={headLayout.scale} min={0.6} max={1.8} step={0.01} onChange={(value) => setHead({ scale: value })} />
          <Slider label="上下偏移" value={headLayout.offsetY} min={-0.6} max={0.6} step={0.01} onChange={(value) => setHead({ offsetY: value })} />
          <Slider label="左右偏移" value={headLayout.offsetX} min={-0.6} max={0.6} step={0.01} onChange={(value) => setHead({ offsetX: value })} />
          <p className="hint">头部按用户脸宽缩放，角色下巴对齐用户闭嘴时的下巴。没开摄像头时放在画面中央，方便预览；摄像头开着但没检测到人脸时，头部会淡出。</p>
          <button type="button" className="btn small" onClick={() => onChange({ headLayout: { ...DEFAULT_HEAD_LAYOUT } })}>
            恢复默认
          </button>
        </>
      )}
    </>
  );
}
