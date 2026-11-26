import type { ModelEntry } from '../core/Engine';
import { DEFAULT_HEAD_LAYOUT, type Settings } from '../core/settings';
import { DEFAULT_LAYOUT } from '../render/AvatarRenderer';
import { Slider, Toggle } from './SettingFields';

type AvatarSettingValues = Pick<Settings, 'glasses' | 'layout' | 'headLayout'>;

interface ModelPickerProps {
  models: ModelEntry[];
  modelUrl: string;
  localFileName: string | null;
  onModelChange: (source: string | File) => void;
}

export function ModelPicker({ models, modelUrl, localFileName, onModelChange }: ModelPickerProps) {
  return (
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
  );
}

export function AvatarSettings({ condition, settings, onChange }: {
  condition: Settings['version'];
  settings: AvatarSettingValues;
  onChange: (patch: Partial<AvatarSettingValues>) => void;
}) {
  const { glasses, layout, headLayout } = settings;
  const setLayout = (patch: Partial<Settings['layout']>) => onChange({ layout: { ...layout, ...patch } });
  const setHead = (patch: Partial<Settings['headLayout']>) => onChange({ headLayout: { ...headLayout, ...patch } });
  const { zoom, offsetY, offsetX, yawDeg } = DEFAULT_LAYOUT;

  return (
    <>
      {condition === 'B' ? (
        <>
          <Slider label="贴脸大小" value={Math.round(headLayout.scale * 100)} min={60} max={300} step={1} fmt={(value) => `${value}%`} onChange={(value) => setHead({ scale: value / 100 })} />
          <Slider label="上下偏移" value={headLayout.offsetY} min={-0.6} max={0.6} step={0.01} onChange={(value) => setHead({ offsetY: value })} />
          <Slider label="左右偏移" value={headLayout.offsetX} min={-0.6} max={0.6} step={0.01} onChange={(value) => setHead({ offsetX: value })} />
          <p className="hint">100% 表示 Avatar 与用户的参考脸宽相同。看着摄像头画面调整大小和位置。</p>
          <button type="button" className="btn small" onClick={() => setHead(DEFAULT_HEAD_LAYOUT)}>恢复默认贴脸参数</button>
        </>
      ) : (
        <>
          <Slider label="角色缩放" value={layout.zoom} min={0.5} max={2} step={0.01} onChange={(value) => setLayout({ zoom: value })} />
          <Slider label="上下平移" value={layout.offsetY} min={-0.5} max={0.5} step={0.01} onChange={(value) => setLayout({ offsetY: value })} />
          <Slider label="左右平移" value={layout.offsetX} min={-0.5} max={0.5} step={0.01} onChange={(value) => setLayout({ offsetX: value })} />
          <Slider label="朝向" value={layout.yawDeg} min={-45} max={45} step={1} fmt={(value) => `${value.toFixed(0)}°`} onChange={(value) => setLayout({ yawDeg: value })} />
          <button type="button" className="btn small" onClick={() => setLayout({ zoom, offsetY, offsetX, yawDeg })}>恢复默认角色构图</button>
        </>
      )}
      <Toggle label="角色戴眼镜" checked={glasses[condition]} onChange={(value) => onChange({ glasses: { ...glasses, [condition]: value } })} />
    </>
  );
}

export function WindowLayoutFields({ layout, onChange }: { layout: Settings['layout']; onChange: (layout: Settings['layout']) => void }) {
  const { widthPct, heightPct, rightPct, bottomPct } = DEFAULT_LAYOUT;
  return (
    <>
      <Slider label="宽度" value={layout.widthPct} min={0.25} max={1} step={0.01} onChange={(value) => onChange({ ...layout, widthPct: value })} />
      <Slider label="高度" value={layout.heightPct} min={0.2} max={0.9} step={0.01} onChange={(value) => onChange({ ...layout, heightPct: value })} />
      <Slider label="右边距" value={layout.rightPct} min={0} max={0.5} step={0.005} onChange={(value) => onChange({ ...layout, rightPct: value })} />
      <Slider label="下边距" value={layout.bottomPct} min={0} max={0.5} step={0.005} onChange={(value) => onChange({ ...layout, bottomPct: value })} />
      <button type="button" className="btn small" onClick={() => onChange({ ...layout, widthPct, heightPct, rightPct, bottomPct })}>恢复默认小窗</button>
    </>
  );
}
