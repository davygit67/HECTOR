import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { CaptureChoice, Request, Snapshot } from './core/bridge';
import { newSurface, surfaceSchema, type Point, type Scene, type Source, type Surface } from './core/model';
import { ProjectionRenderer, type Diagnostics } from './render/renderer';
import './style.css';

const isOutput = new URLSearchParams(location.search).has('output');
const emptyDiagnostics: Diagnostics = { fps: 0, slowFrames: 0, videoDropped: 0, errors: [] };
function Viewport({ scene, snapshot, quality, onDiagnostics, onError }: { scene: Scene; snapshot: Snapshot; quality: number; onDiagnostics: (d: Diagnostics) => void; onError: (e: string) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null), renderer = useRef<ProjectionRenderer | null>(null);
  useEffect(() => {
    try {
      const instance = renderer.current = new ProjectionRenderer(canvas.current!, isOutput, onDiagnostics);
      window.hectorProbe = { snapshot: () => instance.probe(), startTrace: () => instance.startTrace(), stopTrace: () => instance.stopTrace() };
    }
    catch (e) { onError(String(e)); }
    const lost = (event: Event) => { event.preventDefault(); onError('GPU context lost. Close and reopen output, or restart HECTOR after saving.'); };
    const element = canvas.current!; element.addEventListener('webglcontextlost', lost);
    return () => { element.removeEventListener('webglcontextlost', lost); renderer.current?.dispose(); };
  }, [onDiagnostics, onError]);
  useEffect(() => { renderer.current?.update(scene, snapshot.assets, snapshot.captures, snapshot.transport, isOutput && snapshot.output.blackout); }, [scene, snapshot]);
  useEffect(() => { renderer.current?.setQuality(quality); }, [quality]);
  return <canvas ref={canvas} className="projection" aria-label={isOutput ? 'Projection output' : 'Draft preview'} />;
}
function NumberField({ label, value, onChange, min, max, step = 1, disabled = false }: { label: string; value: number; onChange: (n: number) => void; min?: number; max?: number; step?: number; disabled?: boolean }) {
  return <label className="field"><span>{label}</span><input type="number" aria-label={label} key={value} defaultValue={Number(value.toFixed(3))} min={min} max={max} step={step} disabled={disabled}
    onBlur={event => { const n = event.currentTarget.valueAsNumber; if (Number.isFinite(n) && n !== value) onChange(n); }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></label>;
}
function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null), [error, setError] = useState('');
  const [selected, setSelected] = useState('surface-1'), [tab, setTab] = useState('Layers'), [inspector, setInspector] = useState('Transform');
  const [diagnostics, setDiagnostics] = useState(emptyDiagnostics), [display, setDisplay] = useState<number | null>(null);
  const [quality, setQuality] = useState(isOutput ? 1 : .65), [switchDialog, setSwitchDialog] = useState(false), [ai, setAi] = useState(false);
  const [left, setLeft] = useState(true), [right, setRight] = useState(true), [collapsed, setCollapsed] = useState<string[]>([]);
  const [dragCorners, setDragCorners] = useState<Surface['corners'] | null>(null), [corner, setCorner] = useState(0), [pending, setPending] = useState(false);
  const gesture = useRef<{ surface: Surface; index: number; start: Point; corners: Surface['corners'] } | null>(null);
  const svg = useRef<SVGSVGElement>(null), reported = useRef('');
  const [setupName, setSetupName] = useState(''), [picker, setPicker] = useState<{ replace?: string } | null>(null);
  const [choices, setChoices] = useState<CaptureChoice[] | null>(null), [pickerTab, setPickerTab] = useState<'screen' | 'window'>('screen');
  const onError = useCallback((message: string) => setError(message), []);
  useEffect(() => {
    if (!window.hector) { setError('HECTOR requires its desktop host. Launch with npm run dev.'); return; }
    const unsubscribe = window.hector.subscribe(setSnapshot);
    void window.hector.snapshot().then(setSnapshot).catch(e => setError(String(e))); return unsubscribe;
  }, []);
  const send = useCallback(async (request: Request) => {
    if (!window.hector) return false;
    setPending(true);
    try { const result = await window.hector.request(request); if (!result.ok) setError(result.error ?? 'Operation failed'); else setError(''); return result.ok; }
    catch (e) { setError(String(e)); return false; } finally { setPending(false); }
  }, []);
  const update = (patch: Partial<Omit<Surface, 'id'>>) => { if (selected) void send({ type: 'command', command: { type: 'surface.update', id: selected, patch } }); };
  const state = snapshot?.session, scene = state?.draft, surface = scene?.surfaces.find(s => s.id === selected), source = scene?.sources.find(s => s.id === surface?.sourceId);
  useEffect(() => {
    if (isOutput) return;
    const keydown = (event: KeyboardEvent) => {
      // Shortcuts work while a button has focus; only text entry keeps its own keys.
      if ((event.target as HTMLElement).closest('input, textarea, select') || switchDialog || picker) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); void send({ type: event.shiftKey ? 'redo' : 'undo' }); }
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void send({ type: state?.mode === 'preview' ? 'apply' : 'save' }); }
      else if (surface && !surface.locked && scene && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault(); const amount = event.shiftKey ? 10 : 1;
        const dx = (event.key === 'ArrowRight' ? amount : event.key === 'ArrowLeft' ? -amount : 0) / scene.width;
        const dy = (event.key === 'ArrowDown' ? amount : event.key === 'ArrowUp' ? -amount : 0) / scene.height;
        void send({ type: 'command', command: { type: 'surface.nudge', id: surface.id, corner, dx, dy } });
      }
    };
    window.addEventListener('keydown', keydown); return () => window.removeEventListener('keydown', keydown);
  }, [surface, scene, corner, send, state?.mode, switchDialog, picker]);
  // Output forwards its media/capture problems so the operator sees them in the studio.
  useEffect(() => {
    if (!isOutput || !window.hector) return;
    const errors = [...new Set(diagnostics.errors)].slice(0, 16).map(e => e.slice(0, 300)), key = JSON.stringify(errors);
    if (key !== reported.current) { reported.current = key; window.hector.report({ errors }); }
  }, [diagnostics]);
  const listCaptures = useCallback(async () => {
    setChoices(null);
    try { const result = await window.hector!.request({ type: 'capture.sources' }); if (!result.ok) setError(result.error ?? 'Capture sources unavailable'); setChoices(result.choices ?? []); }
    catch (e) { setError(String(e)); setChoices([]); }
  }, []);
  const openPicker = (replace?: string) => { setPicker({ replace }); void listCaptures(); };
  if (!snapshot || !scene || !state) return <div className="loading"><b>HECTOR</b><p>{error || 'Opening projection studio…'}</p></div>;
  if (isOutput) return <main className="output"><Viewport scene={state.applied} snapshot={snapshot} quality={1} onDiagnostics={setDiagnostics} onError={onError} /></main>;
  const selectedDisplay = display ?? snapshot.displays.find(d => !d.primary)?.id ?? snapshot.displays[0]?.id;
  const previewScene = dragCorners && surface ? { ...scene, surfaces: scene.surfaces.map(s => s.id === surface.id ? { ...s, corners: dragCorners } : s) } : scene;
  const point = (event: React.PointerEvent): Point => { const bounds = svg.current!.getBoundingClientRect(); return [(event.clientX - bounds.left) / bounds.width, (event.clientY - bounds.top) / bounds.height]; };
  const dragStart = (event: React.PointerEvent, item: Surface, index: number) => {
    event.stopPropagation(); setSelected(item.id); svg.current?.focus(); if (item.locked || pending) return;
    setCorner(Math.max(0, index)); gesture.current = { surface: item, index, start: point(event), corners: structuredClone(item.corners) };
    svg.current!.setPointerCapture(event.pointerId);
  };
  const finishDrag = () => {
    const current = gesture.current; gesture.current = null;
    // Keep the dragged shape until the committed edit arrives, so the surface never snaps back mid-request.
    if (current && dragCorners) void send({ type: 'command', command: { type: 'surface.update', id: current.surface.id, patch: { corners: dragCorners } } }).finally(() => setDragCorners(null));
    else setDragCorners(null);
  };
  const sourceUpdate = (patch: Partial<Source>) => { if (source) void send({ type: 'command', command: { type: 'source.put', source: { ...source, ...patch } } }); };
  const transform = (rotate: number, scale: number) => { if (surface) void send({ type: 'command', command: { type: 'surface.transform', id: surface.id, rotate, scale } }); };
  const createSource = (kind: 'gradient' | 'grid' | 'clock') => void send({ type: 'command', command: { type: 'source.put', source: { id: crypto.randomUUID(), name: kind === 'clock' ? 'Elapsed clock' : kind === 'grid' ? 'Calibration grid' : 'Aurora gradient', kind, color: '#8f72ff', loop: true, speed: 1, volume: 0 } } });
  const groups = [...new Set(scene.surfaces.map(s => s.group))];
  return <div className="app">
    <header className="topbar"><div className="brand"><span className="brandmark">H</span> HECTOR <small>STUDIO</small></div>
      <div className="mode"><span className={state.mode === 'live' ? 'dot live' : 'dot'} /><select aria-label="Editing mode" value={state.mode} disabled={pending} onChange={e => {
        if (e.target.value === 'live' && state.unapplied) setSwitchDialog(true); else void send({ type: 'mode', mode: e.target.value as 'live' | 'preview' });
      }}><option value="preview">Preview & Apply</option><option value="live">Live Edit</option></select></div>
      <span className="change-status">{state.unapplied ? 'Unapplied' : 'Applied'}<i>·</i>{state.unsaved ? 'Unsaved' : 'Saved'}</span>
      <button className="primary" disabled={pending} onClick={() => void send({ type: state.mode === 'preview' ? 'apply' : 'save' })}>{state.mode === 'preview' ? 'Apply & Save' : 'Save'}</button>
      <div className="output-controls"><select aria-label="Output display" value={selectedDisplay} onChange={e => setDisplay(Number(e.target.value))}>{snapshot.displays.map(d => <option key={d.id} value={d.id}>{d.primary ? 'Laptop · ' : ''}{d.label} · {d.width}×{d.height}</option>)}</select>
        <button disabled={pending} onClick={() => void send({ type: 'output', displayId: selectedDisplay, fullscreen: !snapshot.output.fullscreen })}>{snapshot.output.fullscreen ? 'Windowed' : 'Full screen'}</button>
        <button className={snapshot.output.blackout ? 'blackout active' : 'blackout'} title="Immediate operational control; playback continues" onClick={() => void send({ type: 'blackout', value: !snapshot.output.blackout })}>{snapshot.output.blackout ? 'Restore output' : 'Blackout'}</button></div>
    </header>
    <div className="projectbar"><div><input aria-label="Project name" key={scene.name} defaultValue={scene.name} onBlur={e => { if (e.target.value !== scene.name) void send({ type: 'command', command: { type: 'scene.rename', name: e.target.value } }); }} /><span className="badge">WORKING MILESTONE · 0.1</span></div>
      <div className="row"><button onClick={() => void send({ type: 'open' })}>Open project</button><button title="Export draft plus media into a portable project" onClick={() => void send({ type: 'export' })}>Export portable</button><button onClick={() => setAi(!ai)}>AI assistant</button></div></div>
    {error && <div role="alert" className="error"><span>{error}</span><button onClick={() => setError('')}>Dismiss</button></div>}
    {snapshot.output.errors.length > 0 && <div role="status" className="error">Output: {snapshot.output.errors.join(' · ')}</div>}
    {snapshot.output.disconnected && <div className="error">Output display disconnected. Output is hidden and blacked out. Select a display, reopen output, then Restore output.</div>}
    <div className="workspace">
      {left && <aside className="left-panel"><nav className="tabs">{['Media', 'Layers', 'Setups'].map(t => <button className={tab === t ? 'selected' : ''} key={t} onClick={() => setTab(t)}>{t}</button>)}</nav>
        {tab === 'Layers' && <><div className="panel-heading"><span>SURFACES <b>{scene.surfaces.length}</b></span><button title="Add surface" onClick={async () => { const id = crypto.randomUUID(); if (await send({ type: 'command', command: { type: 'surface.add', surface: newSurface(id, `Surface ${String(scene.surfaces.length+1).padStart(2,'0')}`, scene.sources[0]?.id ?? null) } })) setSelected(id); }}>+</button></div>
          <div className="layer-list">{groups.map(group => <section key={group}>{group && <button className="group" onClick={() => setCollapsed(collapsed.includes(group) ? collapsed.filter(g => g !== group) : [...collapsed,group])}>{collapsed.includes(group) ? '▸' : '▾'} {group}</button>}
            {!collapsed.includes(group) && [...scene.surfaces].reverse().filter(s => s.group === group).map((s) => <div className={'layer '+(s.id === selected ? 'selected' : '')} key={s.id}>
              <button className="layer-name" onClick={() => setSelected(s.id)}><span className="surface-icon">◇</span><span>{s.name}<small>{scene.sources.find(m => m.id === s.sourceId)?.name ?? 'No source'}</small></span></button>
              <button aria-label={`Visibility ${s.name}`} disabled={s.locked} onClick={() => void send({ type: 'command', command: { type: 'surface.update', id: s.id, patch: { visible: !s.visible } } })}>{s.visible ? '◉' : '○'}</button>
              <button aria-label={`Lock ${s.name}`} title={s.locked ? 'Unlock' : 'Lock'} onClick={() => void send({ type: 'command', command: { type: 'surface.update', id: s.id, patch: { locked: !s.locked } } })}>{s.locked ? '■' : '□'}</button></div>)}</section>)}</div>
          <div className="panel-note">Layers composite from bottom to top. Select a corner and use arrow keys to nudge; Shift moves 10 pixels.</div></>}
        {tab === 'Media' && <div className="panel-content"><button className="import" onClick={() => void send({ type: 'import' })}>＋ Import images / videos</button><div className="media-grid">{scene.sources.map(s => <div className="media-card" key={s.id}><div className={'thumbnail '+s.kind}>{s.kind === 'video' ? '▶' : s.kind === 'clock' ? '00:00' : s.kind === 'image' ? '▧' : s.kind === 'capture' ? 'LIVE' : '✧'}</div><b>{s.name}</b><small>{s.kind === 'capture' ? (s.captureId && snapshot.captures[s.captureId] ? `LIVE ${snapshot.captures[s.captureId].kind.toUpperCase()} CAPTURE` : 'CAPTURE · NOT CONNECTED') : s.kind.toUpperCase()}</small><button disabled={!surface || surface.locked} onClick={() => update({ sourceId: s.id })}>Use on surface</button>{s.assetId && <button onClick={() => void send({ type: 'relink', assetId: s.assetId! })}>{snapshot.assets[s.assetId]?.missing ? 'Missing · Relink' : 'Relink file'}</button>}{s.kind === 'capture' && <button onClick={() => openPicker(s.id)}>{s.captureId && snapshot.captures[s.captureId] ? 'Change capture source' : 'Choose capture source'}</button>}<button className="subtle" onClick={() => void send({ type: 'command', command: { type: 'source.remove', id: s.id } })}>Remove source</button></div>)}</div>
          <p className="eyebrow">GENERATORS</p><div className="stack"><button onClick={() => createSource('gradient')}>＋ Aurora gradient</button><button onClick={() => createSource('grid')}>＋ Calibration grid</button><button onClick={() => createSource('clock')}>＋ Elapsed clock</button></div>
          <p className="eyebrow">LIVE SOURCES</p><button onClick={() => openPicker()}>＋ Screen / window capture</button><p className="hint">Video only, no audio. Captures do not resume automatically after a restart; reconnect them here.{snapshot.platform === 'darwin' && snapshot.captureAccess !== 'granted' ? ' macOS needs Screen Recording permission (System Settings › Privacy & Security).' : ''}</p>
          <p className="eyebrow">PLANNED SOURCES</p><button disabled>YouTube / live stream</button><p className="hint">Sandboxed service playback adapter pending. No URL is downloaded or played.</p></div>}
        {tab === 'Setups' && <div className="panel-content"><p className="hint">Named snapshots of the draft. Recall follows the current editing mode.</p><label className="field"><span>Setup name</span><input aria-label="Setup name" value={setupName} placeholder={scene.name} maxLength={80} onChange={e => setSetupName(e.target.value)}/></label><button className="primary" onClick={async () => { if (await send({ type: 'setup.save', name: setupName.trim() || scene.name })) setSetupName(''); }}>Save named setup</button>{snapshot.setups.map(name => <button className="setup" key={name} onClick={() => void send({ type: 'setup.load', name })}><span>▧ {name}</span><small>Recall</small></button>)}<p className="hint">Names may contain letters, numbers, spaces, underscores and hyphens. Portable export copies media; named setups reference local files.</p></div>}
        <div className="sidebar-bottom"><span className="dot live"/> LOCAL WORKSPACE <button onClick={() => setLeft(false)} aria-label="Collapse library">‹</button></div>
      </aside>}
      <main className="center"><div className="canvas-toolbar"><div className="row">{!left && <button onClick={() => setLeft(true)}>Library ›</button>}<span className="eyebrow">MAPPING CANVAS</span><span className="badge">DRAFT</span></div><div className="row"><button disabled={!state.canUndo || pending} onClick={() => void send({ type: 'undo' })}>↶ Undo</button><button disabled={!state.canRedo || pending} onClick={() => void send({ type: 'redo' })}>↷ Redo</button><button disabled={!state.unapplied || pending} onClick={() => void send({ type: 'discard' })}>Discard</button><button onClick={() => setRight(!right)}>{right ? 'Hide inspector' : 'Inspector ‹'}</button></div></div>
        <div className="canvas-space"><div className="canvas-label"><span>{scene.width} × {scene.height}</span><span>{state.mode === 'preview' ? 'Changes stay here until applied' : 'LIVE · changes publish immediately'}</span></div>
          <div className="canvas-frame" style={{ aspectRatio: `${scene.width}/${scene.height}` }}><Viewport scene={previewScene} snapshot={snapshot} quality={quality} onDiagnostics={setDiagnostics} onError={onError}/>
            <svg ref={svg} className="handles" tabIndex={0} aria-label="Mapping canvas" viewBox="0 0 1920 1080" preserveAspectRatio="none" onPointerMove={event => {
              const current = gesture.current; if (!current) return; const p = point(event), delta: Point = [p[0]-current.start[0],p[1]-current.start[1]];
              const factor = event.altKey ? .1 : 1;
              const corners = current.corners.map((c,i) => current.index < 0 || i === current.index ? [c[0]+delta[0]*factor,c[1]+delta[1]*factor] : [...c]) as Surface['corners'];
              if (surfaceSchema.safeParse({ ...current.surface, corners }).success) setDragCorners(corners);
            }} onPointerUp={finishDrag} onPointerCancel={() => { gesture.current = null; setDragCorners(null); }}>
              {previewScene.surfaces.filter(s => s.visible).map(s => <g key={s.id}><polygon points={s.corners.map(([x,y]) => `${x*1920},${y*1080}`).join(' ')} className={s.id === selected ? 'outline selected' : 'outline'} onPointerDown={e => dragStart(e,s,-1)}/>
                {s.id === selected && s.corners.map(([x,y],i) => <g key={i}><circle cx={x*1920} cy={y*1080} r={i === corner ? 12 : 9} className="handle" onPointerDown={e => dragStart(e,s,i)}/><text x={x*1920+22} y={y*1080-20}>{i+1}</text></g>)}</g>)}</svg>
          </div><div className="canvas-caption"><span>Drag surface to move · Drag corners to warp · Alt-drag for fine adjustment</span><span>{surface?.locked ? 'LOCKED' : 'SELECT / WARP'}</span></div></div>
        <div className="canvas-status"><span><span className="dot live"/>{snapshot.output.open ? snapshot.output.blackout ? 'OUTPUT BLACKED OUT' : 'OUTPUT CONNECTED' : 'OUTPUT CLOSED'}</span><label>Preview <select aria-label="Preview quality" value={quality} onChange={e => setQuality(Number(e.target.value))}><option value={.4}>Low</option><option value={.65}>Balanced</option><option value={1}>Full</option></select></label><span>{diagnostics.fps.toFixed(1)} preview fps · {diagnostics.slowFrames} frames &gt;25 ms · {diagnostics.videoDropped} video drops</span></div>
      </main>
      {right && <aside className="right-panel"><div className="inspector-title"><span className="surface-icon">◇</span><div><b>{surface?.name ?? 'No surface selected'}</b><small>{surface?.locked ? 'Locked surface' : 'Quad surface'}</small></div></div><nav className="tabs">{['Transform','Crop','Effects'].map(t => <button className={inspector === t ? 'selected' : ''} key={t} onClick={() => setInspector(t)}>{t}</button>)}</nav>
        {surface && <div className="panel-content"><fieldset disabled={surface.locked || pending}>
          {inspector === 'Transform' && <><label className="field"><span>Name</span><input aria-label="Surface name" key={surface.name} defaultValue={surface.name} onBlur={e => { if (e.target.value !== surface.name) update({ name: e.target.value }); }}/></label><label className="field"><span>Source</span><select value={surface.sourceId ?? ''} onChange={e => update({ sourceId: e.target.value || null })}><option value="">None</option>{scene.sources.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
            <p className="eyebrow">CORNERS · OUTPUT PIXELS</p>{surface.corners.map((p,i) => <div className="corner-row" key={i}><button className={corner === i ? 'corner-index selected' : 'corner-index'} onClick={() => setCorner(i)}>{i+1}</button>{[0,1].map(axis => <NumberField key={axis} label={axis ? `Y${i+1}` : `X${i+1}`} value={p[axis]*(axis ? scene.height : scene.width)} onChange={n => { const corners = structuredClone(surface.corners); corners[i][axis] = n/(axis ? scene.height : scene.width); update({ corners }); }}/>)}</div>)}
            <div className="row transform-actions"><button onClick={() => transform(-Math.PI/12,1)}>↶ 15°</button><button onClick={() => transform(Math.PI/12,1)}>↷ 15°</button><button onClick={() => transform(0,.95)}>−5%</button><button onClick={() => transform(0,1.05)}>+5%</button></div>
            <label className="field"><span>Group</span><input key={surface.group} defaultValue={surface.group} placeholder="Ungrouped" onBlur={e => update({ group: e.target.value })}/></label><div className="row"><button onClick={() => void send({ type: 'command', command: { type: 'surface.move', id: surface.id, direction: 1 } })}>Move up</button><button onClick={() => void send({ type: 'command', command: { type: 'surface.move', id: surface.id, direction: -1 } })}>Move down</button></div><button className="danger-text" onClick={() => void send({ type: 'command', command: { type: 'surface.remove', id: surface.id } })}>Delete surface</button></>}
          {inspector === 'Crop' && <><p className="hint">Trim the source before warping. Values are percentages from each edge.</p>{['Left','Top','Right','Bottom'].map((label,i) => <NumberField key={label} label={label} value={surface.crop[i]*100} min={0} max={95} onChange={n => { const crop = [...surface.crop] as Surface['crop']; crop[i] = n/100; update({ crop }); }}/>)}</>}
          {inspector === 'Effects' && <><NumberField label="Opacity" value={surface.opacity} min={0} max={1} step={.05} onChange={opacity => update({ opacity })}/><NumberField label="Brightness" value={surface.brightness} min={0} max={2} step={.05} onChange={brightness => update({ brightness })}/><NumberField label="Saturation" value={surface.saturation} min={0} max={2} step={.05} onChange={saturation => update({ saturation })}/><label className="field"><span>Mask</span><select value={surface.mask} onChange={e => update({ mask: e.target.value as Surface['mask'] })}><option value="none">None</option><option value="ellipse">Ellipse</option></select></label>{source && <label className="field"><span>Generator color</span><input type="color" value={source.color} onChange={e => sourceUpdate({ color: e.target.value })}/></label>}<p className="hint">Effects and crop are scene edits. They publish only on Apply in Preview mode.</p><button disabled>Ambient backlight</button><p className="hint">Source-color sampling and spatial light compositing are planned.</p></>}
        </fieldset><div className="inspector-divider"/><p className="eyebrow">SOURCE SETTINGS · STAGED</p>{source?.kind === 'capture' ? <p className="hint">Live capture is always running: play/pause, seek, loop, speed and volume do not apply, and no audio is captured. Crop, effects, masks and layering work as for any source.</p> : source ? <><NumberField label="Playback speed" value={source.speed} min={.1} max={4} step={.1} onChange={speed => sourceUpdate({ speed })}/><NumberField label="Output volume" value={source.volume} min={0} max={1} step={.05} onChange={volume => sourceUpdate({ volume })}/><label className="check"><input type="checkbox" checked={source.loop} onChange={e => sourceUpdate({ loop: e.target.checked })}/> Loop media</label><p className="hint">Studio preview is always muted. Output starts muted until volume is changed and applied.</p></> : <p className="hint">Assign a source from the Media library.</p>}</div>}
      </aside>}
    </div>
    {diagnostics.errors.length > 0 && <div className="error">{[...new Set(diagnostics.errors)].join(' · ')}</div>}
    {ai && <section className="ai-drawer"><div><b>Assistant & spatial tools</b><button onClick={() => setAi(false)}>Close</button></div><p>AI provider integration is not connected. The command boundary is ready; a provider must use the same draft/live rules. No prompt or media is sent anywhere.</p><button disabled>Send to assistant</button><button disabled>3D room</button><button disabled>Kinect / calibration</button><small>Room simulation, sensor helpers and physical calibration are pending. See docs/ROADMAP.md.</small></section>}
    <footer className="playback"><div><b>{source?.name ?? 'No source selected'}</b><small>All sources · operational controls are immediate</small></div><div className="row"><button aria-label="Restart playback" onClick={() => void send({ type: 'transport', playing: snapshot.transport.playing, position: 0 })}>↺</button><button className="play" onClick={() => void send({ type: 'transport', playing: !snapshot.transport.playing })}>{snapshot.transport.playing ? 'Pause' : 'Play'}</button><NumberField label="Seek (seconds)" value={snapshot.transport.position} min={0} max={86400} onChange={position => void send({ type: 'transport', playing: snapshot.transport.playing, position })}/></div><span className="hint">Playback / blackout: immediate<br/>Geometry / sources / effects: {state.mode === 'live' ? 'live' : 'staged'}</span></footer>
    {picker && <div className="modal-backdrop"><div role="dialog" aria-modal="true" aria-labelledby="capture-title" className="modal capture-picker">
      <h2 id="capture-title">{picker.replace ? 'Reconnect capture' : 'Capture a screen or window'}</h2>
      <p>The capture joins the draft like any other source; in Preview & Apply it reaches the output only after Apply. HECTOR's own windows are not listed.</p>
      {snapshot.platform === 'darwin' && snapshot.captureAccess !== 'granted' && <p className="warning">macOS reports Screen Recording access as “{snapshot.captureAccess}”. Allow HECTOR in System Settings › Privacy & Security › Screen Recording, then quit and reopen HECTOR. Until then previews may be blank and capture will be denied.</p>}
      <nav className="tabs">{(['screen', 'window'] as const).map(t => <button key={t} className={pickerTab === t ? 'selected' : ''} onClick={() => setPickerTab(t)}>{t === 'screen' ? 'Screens' : 'Windows'}</button>)}</nav>
      {choices === null ? <p className="hint">Looking for screens and windows…</p> : <div className="capture-grid">{choices.filter(c => c.kind === pickerTab).map(c =>
        <button key={c.id} className="capture-choice" aria-label={`Capture ${c.name}`} disabled={pending} onClick={async () => { if (await send({ type: 'capture.add', sourceId: c.id, replace: picker.replace })) setPicker(null); }}>
          {c.thumbnail ? <img src={c.thumbnail} alt=""/> : <span className="no-thumb">No preview</span>}<span>{c.name}</span>{c.outputDisplay && <small className="warning">Output display: capturing it creates a feedback loop</small>}</button>)}
        {choices.filter(c => c.kind === pickerTab).length === 0 && <p className="hint">No {pickerTab === 'screen' ? 'screens' : 'windows'} available.</p>}</div>}
      <div className="row"><button onClick={() => void listCaptures()}>Refresh</button><button onClick={() => setPicker(null)}>Cancel</button></div></div></div>}
    {switchDialog && <div className="modal-backdrop"><div role="dialog" aria-modal="true" aria-labelledby="switch-title" className="modal"><h2 id="switch-title">Publish pending changes?</h2><p>Live Edit sends edits directly to the projector. Apply and save your draft, or discard it before switching.</p><div className="row"><button onClick={() => setSwitchDialog(false)}>Cancel</button><button onClick={async () => { if (await send({ type: 'mode', mode: 'live', resolution: 'discard' })) setSwitchDialog(false); }}>Discard & switch</button><button className="primary" onClick={async () => { if (await send({ type: 'mode', mode: 'live', resolution: 'apply' })) setSwitchDialog(false); }}>Apply & switch</button></div></div></div>}
  </div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
