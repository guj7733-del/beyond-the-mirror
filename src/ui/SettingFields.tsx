import type { ReactNode } from 'react';

export function Section({ title, sub, children, open = true }: { title: string; sub?: string; children: ReactNode; open?: boolean }) {
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

export function Slider(props: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; fmt?: (v: number) => string }) {
  return (
    <label className="slider">
      <span className="slider-label">{props.label}</span>
      <input type="range" aria-label={props.label} aria-valuetext={props.fmt?.(props.value)} min={props.min} max={props.max} step={props.step} value={props.value} onChange={(e) => props.onChange(Number(e.target.value))} />
      <span className="slider-value">{props.fmt ? props.fmt(props.value) : props.value.toFixed(2)}</span>
    </label>
  );
}

export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}
