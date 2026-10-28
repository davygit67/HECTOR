import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { CaptureChoice, Request, Snapshot } from './core/bridge';
import { newSurface, surfaceSchema, type Point, type Scene, type Source, type Surface } from './core/model';
import { ProjectionRenderer, type Diagnostics } from './render/renderer';
import { Banner, Dialog, Icon, Lamp, NumberField, Section, Segmented, SliderField, Switch, Tabs, Toggle } from './ui/kit';
import './style.css';

const isOutput = new URLSearchParams(location.search).has('output');
const emptyDiagnostics: Diagnostics = { fps: 0, slowFrames: 0, videoDropped: 0, errors: [] };
const generators = { gradient: 'Aurora gradient', grid: 'Calibration grid', clock: 'Elapsed clock' } as const;
const colored = (source?: Source) => source?.kind === 'gradient' || source?.kind === 'grid';
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
    return () => { element.removeEventListener('webglcontextlost', lost); renderer.current?.dispose(); renderer.current = null; delete window.hectorProbe; };
  }, [onDiagnostics, onError]);
  useEffect(() => { renderer.current?.update(scene, snapshot.assets, snapshot.captures, snapshot.transport, isOutput && snapshot.output.blackout); }, [scene, snapshot]);
  useEffect(() => { renderer.current?.setQuality(quality); }, [quality]);
  return <canvas ref={canvas} className="projection" aria-label={isOutput ? 'Projection output' : 'Draft preview'} />;
}
/** A static swatch of what a source shows; generator swatches follow the renderer's own colors. */
function Thumb({ source, live }: { source: Source; live: boolean }) {
  const style = source.kind === 'gradient' ? { background: `linear-gradient(135deg, ${source.color}, #0ab8ad)` }
    : source.kind === 'grid' ? { background: `linear-gradient(${source.color} 1px, transparent 1px) 0 0 / 4.5px 4.67px, linear-gradient(90deg, ${source.color} 1px, transparent 1px) 0 0 / 4.5px 4.67px, #090909` } : undefined;
  return <div className={`thumb ${source.kind}`} style={style} aria-hidden="true">
    {source.kind === 'video' ? <Icon name="play"/> : source.kind === 'image' ? <Icon name="frame"/> : source.kind === 'clock' ? '00:00' : source.kind === 'capture' ? <Lamp tone={live ? 'signal' : undefined}>LIVE</Lamp> : null}</div>;
}
function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null), [error, setError] = useState('');
  const [selected, setSelected] = useState('surface-1'), [tab, setTab] = useState<'Media' | 'Layers' | 'Setups'>('Layers'), [inspector, setInspector] = useState<'Transform' | 'Crop' | 'Effects'>('Transform');
  const [diagnostics, setDiagnostics] = useState(emptyDiagnostics), [display, setDisplay] = useState<number | null>(null);
  const [quality, setQuality] = useState(isOutput ? 1 : .65), [switchDialog, setSwitchDialog] = useState(false), [ai, setAi] = useState(false);
  const [liveView, setLiveView] = useState(true);
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
  if (!snapshot || !scene || !state) return <div className="loading"><div className="brand"><span className="brandmark"/>HECTOR</div><p>{error || 'Opening projection studio…'}</p></div>;
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
  const createSource = (kind: keyof typeof generators) => void send({ type: 'command', command: { type: 'source.put', source: { id: crypto.randomUUID(), name: generators[kind], kind, color: '#8f72ff', loop: true, speed: 1, volume: 0 } } });
  const groups = [...new Set(scene.surfaces.map(s => s.group))], preview = state.mode === 'preview', { output, transport } = snapshot;
  return <div className="app">
    <header className="topbar"><div className="brand"><span className="brandmark" aria-hidden="true"/>HECTOR <small>Studio</small></div>
      <div className="project"><input aria-label="Project name" key={scene.name} defaultValue={scene.name} onBlur={e => { if (e.target.value !== scene.name) void send({ type: 'command', command: { type: 'scene.rename', name: e.target.value } }); }} /><span className="tag" title="Working milestone">Milestone 0.1</span></div>
      <div className="file-actions"><button className="quiet" onClick={() => void send({ type: 'open' })}>Open project</button><button className="quiet" title="Export draft plus media into a portable project" onClick={() => void send({ type: 'export' })}>Export portable</button><button className="quiet key" aria-pressed={ai} onClick={() => setAi(!ai)}>AI assistant</button></div>
    </header>
    <div className="stagebar"><span className="label">Mode</span>
      <Segmented label="Editing mode" value={state.mode} disabled={pending} options={[{ value: 'preview', label: 'Preview & Apply' }, { value: 'live', label: 'Live Edit' }]} onChange={mode => {
        if (mode === 'live' && state.unapplied) setSwitchDialog(true); else void send({ type: 'mode', mode });
      }}/>
      <div className="lamps"><Lamp tone={state.unapplied ? 'signal' : 'ok'}>{state.unapplied ? 'Unapplied' : 'Applied'}</Lamp><Lamp tone={state.unsaved ? 'signal' : 'ok'}>{state.unsaved ? 'Unsaved' : 'Saved'}</Lamp></div>
      <div className="stage-actions"><button className="quiet" disabled={!state.canUndo || pending} onClick={() => void send({ type: 'undo' })}><Icon name="undo"/>Undo</button><button className="quiet" disabled={!state.canRedo || pending} onClick={() => void send({ type: 'redo' })}><Icon name="redo"/>Redo</button><button className="quiet" disabled={!state.unapplied || pending} onClick={() => void send({ type: 'discard' })}>Discard</button>
        <button className="primary" disabled={pending} onClick={() => void send({ type: preview ? 'apply' : 'save' })}>{preview ? 'Apply & Save' : 'Save'}</button></div>
    </div>
    {error && <Banner role="alert" onDismiss={() => setError('')}>{error}</Banner>}
    {output.errors.length > 0 && <Banner role="status">Output: {output.errors.join(' · ')}</Banner>}
    {output.disconnected && <Banner>Output display disconnected. Output is hidden and blacked out. Select a display, reopen output, then Restore output.</Banner>}
    <div className="workspace">
      {left && <aside className="panel left-panel" aria-label="Library"><Tabs label="Library sections" items={['Media', 'Layers', 'Setups'] as const} value={tab} onChange={setTab}/>
        {tab === 'Layers' && <div className="panel-body"><Section title="Surfaces" count={scene.surfaces.length} action={<button className="quiet icon" aria-label="Add surface" title="Add surface" onClick={async () => { const id = crypto.randomUUID(); if (await send({ type: 'command', command: { type: 'surface.add', surface: newSurface(id, `Surface ${String(scene.surfaces.length+1).padStart(2,'0')}`, scene.sources[0]?.id ?? null) } })) setSelected(id); }}><Icon name="plus"/></button>}>
          <div className="layer-list">{groups.map(group => <section key={group}>{group && <button className="quiet group-head" aria-expanded={!collapsed.includes(group)} onClick={() => setCollapsed(collapsed.includes(group) ? collapsed.filter(g => g !== group) : [...collapsed,group])}><Icon name="chevron"/><span className="label">{group}</span></button>}
            {!collapsed.includes(group) && [...scene.surfaces].reverse().filter(s => s.group === group).map((s) => <div className={s.id === selected ? 'layer selected' : 'layer'} key={s.id}>
              <button className="layer-name" onClick={() => setSelected(s.id)}><span className="layer-index">{String(scene.surfaces.indexOf(s)+1).padStart(2,'0')}</span><span className="layer-text"><span>{s.name}</span><small>{scene.sources.find(m => m.id === s.sourceId)?.name ?? 'No source'}</small></span></button>
              <button className="quiet icon" aria-label={`Visibility ${s.name}`} aria-pressed={s.visible} title={s.visible ? 'Hide' : 'Show'} disabled={s.locked} onClick={() => void send({ type: 'command', command: { type: 'surface.update', id: s.id, patch: { visible: !s.visible } } })}><Icon name={s.visible ? 'visible' : 'hidden'}/></button>
              <button className="quiet icon" aria-label={`Lock ${s.name}`} aria-pressed={s.locked} title={s.locked ? 'Unlock' : 'Lock'} onClick={() => void send({ type: 'command', command: { type: 'surface.update', id: s.id, patch: { locked: !s.locked } } })}><Icon name={s.locked ? 'locked' : 'unlocked'}/></button></div>)}</section>)}</div></Section>
          <p className="note">Layers composite from bottom to top. Select a corner and use arrow keys to nudge; Shift moves 10 pixels.</p></div>}
        {tab === 'Media' && <div className="panel-body"><button className="wide import" onClick={() => void send({ type: 'import' })}><Icon name="plus"/>Import images / videos</button>
          <Section title="Sources" count={scene.sources.length}><div className="source-list">{scene.sources.map(s => {
            const live = !!s.captureId && !!snapshot.captures[s.captureId], missing = !!s.assetId && !!snapshot.assets[s.assetId]?.missing, inUse = surface?.sourceId === s.id;
            return <div className={inUse ? 'card source-card selected' : 'card source-card'} key={s.id}><Thumb source={s} live={live}/>
              <div className="source-meta"><b title={s.name}>{s.name}</b>{missing ? <Lamp tone="signal">Missing file</Lamp> : <span className="label">{s.kind === 'capture' ? live ? `Live ${snapshot.captures[s.captureId!].kind} capture` : 'Capture · not connected' : s.kind}</span>}</div>
              <div className="source-actions"><button disabled={!surface || surface.locked || inUse} onClick={() => update({ sourceId: s.id })}>{inUse ? 'On this surface' : 'Use on surface'}</button>{s.assetId && <button onClick={() => void send({ type: 'relink', assetId: s.assetId! })}>{missing ? 'Missing · Relink' : 'Relink file'}</button>}{s.kind === 'capture' && <button onClick={() => openPicker(s.id)}>{live ? 'Change capture source' : 'Choose capture source'}</button>}<button className="danger" aria-label={`Remove ${s.name}`} onClick={() => void send({ type: 'command', command: { type: 'source.remove', id: s.id } })}>Remove</button></div></div>;
          })}</div></Section>
          <Section title="Generators"><div className="add-list">{(Object.keys(generators) as (keyof typeof generators)[]).map(kind => <button className="add-row" key={kind} aria-label={`Add ${generators[kind]}`} onClick={() => createSource(kind)}>{generators[kind]}<Icon name="plus"/></button>)}</div></Section>
          <Section title="Live sources"><div className="add-list"><button className="add-row" aria-label="Add Screen / window capture" onClick={() => openPicker()}>Screen / window capture<Icon name="plus"/></button></div><p className="note">Video only, no audio. Captures do not resume automatically after a restart; reconnect them here.{snapshot.platform === 'darwin' && snapshot.captureAccess !== 'granted' ? ' macOS needs Screen Recording permission (System Settings › Privacy & Security).' : ''}</p></Section>
          <Section title="Planned sources"><div className="add-list"><button className="add-row" disabled>YouTube / live stream<span className="tag">Pending</span></button></div><p className="note">Sandboxed service playback adapter pending. No URL is downloaded or played.</p></Section></div>}
        {tab === 'Setups' && <div className="panel-body"><p className="note">Named snapshots of the draft. Recall follows the current editing mode.</p>
          <div className="setups-form"><label className="field stacked"><span className="label">Setup name</span><input aria-label="Setup name" value={setupName} placeholder={scene.name} maxLength={80} onChange={e => setSetupName(e.target.value)}/></label><button className="wide" onClick={async () => { if (await send({ type: 'setup.save', name: setupName.trim() || scene.name })) setSetupName(''); }}>Save named setup</button></div>
          <Section title="Saved setups" count={snapshot.setups.length}>{snapshot.setups.length > 0 ? <div className="add-list">{snapshot.setups.map(name => <button className="add-row" key={name} onClick={() => void send({ type: 'setup.load', name })}><span>{name}</span><span className="label">Recall</span></button>)}</div> : <p className="note">No named setups yet.</p>}</Section>
          <p className="note">Names may contain letters, numbers, spaces, underscores and hyphens. Portable export copies media; named setups reference local files.</p></div>}
      </aside>}
      <main className="center"><div className="canvas-head"><button className="quiet panel-toggle" aria-pressed={left} onClick={() => setLeft(!left)}><Lamp>Library</Lamp></button><span className="rule"/>
          <span className="label wide-only">Mapping canvas</span><span className="tag">{scene.width} × {scene.height}</span><span className="canvas-state">{preview ? 'Draft · changes stay here until applied' : 'Live · changes publish immediately'}</span><span className="spacer"/>
          <Switch label="Live view" pressed={liveView} title="Pause studio preview rendering and media; projected output keeps playing" onClick={() => { setLiveView(value => !value); setDiagnostics(emptyDiagnostics); }}/><span className="rule"/>
          <button className="quiet panel-toggle" aria-pressed={right} onClick={() => setRight(!right)}><Lamp>Inspector</Lamp></button></div>
        <div className="canvas-space">
          <div className="canvas-frame" style={{ aspectRatio: `${scene.width}/${scene.height}` }}>{liveView ? <Viewport scene={previewScene} snapshot={snapshot} quality={quality} onDiagnostics={setDiagnostics} onError={onError}/> : <div className="preview-paused" role="status">Live view paused<span>Projected output continues playing</span></div>}
            <svg ref={svg} className="handles" tabIndex={0} aria-label="Mapping canvas" viewBox="0 0 1920 1080" preserveAspectRatio="none" onPointerMove={event => {
              const current = gesture.current; if (!current) return; const p = point(event), delta: Point = [p[0]-current.start[0],p[1]-current.start[1]];
              const factor = event.altKey ? .1 : 1;
              const corners = current.corners.map((c,i) => current.index < 0 || i === current.index ? [c[0]+delta[0]*factor,c[1]+delta[1]*factor] : [...c]) as Surface['corners'];
              if (surfaceSchema.safeParse({ ...current.surface, corners }).success) setDragCorners(corners);
            }} onPointerUp={finishDrag} onPointerCancel={() => { gesture.current = null; setDragCorners(null); }}>
              {previewScene.surfaces.filter(s => s.visible).map(s => <g key={s.id}><polygon points={s.corners.map(([x,y]) => `${x*1920},${y*1080}`).join(' ')} className={s.id === selected ? 'outline selected' : 'outline'} onPointerDown={e => dragStart(e,s,-1)}/>
                {s.id === selected && s.corners.map(([x,y],i) => <g key={i}><circle cx={x*1920} cy={y*1080} r={i === corner ? 12 : 9} className={i === corner ? 'handle active' : 'handle'} onPointerDown={e => dragStart(e,s,i)}/><text x={x*1920+22} y={y*1080-20}>{i+1}</text></g>)}</g>)}</svg>
          </div><div className="canvas-caption"><span>Drag surface to move · Drag corners to warp · Alt-drag for fine adjustment</span><span className="label">{surface?.locked ? 'Locked' : 'Select / Warp'}</span></div></div>
        <div className="canvas-status"><span className="label">Preview</span><Segmented small label="Preview quality" value={quality} options={[{ value: .4, label: 'Low' }, { value: .65, label: 'Balanced' }, { value: 1, label: 'Full' }]} onChange={setQuality}/>
          <dl className="meters"><div className="meter" title="Preview frame rate"><dt className="label">Rate</dt><dd>{diagnostics.fps.toFixed(1)} fps</dd></div><div className="meter" title="Preview frames slower than 25 ms"><dt className="label">&gt;25 ms</dt><dd>{diagnostics.slowFrames}</dd></div><div className="meter" title="Dropped video frames"><dt className="label">Drops</dt><dd>{diagnostics.videoDropped}</dd></div></dl></div>
      </main>
      {right && <aside className="panel right-panel" aria-label="Inspector"><div className="inspector-title"><span className="label">{surface ? surface.locked ? 'Locked surface' : 'Quad surface' : 'Surface'}</span><b>{surface?.name ?? 'No surface selected'}</b></div>
        <Tabs label="Inspector sections" items={['Transform', 'Crop', 'Effects'] as const} value={inspector} onChange={setInspector}/>
        {surface ? <div className="panel-body"><fieldset disabled={surface.locked || pending}>
          {inspector === 'Transform' && <><Section title="Surface"><label className="field"><span>Name</span><input aria-label="Surface name" key={surface.name} defaultValue={surface.name} onBlur={e => { if (e.target.value !== surface.name) update({ name: e.target.value }); }}/></label><label className="field"><span>Source</span><select value={surface.sourceId ?? ''} onChange={e => update({ sourceId: e.target.value || null })}><option value="">None</option>{scene.sources.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
              <label className="field"><span>Group</span><input key={surface.group} defaultValue={surface.group} placeholder="Ungrouped" onBlur={e => update({ group: e.target.value })}/></label></Section>
            <Section title="Corners · output pixels"><div className="corner-grid"><span/><span className="label">X</span><span className="label">Y</span>{surface.corners.map((p,i) => <React.Fragment key={i}><button className="key corner-index" aria-label={`Corner ${i+1}`} aria-pressed={corner === i} onClick={() => setCorner(i)}>{i+1}</button>{[0,1].map(axis => <NumberField bare key={axis} label={axis ? `Y${i+1}` : `X${i+1}`} value={p[axis]*(axis ? scene.height : scene.width)} onChange={n => { const corners = structuredClone(surface.corners); corners[i][axis] = n/(axis ? scene.height : scene.width); update({ corners }); }}/>)}</React.Fragment>)}</div></Section>
            <Section title="Rotate · scale"><div className="keys"><button aria-label="Rotate 15° counter-clockwise" title="Rotate 15° counter-clockwise" onClick={() => transform(-Math.PI/12,1)}><Icon name="ccw"/>15°</button><button aria-label="Rotate 15° clockwise" title="Rotate 15° clockwise" onClick={() => transform(Math.PI/12,1)}><Icon name="cw"/>15°</button><button aria-label="Scale −5%" onClick={() => transform(0,.95)}>−5%</button><button aria-label="Scale +5%" onClick={() => transform(0,1.05)}>+5%</button></div></Section>
            <Section title="Layer order"><div className="keys pair"><button onClick={() => void send({ type: 'command', command: { type: 'surface.move', id: surface.id, direction: 1 } })}>Move up</button><button onClick={() => void send({ type: 'command', command: { type: 'surface.move', id: surface.id, direction: -1 } })}>Move down</button></div><button className="danger delete" onClick={() => void send({ type: 'command', command: { type: 'surface.remove', id: surface.id } })}>Delete surface</button></Section></>}
          {inspector === 'Crop' && <Section title="Crop · percent from each edge"><div className="crop-diagram" aria-hidden="true"><div className="crop-area" style={{ left: `${surface.crop[0]*100}%`, top: `${surface.crop[1]*100}%`, right: `${surface.crop[2]*100}%`, bottom: `${surface.crop[3]*100}%` }}/></div>
            <div className="crop-fields">{['Left','Top','Right','Bottom'].map((label,i) => <NumberField key={label} label={label} value={surface.crop[i]*100} min={0} max={95} onChange={n => { const crop = [...surface.crop] as Surface['crop']; crop[i] = n/100; update({ crop }); }}/>)}</div><p className="note">Trim the source before warping.</p></Section>}
          {inspector === 'Effects' && <><Section title="Image"><SliderField label="Opacity" value={surface.opacity} min={0} max={1} step={.05} scale={100} unit="%" onChange={opacity => update({ opacity })}/><SliderField label="Brightness" value={surface.brightness} min={0} max={2} step={.05} scale={100} unit="%" onChange={brightness => update({ brightness })}/><SliderField label="Saturation" value={surface.saturation} min={0} max={2} step={.05} scale={100} unit="%" onChange={saturation => update({ saturation })}/>
              <div className="field"><span>Mask</span><Segmented small label="Mask" value={surface.mask} options={[{ value: 'none', label: 'None' }, { value: 'ellipse', label: 'Ellipse' }]} onChange={mask => update({ mask })}/></div>{colored(source) && <label className="field"><span>Generator color</span><input type="color" value={source!.color} onChange={e => sourceUpdate({ color: e.target.value })}/></label>}<p className="note">Effects and crop are scene edits. They publish only on Apply in Preview mode.</p></Section>
            <Section title="Planned"><button className="wide" disabled>Ambient backlight</button><p className="note">Source-color sampling and spatial light compositing are planned.</p></Section></>}
        </fieldset>
        <Section title="Source settings · staged">{source?.kind === 'capture' ? <p className="note">Live capture is always running: play/pause, seek, loop, speed and volume do not apply, and no audio is captured. Crop, effects, masks and layering work as for any source.</p> : source ? <><SliderField label="Playback speed" value={source.speed} min={.1} max={4} step={.1} unit="×" onChange={speed => sourceUpdate({ speed })}/><SliderField label="Output volume" value={source.volume} min={0} max={1} step={.05} scale={100} unit="%" onChange={volume => sourceUpdate({ volume })}/><Toggle label="Loop media" checked={source.loop} onChange={loop => sourceUpdate({ loop })}/><p className="note">Studio preview is always muted. Output starts muted until volume is changed and applied.</p></> : <p className="note">Assign a source from the Media library.</p>}</Section></div>
        : <div className="panel-body"><p className="note">Select a surface on the canvas or in Layers.</p></div>}
      </aside>}
    </div>
    {diagnostics.errors.length > 0 && <Banner>{[...new Set(diagnostics.errors)].join(' · ')}</Banner>}
    {ai && <section className="drawer" aria-label="Assistant"><header><span className="label">Assistant & spatial tools</span><button className="quiet" onClick={() => setAi(false)}>Close</button></header><p className="note">AI provider integration is not connected. The command boundary is ready; a provider must use the same draft/live rules. No prompt or media is sent anywhere.</p><div className="row"><button disabled>Send to assistant</button><button disabled>3D room</button><button disabled>Kinect / calibration</button><span className="note">Room simulation, sensor helpers and physical calibration are pending. See docs/ROADMAP.md.</span></div></section>}
    <footer className="console">
      <section className="deck transport-deck" aria-label="Transport"><div className="deck-state"><span className="label">Transport<span className="wide-only"> · all sources</span></span><b><Lamp tone={transport.playing ? 'ok' : undefined}>{transport.playing ? 'Playing' : 'Paused'}</Lamp></b></div>
        <button className="icon" aria-label="Restart playback" title="Restart playback" onClick={() => void send({ type: 'transport', playing: transport.playing, position: 0 })}><Icon name="restart"/></button><button className="play" onClick={() => void send({ type: 'transport', playing: !transport.playing })}><Icon name={transport.playing ? 'pause' : 'play'}/>{transport.playing ? 'Pause' : 'Play'}</button><NumberField label="Seek (seconds)" value={transport.position} min={0} max={86400} onChange={position => void send({ type: 'transport', playing: transport.playing, position })}/></section>
      <section className="deck output-deck" aria-label="Output"><div className="deck-state"><span className="label">Output<span className="wide-only"> · immediate</span></span><b><Lamp tone={output.open ? output.blackout ? 'signal' : 'ok' : undefined}>{output.open ? output.blackout ? 'Blacked out' : 'Connected' : 'Closed'}</Lamp></b></div>
        <select aria-label="Output display" value={selectedDisplay} onChange={e => setDisplay(Number(e.target.value))}>{snapshot.displays.map(d => <option key={d.id} value={d.id}>{d.primary ? 'Laptop · ' : ''}{d.label} · {d.width}×{d.height}</option>)}</select>
        <button disabled={pending} onClick={() => void send({ type: 'output', displayId: selectedDisplay, fullscreen: !output.fullscreen })}>{output.fullscreen ? 'Windowed' : 'Full screen'}</button>
        <button className="blackout" aria-pressed={output.blackout} title="Immediate operational control; playback continues" onClick={() => void send({ type: 'blackout', value: !output.blackout })}>{output.blackout ? 'Restore output' : 'Blackout'}</button></section>
    </footer>
    {picker && <Dialog id="capture-title" title={picker.replace ? 'Reconnect capture' : 'Capture a screen or window'} className="capture-picker">
      <p>The capture joins the draft like any other source; in Preview & Apply it reaches the output only after Apply. HECTOR's own windows are not listed.</p>
      {snapshot.platform === 'darwin' && snapshot.captureAccess !== 'granted' && <p className="warning">macOS reports Screen Recording access as “{snapshot.captureAccess}”. Allow HECTOR in System Settings › Privacy & Security › Screen Recording, then quit and reopen HECTOR. Until then previews may be blank and capture will be denied.</p>}
      <Tabs label="Capture kind" items={['screen', 'window'] as const} names={{ screen: 'Screens', window: 'Windows' }} value={pickerTab} onChange={setPickerTab}/>
      {choices === null ? <p className="note">Looking for screens and windows…</p> : <div className="capture-grid">{choices.filter(c => c.kind === pickerTab).map(c =>
        <button key={c.id} className="capture-choice" aria-label={`Capture ${c.name}`} disabled={pending} onClick={async () => { if (await send({ type: 'capture.add', sourceId: c.id, replace: picker.replace })) setPicker(null); }}>
          {c.thumbnail ? <img src={c.thumbnail} alt=""/> : <span className="no-thumb">No preview</span>}<span>{c.name}</span>{c.outputDisplay && <small className="warning">Output display: capturing it creates a feedback loop</small>}</button>)}
        {choices.filter(c => c.kind === pickerTab).length === 0 && <p className="note">No {pickerTab === 'screen' ? 'screens' : 'windows'} available.</p>}</div>}
      <div className="actions"><button className="quiet" onClick={() => void listCaptures()}>Refresh</button><button onClick={() => setPicker(null)}>Cancel</button></div></Dialog>}
    {switchDialog && <Dialog id="switch-title" title="Publish pending changes?"><p>Live Edit sends edits directly to the projector. Apply and save your draft, or discard it before switching.</p><div className="actions"><button className="quiet" onClick={() => setSwitchDialog(false)}>Cancel</button><button onClick={async () => { if (await send({ type: 'mode', mode: 'live', resolution: 'discard' })) setSwitchDialog(false); }}>Discard & switch</button><button className="primary" onClick={async () => { if (await send({ type: 'mode', mode: 'live', resolution: 'apply' })) setSwitchDialog(false); }}>Apply & switch</button></div></Dialog>}
  </div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
