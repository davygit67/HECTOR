// Studio primitives. Screens compose these instead of styling controls individually; see system.css.
import React, { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import './system.css';

const arc = <><path d="M3 8a5 5 0 1 0 1.6-3.7"/><path d="M3.5 2.5v2.8h2.8"/></>;
const glyphs = {
  plus: <path d="M8 3v10M3 8h10"/>,
  visible: <circle cx="8" cy="8" r="3.5" fill="currentColor"/>,
  hidden: <circle cx="8" cy="8" r="3.5"/>,
  locked: <><rect x="3.5" y="7" width="9" height="6.5" rx="1"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/></>,
  unlocked: <><rect x="3.5" y="7" width="9" height="6.5" rx="1"/><path d="M5.5 7V5a2.5 2.5 0 0 1 4.9-.7"/></>,
  undo: <><path d="M6 3.5 3 6.5l3 3"/><path d="M3 6.5h6.5a3.5 3.5 0 0 1 0 7H7"/></>,
  redo: <><path d="m10 3.5 3 3-3 3"/><path d="M13 6.5H6.5a3.5 3.5 0 0 0 0 7H9"/></>,
  ccw: arc,
  cw: <g transform="matrix(-1 0 0 1 16 0)">{arc}</g>,
  play: <path d="M5 3.5v9l7.5-4.5z" fill="currentColor"/>,
  pause: <path d="M5.5 3.5v9M10.5 3.5v9" strokeWidth="2"/>,
  restart: <><path d="M4 3.5v9"/><path d="M12.5 3.5v9L6 8z" fill="currentColor"/></>,
  chevron: <path d="m6 4 4 4-4 4"/>,
  frame: <rect x="3" y="4.5" width="10" height="7" rx=".5"/>
};
export type IconName = keyof typeof glyphs;
export function Icon({ name }: { name: IconName }) { return <svg className="glyph" viewBox="0 0 16 16" aria-hidden="true" focusable="false">{glyphs[name]}</svg>; }

export function Tabs<T extends string>({ label, items, value, onChange, names }: { label: string; items: readonly T[]; value: T; onChange: (item: T) => void; names?: Record<T, string> }) {
  return <nav className="tabs" aria-label={label}>{items.map(item => <button key={item} aria-pressed={item === value} onClick={() => onChange(item)}>{names?.[item] ?? item}</button>)}</nav>;
}
export function Segmented<T extends string | number>({ label, value, options, onChange, disabled = false, small = false }: { label: string; value: T; options: readonly { value: T; label: string }[]; onChange: (value: T) => void; disabled?: boolean; small?: boolean }) {
  const name = useId();
  return <div role="radiogroup" aria-label={label} className={small ? 'segmented small' : 'segmented'}>{options.map(o => <label className="segment" key={o.value}>
    <input type="radio" name={name} checked={o.value === value} disabled={disabled} onChange={() => onChange(o.value)}/>{o.label}</label>)}</div>;
}
/** An on/off key for immediate studio state. Staged scene booleans use Toggle. */
export function Switch({ label, pressed, onClick, title }: { label: string; pressed: boolean; onClick: () => void; title?: string }) {
  return <button type="button" className="switch" aria-pressed={pressed} title={title} onClick={onClick}><span className="switch-track" aria-hidden="true"/>{label}</button>;
}
export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="switch"><input type="checkbox" className="sr" checked={checked} onChange={e => onChange(e.target.checked)}/><span className="switch-track" aria-hidden="true"/>{label}</label>;
}
export function Lamp({ tone, children }: { tone?: 'ok' | 'signal'; children: ReactNode }) { return <span className={tone ? `lamp ${tone}` : 'lamp'}>{children}</span>; }
export function Section({ title, count, action, children }: { title: string; count?: number; action?: ReactNode; children: ReactNode }) {
  return <section className="section"><header className="section-head"><span className="label">{title}{count !== undefined && <b className="count">{String(count).padStart(2, '0')}</b>}</span>{action}</header>{children}</section>;
}
export function Banner({ role, onDismiss, children }: { role?: 'alert' | 'status'; onDismiss?: () => void; children: ReactNode }) {
  return <div role={role} className="banner"><span>{children}</span>{onDismiss && <button className="quiet" onClick={onDismiss}>Dismiss</button>}</div>;
}
export function Dialog({ id, title, className, children }: { id: string; title: string; className?: string; children: ReactNode }) {
  return <div className="backdrop"><div role="dialog" aria-modal="true" aria-labelledby={id} className={className ? `modal ${className}` : 'modal'}><h2 id={id}>{title}</h2>{children}</div></div>;
}

type NumberProps = { label: string; value: number; onChange: (n: number) => void; min?: number; max?: number; step?: number; disabled?: boolean };
/** Commits on blur or Enter, so typing never floods the undo history. `bare` renders the input alone, labelled for assistive tech only. */
export function NumberField({ label, value, onChange, min, max, step = 1, disabled = false, bare = false }: NumberProps & { bare?: boolean }) {
  const input = <input type="number" aria-label={label} key={value} defaultValue={Number(value.toFixed(3))} min={min} max={max} step={step} disabled={disabled}
    onBlur={event => { const n = event.currentTarget.valueAsNumber; if (Number.isFinite(n) && n !== value) onChange(n); }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} />;
  return bare ? input : <label className="field"><span>{label}</span>{input}</label>;
}
/** A slider with an editable readout shown in display units (`value × scale`). */
export function SliderField({ label, value, onChange, min, max, step, scale = 1, unit = '' }: Required<Pick<NumberProps, 'min' | 'max' | 'step'>> & NumberProps & { scale?: number; unit?: string }) {
  const [draft, setDraft] = useState(value), range = useRef<HTMLInputElement>(null), latest = useRef({ value, onChange });
  latest.current = { value, onChange };
  useEffect(() => setDraft(value), [value]);
  // One command per gesture: the native change event fires on release or per key step, never per pointer move.
  useEffect(() => {
    const element = range.current!, commit = () => { const n = element.valueAsNumber; if (n !== latest.current.value) latest.current.onChange(n); };
    element.addEventListener('change', commit); return () => element.removeEventListener('change', commit);
  }, []);
  const display = (n: number) => Number((n * scale).toFixed(2));
  return <div className="slider">
    <div className="slider-head"><span className="label">{label}</span><span className="slider-value"><NumberField bare label={`${label} value`} value={display(draft)} min={display(min)} max={display(max)} step={display(step)} onChange={n => onChange(n / scale)}/><small>{unit}</small></span></div>
    <input ref={range} type="range" aria-label={label} min={min} max={max} step={step} value={draft} style={{ '--fill': `${(draft - min) / (max - min) * 100}%` } as React.CSSProperties} onChange={e => setDraft(e.currentTarget.valueAsNumber)}/>
    <div className="slider-scale" aria-hidden="true"><span>{display(min)}</span><span>{display(max)}</span></div>
  </div>;
}
