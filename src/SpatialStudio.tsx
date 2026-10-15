import { configureMedia } from './nativeMedia';
import { useEffect, useRef, useState } from 'react';
import { bridge } from './bridge';
import { getSurface, remaining, surfaceAssetCount, type Command, type Scene } from './shared/domain';
import type { Snapshot } from './shared/bridge';
import type { Vec3 } from './shared/spatial';
import { Stage, NumberField, CalibrationControls } from './SurfaceEditor';
import { SpatialView } from './SpatialView';
import { ChatPanel } from './ChatPanel';
import { ContentLibrary } from './ContentControls';
import { ContentInventory } from './ContentInventory';
import { CONTENT_LIMITS, CONTENT_REGISTRY, defaultSpec, type ContentKind } from './shared/content';
import { parseYouTubeInput, YOUTUBE_LIMITS } from './shared/youtube';
import { HardwareWorkspace } from './HardwareWorkspace';
import { ProjectionOutput, type ProjectionOutputHandle } from './ProjectionOutput';
import './spatial.css';
import { configureLocalMedia, importMedia, removeMediaAsset } from './localMedia';
import { LayerControls, DisplayControls } from './LayerControls';

type Mode = 'room' | 'arrange' | 'align';
type Inspector = 'assistant' | 'surface' | 'content' | 'projectors' | 'viewer';
const round = (n: number) => Math.round(n * 100) / 100;

export function SpatialStudio() {
  const presentation = useRef<ProjectionOutputHandle>(null);
  const mediaInput = useRef<HTMLInputElement>(null);
  const [importingMedia, setImportingMedia] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null), [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('room'), [inspector, setInspector] = useState<Inspector>('assistant'), [coverage, setCoverage] = useState(false), [reset, setReset] = useState(0);
  const [, refreshTimers] = useState(0);
  const now = Date.now();
  const [playing, setPlaying] = useState(false);
  const [expandedAssetId, setExpandedAssetId] = useState<string | null>(null);
  const [showPreviews, setShowPreviews] = useState(false);
  const [page, setPage] = useState<'studio' | 'hardware'>(() => location.hash === '#hardware' ? 'hardware' : 'studio');
  const [hardwareOpened, setHardwareOpened] = useState(location.hash === '#hardware');
  const [youtubeDraft, setYoutubeDraft] = useState<string | null>(null), [youtubeError, setYoutubeError] = useState('');
  const query = new URLSearchParams(location.search), clean = query.get('view') === 'output';
  useEffect(() => {
    const changed = () => { const next = location.hash === '#hardware' ? 'hardware' : 'studio'; setPage(next); if (next === 'hardware') setHardwareOpened(true); };
    window.addEventListener('hashchange', changed); return () => window.removeEventListener('hashchange', changed);
  }, []);
  const navigate = (next: 'studio' | 'hardware') => { setPage(next); if (next === 'hardware') setHardwareOpened(true); history.replaceState(null, '', `${location.pathname}${location.search}${next === 'hardware' ? '#hardware' : ''}`); };
  useEffect(() => {
    let active = true, received = false;
    const unsubscribe = bridge.subscribe(s => { received = true; if (active) setSnapshot(s); });
    bridge.getSnapshot().then(s => { if (active && !received) setSnapshot(s); }).catch(e => setError(String(e)));
    document.title = clean ? 'Projection output' : 'Projection Mapper — Spatial Studio';
    return () => { active = false; unsubscribe(); };
  }, [clean]);
  const timers = snapshot?.scene.timers;
  useEffect(() => {
    const running = () => timers?.some(timer => timer.status === 'running' && remaining(timer, Date.now()) > 0);
    if (!running()) return;
    const tick = setInterval(() => { refreshTimers(value => value + 1); if (!running()) clearInterval(tick); }, 150);
    return () => clearInterval(tick);
  }, [timers]);
  useEffect(() => {
    if (snapshot) { configureMedia(snapshot.scene); configureLocalMedia(snapshot.scene); }
  }, [snapshot?.scene]);
  useEffect(() => {
    const scene = snapshot?.scene;
    if (!scene?.contents.some(content => content.kind === 'media' && content.config.mediaType === 'video' && content.state.clock.running)) return;
    // Keep local decoders aligned to the shared clock without rerendering React.
    const tick = setInterval(() => configureLocalMedia(scene), 500);
    return () => clearInterval(tick);
  }, [snapshot?.scene]);
  const send = (command: Command) => { if (command.type === 'timer.select' || command.type === 'content.select') { setInspector('content'); setExpandedAssetId(command.id); } return bridge.dispatch(command).then(result => { setError(result.ok ? null : result.error ?? 'The change could not be applied.'); return result; }).catch(e => setError(String(e))); };
  const openOutput = (action: 'open' | 'fullscreen' | 'windowed' = 'open', displayId?: string) => bridge.output({ action, displayId }).catch(e => setError(String(e)));
  if (!snapshot) return <div className="loading">{error ?? 'Opening your spatial studio…'}</div>;
  const { scene } = snapshot;
  if (clean) return <ProjectionOutput alignmentSession="studio" scene={scene} now={now} standalone send={send} issue={error || snapshot.saveError} saveStatus={snapshot.saveStatus} />;
  const surface = getSurface(scene), selected = scene.timers.find(t => t.id === scene.selectedTimerId), selectedContent = scene.contents.find(c => c.id === scene.selectedContentId);
  const selectSurface = (id: string) => { send({ type: 'surface.select', id }); setInspector('surface'); };
  const editPosition = (index: number, value: number) => { const origin: Vec3 = [...surface.origin]; origin[index] = value; send({ type: 'surface.move', id: surface.id, origin }); };
  const surfaceContents = scene.contents.filter(c => c.surfaceId === surface.id);
  const assetCount = surfaceAssetCount(scene, surface.id), surfaceFull = assetCount >= CONTENT_LIMITS.maxPerSurface;
  const addContent = (kind: ContentKind | 'timer') => {
    if (kind === 'art') {
      const existing = surfaceContents.find(c => c.kind === 'art');
      if (existing) { setError(null); void send({ type: 'content.select', id: existing.id }); setMode('arrange'); setInspector('content'); return; }
    }
    if (kind === 'youtube') { setYoutubeDraft(''); setYoutubeError(''); return; }
    if (kind === 'media') { mediaInput.current?.click(); return; }
    const id = crypto.randomUUID();
    if (kind === 'timer') send({ type: 'timer.create', id, title: 'Focus time', durationMs: 300000, surfaceId: surface.id });
    else send({ type: 'content.create', id, surfaceId: surface.id, title: kind === 'recipe' ? 'Lemon pasta' : CONTENT_REGISTRY.find(e => e.kind === kind)!.label, spec: defaultSpec(kind) });
    setMode('arrange'); setInspector('content'); setPlaying(false);
  };
  return <div className="studio spatial-studio">
    <input ref={mediaInput} type="file" aria-label="Upload local media file" hidden accept="video/*,image/*,.mp4,.webm,.mov,.mkv" disabled={importingMedia} onChange={async event => {
      const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
      setImportingMedia(true); setError(null); let assetId: string | undefined;
      try {
        const config = await importMedia(file); assetId = config.assetId;
        const result = await send({ type: 'content.create', id: crypto.randomUUID(), title: file.name.slice(0, 60), surfaceId: surface.id, spec: { kind: 'media', config } });
        if (!result?.ok) throw new Error(result?.error ?? 'Could not add the media.');
        setMode('arrange'); setInspector('content');
      } catch (e) { if (assetId) void removeMediaAsset(assetId); setError(String((e as Error).message)); }
      finally { setImportingMedia(false); }
    }} />
    {importingMedia && <div className="media-import-status" role="status">Importing local media…</div>}
    <header className="app-header"><div className="brand"><span className="brand-mark"><i /><i /></span><div><h1>Projection Mapper<span>SPATIAL STUDIO / 03</span></h1><p>One room. One canvas. Every point of view.</p></div></div>
      <div className="header-actions"><button className="secondary" onClick={() => { navigate('studio'); setMode('room'); setInspector('assistant'); }}>✦ Ask assistant</button><button className="secondary" onClick={() => openOutput()}>Open output window ↗</button><button className="secondary" onClick={() => presentation.current?.enter('align')}>Align full screen</button><button className="primary" onClick={() => presentation.current?.enter('project')}>Project full screen</button></div></header>
    <nav className="studio-pages" role="tablist" aria-label="Studio pages"><button id="studio-tab" role="tab" aria-selected={page === 'studio'} aria-controls="studio-panel" className={page === 'studio' ? 'active' : ''} onClick={() => navigate('studio')}>Studio</button><button id="hardware-tab" role="tab" aria-selected={page === 'hardware'} aria-controls="hardware-panel" className={page === 'hardware' ? 'active' : ''} onClick={() => navigate('hardware')}>Hardware setup</button><span>One scene · connected tools</span></nav>
    <main id="studio-panel" role="tabpanel" aria-labelledby="studio-tab" hidden={page !== 'studio'} className="workspace spatial-workspace">
      <section className="workspace-main">
        <div className="workspace-title"><div><span className="eyebrow">THE ROOM IS YOUR CANVAS</span><h2>Give your ideas a place.</h2></div><span className="surface-badge">2 surfaces · 2 projectors</span></div>
        <ContentLibrary hasArtwork={surfaceContents.some(c => c.kind === 'art')} onCreate={addContent} disabled={surfaceFull || scene.contents.length >= CONTENT_LIMITS.maxInstances} />
        <p className="hint asset-capacity">{surface.name} · {assetCount} / {CONTENT_LIMITS.maxPerSurface} assets. {surfaceFull ? 'All slots filled. Edit an existing asset or remove one to add another.' : 'Panels can overlap. Moving or editing uses no extra slots.'}</p>
        {youtubeDraft !== null && <form className="youtube-add" onSubmit={async event => {
          event.preventDefault();
          try {
            const config = { ...parseYouTubeInput(youtubeDraft), backlight: true };
            const result = await send({ type: 'content.create', id: crypto.randomUUID(), title: 'YouTube video', surfaceId: surface.id, spec: { kind: 'youtube', config } });
            if (result?.ok) { setYoutubeDraft(null); setYoutubeError(''); setMode('arrange'); setInspector('content'); setPlaying(true); }
          } catch (e) { setYoutubeError(e instanceof Error ? e.message : 'Check the video link.'); }
        }}>
          <label className="field"><span>YouTube link or video ID · {surface.name}</span><input autoFocus value={youtubeDraft} maxLength={YOUTUBE_LIMITS.inputLength} placeholder="Paste a YouTube video link" onChange={e => setYoutubeDraft(e.target.value)} /></label>
          <div><button className="primary" type="submit">Place video</button><button className="secondary" type="button" onClick={() => setYoutubeDraft(null)}>Cancel</button></div>
          {youtubeError && <p role="alert">{youtubeError}</p>}
        </form>}
        <div className="preview-card spatial-card">
          <div className="preview-toolbar"><div className="segments" aria-label="Workspace mode">
            <button className={mode === 'room' ? 'active' : ''} aria-pressed={mode === 'room'} onClick={() => setMode('room')}>3D room</button>
            <button className={mode === 'arrange' ? 'active' : ''} aria-pressed={mode === 'arrange'} onClick={() => { setMode('arrange'); setInspector(selected || selectedContent ? 'content' : 'surface'); }}>Surface layout</button>
            <button className={mode === 'align' ? 'active' : ''} aria-pressed={mode === 'align'} onClick={() => setMode('align')}>Manual alignment</button>
          </div>{mode === 'room' ? <label className="grid-toggle"><input type="checkbox" checked={coverage} onChange={e => setCoverage(e.target.checked)} />Coverage</label> : <label className="grid-toggle"><input type="checkbox" checked={scene.showGrid} onChange={e => send({ type: 'grid.set', visible: e.target.checked })} />Test grid</label>}</div>
          {mode === 'room' ? <div className="room-stage"><SpatialView scene={scene} view="orbit" coverage={coverage} resetKey={reset} onSelect={selectSurface} />
            <div className="room-chip"><span className="status-dot" />Room frame · meters, simulated</div>
            <button className="reset-view" onClick={() => setReset(n => n + 1)}>Reset view</button>
            {coverage && <div className="coverage-legend"><span><i className="a" />A</span><span><i className="b" />B</span><span><i className="overlap" />Overlap</span><span><i className="none" />Uncovered</span></div>}
          </div> : null}
          <div className={'stage-surround ' + (mode === 'room' ? 'player-controls-only' : '')}><Stage alignmentSession="studio" scene={scene} now={now} mode={mode === 'align' ? 'align' : 'arrange'} active={mode !== 'room'} send={send} playing={playing} /></div>
          {mode === 'arrange' && surfaceContents.some(c => c.kind === 'game' || c.kind === 'youtube') && <div className="interaction-strip"><span>{playing ? 'Interact mode · use the player controls or game targets.' : 'Arrange mode · drag panels to place them.'}</span><button className="secondary" onClick={() => setPlaying(p => !p)}>{playing ? 'Arrange panels' : 'Interact with content'}</button></div>}
          {scene.contents.some(c => c.kind === 'youtube') && (mode === 'room' || mode === 'arrange' && !playing) && <div className="interaction-strip"><span>{window.projectionMedia ? 'Video and backlight share one source across every view.' : 'YouTube is shown as a placement preview here.'}</span><button className="secondary" onClick={() => {
            const video = scene.contents.find(c => c.kind === 'youtube' && c.surfaceId === surface.id) ?? scene.contents.find(c => c.kind === 'youtube');
            if (video) { send({ type: 'surface.select', id: video.surfaceId }); send({ type: 'content.select', id: video.id }); setMode('arrange'); setPlaying(true); }
          }}>Use player on canvas ↗</button></div>}
          <div className="preview-footer"><span><i className="status-dot" />{mode === 'room' ? 'Editor camera' : mode === 'arrange' ? surface.name : `${getSurface(scene, scene.manualOutput.surfaceId).name} → manual output`}</span><span>{mode === 'room' ? 'Drag to orbit · scroll to zoom · click a surface' : mode === 'arrange' ? 'Drag to move · corner handle to resize' : 'This 2D alignment does not measure room geometry'}</span><span>{mode === 'room' ? '3D' : '16:9'}</span></div>
          {mode === 'align' && <div className="projection-launch"><div><strong>Project {getSurface(scene, scene.manualOutput.surfaceId).name.toLowerCase()}</strong><p>Align at the actual full-screen size, then switch to Project without moving the image. Unused areas stay black. Press Esc to come back.</p></div><div><button className="secondary" onClick={() => presentation.current?.enter('align')}>Align full screen</button><button className="primary" onClick={() => presentation.current?.enter('project')}>Project full screen</button><button className="secondary" onClick={() => openOutput()}>Open output window ↗</button></div><p>Using an extended display? Open the output window, move it onto the projector, then choose Align full screen there.</p></div>}
        </div>
        <div className="surface-tabs" aria-label="Room surfaces">{scene.surfaces.map(s => <button key={s.id} className={s.id === surface.id ? 'active' : ''} onClick={() => selectSurface(s.id)} aria-pressed={s.id === surface.id}>
          <span className="surface-symbol">{s.kind === 'table' ? '▱' : '▯'}</span><span><strong>{s.name}</strong><small>{s.width.toFixed(1)} × {s.height.toFixed(2)} m · simulated{s.holes.length ? ' · exclusion' : ''}</small></span><span className="surface-arrow">↗</span>
        </button>)}</div>
        <div className="view-heading"><span className="eyebrow">ROOM PREVIEWS</span><label className="grid-toggle"><input type="checkbox" checked={showPreviews} onChange={event => setShowPreviews(event.target.checked)} />Show 3D previews</label></div>
        {showPreviews && <div className="view-grid">
          <Preview scene={scene} view="viewer" title="Human viewpoint" subtitle="Fixed viewer · independent of editor" onClick={() => setInspector('viewer')} />
          {scene.projectors.map(p => <Preview key={p.id} scene={scene} view={p.id as 'projector-a' | 'projector-b'} title={p.name} subtitle={p.enabled ? 'Simulated output · weighted overlap' : 'Disabled · no contribution'} onClick={() => setInspector('projectors')} />)}
        </div>}
        <div className="content-heading"><div><h3>Layers · {surface.name} <span className="count">{assetCount} / {CONTENT_LIMITS.maxPerSurface}</span></h3><p>Select, reorder and adjust what appears on this surface.</p></div><button className="secondary" disabled={surfaceFull || scene.timers.length >= 8} onClick={() => {
          send({ type: 'timer.create', id: crypto.randomUUID(), title: scene.timers.length ? `Timer ${scene.timers.length + 1}` : 'Focus time', durationMs: 300000, surfaceId: surface.id }); setMode('arrange'); setInspector('content');
        }}>＋ Add timer</button></div>
        <LayerControls scene={scene} send={send} onSelect={() => { setMode('arrange'); setInspector('content'); }} />
        <DisplayControls scene={scene} send={send} />
        <div className="output-strip"><div className="output-icon">▱</div><div><strong>Output window source</strong><p>Manual alignment is for the physical prototype. Projector A/B views use simulated geometry.</p></div><select aria-label="Output source" value={scene.outputView} onChange={e => send({ type: 'output.view', view: e.target.value as Scene['outputView'] })}><option value="manual">Manual surface output</option><option value="projector-a">Simulated projector A</option><option value="projector-b">Simulated projector B</option></select></div>
        {snapshot.storage === 'disk' && <div className="native-output-controls"><select aria-label="Output display" value={snapshot.output.displayId ?? snapshot.displays[0]?.id} onChange={e => openOutput('open', e.target.value)}>{snapshot.displays.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}</select><button className="secondary" onClick={() => openOutput(snapshot.output.fullscreen ? 'windowed' : 'fullscreen')}>{snapshot.output.fullscreen ? 'Exit full screen' : 'Full screen'}</button></div>}
      </section>
      <aside className="inspector spatial-inspector"><div className="inspector-title"><span className="eyebrow">{mode === 'align' ? 'MANUAL OUTPUT ADAPTER' : 'SCENE INSPECTOR'}</span><span className="inspector-indicator" /></div>
        {mode === 'align' ? <>
          <label className="field"><span>Surface for manual output</span><select value={scene.manualOutput.surfaceId} onChange={e => send({ type: 'manual.target', surfaceId: e.target.value })}>{scene.surfaces.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          <p className="hint">Changing the target resets its four-corner alignment.</p>
          <div className="divider" /><CalibrationControls scene={scene} send={send} />
        </> : <>
          <div className="inspector-tabs" aria-label="Inspector section">{(['assistant', 'surface', 'content', 'projectors', 'viewer'] as Inspector[]).map(tab => <button key={tab} onClick={() => { setInspector(tab); if (tab === 'content') setExpandedAssetId(null); }} aria-pressed={inspector === tab} className={inspector === tab ? 'active' : ''}>{tab === 'assistant' ? 'AI' : tab === 'projectors' ? 'Outputs' : tab[0].toUpperCase() + tab.slice(1)}</button>)}</div>
          <div hidden={inspector !== 'assistant'}><ChatPanel /></div>
          {inspector === 'surface' && <><span className="eyebrow">{surface.kind === 'table' ? 'SURFACE / 01' : 'SURFACE / 02'}</span><h3>{surface.name}</h3><p className="hint">Its boundary belongs to the canvas. Content inherits its coordinate frame and drawable region.</p>
            <div className="surface-detail"><span>Geometry</span><strong>{surface.boundary.length > 4 ? 'Clipped corner' : 'Planar rectangle'}{surface.holes.length ? ' + demo cutout' : ''}</strong><span>Dimensions</span><strong>{surface.width} × {surface.height} m</strong><span>Source</span><strong>Simulated, unmeasured</strong></div>
            <span className="eyebrow">POSITION IN ROOM</span><div className="position-grid"><NumberField label="X" value={round(surface.origin[0])} min={-5} max={5} step={.1} suffix="m" onCommit={n => editPosition(0, n)} /><NumberField label="Y / height" value={round(surface.origin[1])} min={0} max={4} step={.05} suffix="m" onCommit={n => editPosition(1, n)} /><NumberField label="Z" value={round(surface.origin[2])} min={-5} max={5} step={.1} suffix="m" onCommit={n => editPosition(2, n)} /></div>
            <button className="secondary full-width" onClick={() => setMode('arrange')}>Arrange content on {surface.name.toLowerCase()}</button><p className="hint">Moving this surface carries its content with it. Projector footprints are recomputed.</p>
          </>}
          {inspector === 'content' && <ContentInventory scene={scene} now={now} expandedId={expandedAssetId} onExpand={setExpandedAssetId} send={send} onPlay={() => { setMode('arrange'); setPlaying(true); }} />}
          {inspector === 'projectors' && <><span className="eyebrow">PROJECTOR COVERAGE</span><h3>Two angles. One scene.</h3><p className="hint">Move or disable an output. Content stays in place while the overlap weights change.</p>{scene.projectors.map(p => <div className="projector-control" key={p.id}><label className="projector-toggle"><span><i style={{ background: p.color }} />{p.name}</span><input aria-label={`${p.name} enabled`} type="checkbox" checked={p.enabled} onChange={e => send({ type: 'projector.update', id: p.id, enabled: e.target.checked })} /></label>
            <label className="range-field"><span>Horizontal position <strong>{p.position[0].toFixed(1)} m</strong></span><input aria-label={`${p.name} horizontal position`} type="range" min={-3} max={3} step={.1} value={p.position[0]} onChange={e => send({ type: 'projector.update', id: p.id, position: [Number(e.target.value), p.position[1], p.position[2]] })} /></label>
            <NumberField label={`${p.name} height`} value={round(p.position[1])} min={1} max={4} step={.1} suffix="m" onCommit={n => send({ type: 'projector.update', id: p.id, position: [p.position[0], n, p.position[2]] })} />
          </div>)}<div className="geometry-note">Coverage uses the simulated planes and a sampled visibility mask. Physical calibration, measured brightness matching, and display synchronization are pending.</div></>}
          {inspector === 'viewer' && <><span className="eyebrow">HUMAN VIEWPOINT</span><h3>Stand somewhere else.</h3><p className="hint">This is the nominated viewer. Orbiting the editor does not change this position.</p>
            {(['X', 'Eye height', 'Z'] as const).map((label, i) => <NumberField key={label} label={`Viewer ${label}`} value={round(scene.viewer.position[i])} min={i === 1 ? .5 : -6} max={6} step={.1} suffix="m" onCommit={n => { const position: Vec3 = [...scene.viewer.position]; position[i] = n; send({ type: 'viewer.update', position }); }} />)}
            <button className="secondary full-width" onClick={() => send({ type: 'viewer.update', position: [.25, 1.7, 4.2] })}>Reset viewer position</button><div className="geometry-note">This preview shows surface-attached content from a fixed simulated viewpoint. Head tracking and perspective-dependent portals are future work.</div></>}
        </>}
        <div className="inspector-bottom"><span className="eyebrow">SHARED SPATIAL STATE</span><p>Room frame · surface boundaries · viewer pose · projector coverage</p><span className="future-tag">Geometry v{scene.geometryRevision}</span><span className="future-tag">Scene #{scene.revision}</span></div>
      </aside>
    </main>
    <div id="hardware-panel" role="tabpanel" aria-labelledby="hardware-tab" hidden={page !== 'hardware'}>{hardwareOpened && <HardwareWorkspace snapshot={snapshot} />}</div>
    {(error || snapshot.saveError) && <div className="error-banner" role="alert"><span>{error ?? snapshot.saveError}</span>{error && <button onClick={() => setError(null)} aria-label="Dismiss error">×</button>}</div>}
    <footer className="app-footer"><span><i className={`status-dot ${snapshot.saveStatus === 'error' ? 'warning' : ''}`} />{snapshot.saveStatus === 'saved' ? 'Room saved locally' : snapshot.saveStatus === 'saving' ? 'Saving room…' : 'Save needs attention'}</span><span>Simulated geometry · physical calibration pending · {snapshot.storage === 'disk' ? 'desktop' : 'browser preview'}</span><span>PROTOTYPE 0.3</span></footer>
    <ProjectionOutput alignmentSession="studio" ref={presentation} scene={scene} now={now} send={send} issue={error || snapshot.saveError} saveStatus={snapshot.saveStatus} />
  </div>;
}

function Preview({ scene, view, title, subtitle, onClick }: { scene: Scene; view: 'viewer' | 'projector-a' | 'projector-b'; title: string; subtitle: string; onClick: () => void }) {
  return <div className="view-card"><div className="view-canvas"><SpatialView scene={scene} view={view} /></div><button className="view-caption" onClick={onClick}><strong>{title}<span>↗</span></strong><small>{subtitle}</small></button></div>;
}
