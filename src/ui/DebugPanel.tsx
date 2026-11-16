import type { UiState } from '../core/Engine';

function Bar({ value, tone }: { value: number; tone: 'a' | 'b' }) {
  return (
    <span className={`bar ${tone}`}>
      <i style={{ width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` }} />
    </span>
  );
}

export function DebugPanel({ ui }: { ui: UiState }) {
  const t = ui.tracker;
  const r = ui.avatar.report;
  return (
    <div className="debug">
      <p className="mono small">
        渲染 {ui.renderFps} fps · 面捕 {t.status === 'ready' ? `${t.fps} fps（${t.delegate}，${t.ms} ms）` : t.status} · 人脸 {t.face ? '✓' : '✗'} · 可信度 {t.presence.toFixed(2)}
      </p>
      {t.error && <p className="err">{t.error}</p>}
      <p className="mono small">
        头部 yaw {ui.live.head.yaw.toFixed(1)}° · pitch {ui.live.head.pitch.toFixed(1)}° · roll {ui.live.head.roll.toFixed(1)}°
      </p>
      <table className="live">
        <thead>
          <tr>
            <th>通道</th>
            <th>面捕</th>
            <th>叠加疲惫后</th>
          </tr>
        </thead>
        <tbody>
          {ui.live.values.map((v) => (
            <tr key={v.name}>
              <td className="mono">{v.name}</td>
              <td>
                <Bar value={v.capture} tone="a" />
              </td>
              <td>
                <Bar value={v.final} tone="b" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {r && (
        <div className="report">
          <h3>模型检查</h3>
          <p className="small">
            {r.meta.title} · {r.meta.specVersion} · 作者 {r.meta.author} · 文件 {r.meta.fileName}
          </p>
          <details>
            <summary>授权字段（请人工核对）</summary>
            <table className="kv">
              <tbody>
                {r.meta.license.map((l) => (
                  <tr key={l.label}>
                    <td className="mono">{l.label}</td>
                    <td>{l.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
          <p className="small">
            ARKit 52 通道：直连 <b>{r.counts.direct}</b> · 预设回退 <b>{r.counts.fallback}</b> · 缺失 <b>{r.counts.missing}</b> · 模型表情共 {r.expressionNames.length} 个 · 眼部定位方式 {r.anchorsMethod}
          </p>
          {r.headOnly && (
            <p className="small">
              版本 B：隐藏 {r.headOnly.hidden} 个身体网格、保留 {r.headOnly.kept} 个网格（脸、头发等）；下巴{r.headOnly.chinMeasured ? '已测得' : '为估算值'}；脸宽 {r.headOnly.faceWidthCm} cm
            </p>
          )}
          {r.warnings.length > 0 && (
            <ul className="warnings">
              {r.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
          <details>
            <summary>骨骼检查</summary>
            <table className="kv">
              <tbody>
                {r.bones.map((b) => (
                  <tr key={b.name} className={b.present ? '' : b.level === 'optional' ? 'dim' : 'bad'}>
                    <td className="mono">{b.name}</td>
                    <td className="nowrap">{b.present ? '✓' : '✗'}</td>
                    <td className="nowrap">{b.level === 'required' ? '必需' : b.level === 'recommended' ? '推荐' : '可选'}</td>
                    <td>{b.usage}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
          <details>
            <summary>表情映射（MediaPipe → 模型）</summary>
            <table className="kv">
              <tbody>
                {r.channels.map((c) => (
                  <tr key={c.channel} className={c.kind === 'missing' ? 'bad' : c.kind === 'fallback' ? 'dim' : ''}>
                    <td className="mono">{c.channel}</td>
                    <td className="nowrap">{c.kind === 'direct' ? '直连' : c.kind === 'fallback' ? '回退' : '缺失'}</td>
                    <td className="mono">{c.targets.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {r.fallbackNotes.length > 0 && (
              <ul className="small">
                {r.fallbackNotes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            )}
            {r.extras.length > 0 && <p className="small">疲惫专用表情：{r.extras.join('；')}</p>}
          </details>
          <details>
            <summary>材质分组（调色用）</summary>
            <table className="kv">
              <tbody>
                {r.materials.map((m) => (
                  <tr key={m.name} className={m.patched ? '' : 'bad'}>
                    <td className="mono">{m.name}</td>
                    <td className="nowrap">{m.category}</td>
                    <td className="nowrap">{m.patched ? '可调色' : '不支持'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </div>
      )}
    </div>
  );
}
