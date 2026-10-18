import { programInput } from './programRuntime';
import { programPoint } from './shared/programInput';
import { measuredMaskCSS } from './shared/measured';
import { readMediaPicture } from './nativeMedia';
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { formatTime, remaining, getSurface, type Command, type Scene, type Timer } from './shared/domain';
import { surfaceClipPath } from './shared/spatial';
import { YouTubePlayer } from './YouTubePlayer';
import { YOUTUBE_MIN_BOUNDS } from './shared/youtube';
import { SurfaceArtwork } from './SpatialView';
import { GAME_GRID, gameTarget, type ContentInstance } from './shared/content';
import { clamp, cssMatrix, FULL_QUAD, HEIGHT, WIDTH, type Bounds, type Point, type Quad } from './shared/geometry';

import { manualAlignment, moveAlignment, moveAlignmentCorner, moveAlignmentCorners } from './shared/manualAlignment';
import { LayerArtwork } from './LayerArtwork';
import { layerOpacity, layerVisible, surfaceLayers } from './shared/layers';
import './mapper-controls.css';
import { useAlignmentPreview } from './alignmentPreview';

type Mode = 'arrange' | 'align';
const corners = ['Top left', 'Top right', 'Bottom right', 'Bottom left'];
const cornerTags = ['TL', 'TR', 'BR', 'BL'];
const edges = ['top', 'right', 'bottom', 'left'];
const arrowSteps: Record<string, Point> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } };

function TimerFace({ timer, now }: { timer: Timer; now: number }) {
  const left = remaining(timer, now);
  const finished = left === 0 && timer.status !== 'idle';
  const status = finished ? 'Time is up' : timer.status === 'running' ? 'Counting down' : timer.status === 'paused' ? 'Paused' : 'Ready when you are';
  const fontSize = Math.min(timer.bounds.w * WIDTH * (left >= 3_600_000 ? .17 : .24), timer.bounds.h * HEIGHT * .43);
  return <div className={`timer-face ${finished ? 'finished' : ''}`}>
    <div className="timer-heading"><span className={`timer-dot ${timer.status === 'running' && !finished ? 'active' : ''}`} />{timer.title}</div>
    <div className="timer-digits" style={{ fontSize }}>{formatTime(left)}</div>
    <div className="timer-caption">{status}</div>
    <div className="timer-track"><div style={{ width: `${left / timer.durationMs * 100}%` }} /></div>
  </div>;
}

interface Drag { kind: 'corner' | 'edge' | 'projection' | 'move' | 'resize'; start: Point; quad: Quad; anchorBounds: Bounds; selected?: number[]; timer?: Timer; content?: ContentInstance; pointerId: number }
export function Stage({ scene, now, mode, send, clean = false, playing = false, active = true, alignmentEditing = false, alignmentSession }: { scene: Scene; now: number; mode: Mode; send?: (command: Command) => void; clean?: boolean; playing?: boolean; active?: boolean; alignmentEditing?: boolean; alignmentSession?: string }) {
  const viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [previewQuad, setPreviewQuad] = useState<Quad | null>(null);
  const [selectedCorners, setSelectedCorners] = useState<number[]>([]);
  const sharedPreview = useAlignmentPreview(scene.manualOutput.surfaceId, scene.manualOutput.quad, alignmentSession);
  const previewFrame = useRef<number | null>(null), latestQuad = useRef<Quad | null>(null);
  const queueQuad = (quad: Quad) => {
    latestQuad.current = quad;
    if (previewFrame.current === null) previewFrame.current = requestAnimationFrame(() => { previewFrame.current = null; setPreviewQuad(latestQuad.current); if (latestQuad.current) sharedPreview.publish(latestQuad.current); });
  };
  useLayoutEffect(() => { if (!drag.current) setPreviewQuad(null); }, [scene.manualOutput.quad]);
  const pendingDrag = useRef<Command | null>(null), dragFrame = useRef<number | null>(null), sendCurrent = useRef(send); sendCurrent.current = send;
  const flushDrag = () => {
    if (dragFrame.current !== null) cancelAnimationFrame(dragFrame.current); dragFrame.current = null;
    const command = pendingDrag.current; pendingDrag.current = null; if (command) sendCurrent.current?.(command);
  };
  const queueDrag = (command: Command) => { pendingDrag.current = command; if (dragFrame.current === null) dragFrame.current = requestAnimationFrame(flushDrag); };
  useLayoutEffect(() => { finishDrag(); }, [alignmentEditing, clean, mode]);
  useEffect(() => () => flushDrag(), []);
  const finishDrag = () => {
    flushDrag();
    if (previewFrame.current !== null) cancelAnimationFrame(previewFrame.current); previewFrame.current = null;
    const quad = latestQuad.current; latestQuad.current = null; drag.current = null;
    if (quad) { setPreviewQuad(quad); sharedPreview.publish(quad, true); sendCurrent.current?.({ type: 'calibration.set', quad }); }
  };
  useEffect(() => () => { if (previewFrame.current !== null) cancelAnimationFrame(previewFrame.current); if (latestQuad.current) sendCurrent.current?.({ type: 'calibration.set', quad: latestQuad.current }); }, []);
  const [scale, setScale] = useState(0);
  const [feedbackHost, setFeedbackHost] = useState<HTMLDivElement | null>(null);
  const [openedPlayers, setOpenedPlayers] = useState<Set<string>>(() => new Set());
  useLayoutEffect(() => {
    const node = viewport.current!;
    const observer = new ResizeObserver(entries => setScale(entries[0].contentRect.width / WIDTH));
    observer.observe(node); return () => observer.disconnect();
  }, []);
  const aligning = clean || mode === 'align';
  const surface = getSurface(scene, aligning ? scene.manualOutput.surfaceId : scene.selectedSurfaceId);
  const showPlayers = active && (playing || clean || aligning);
  const playerIds = JSON.stringify(scene.contents.filter(c => c.kind === 'youtube' && c.surfaceId === surface.id).map(c => c.id));
  useEffect(() => {
    if (!showPlayers || !playerIds) return;
    setOpenedPlayers(previous => {
      const ids: string[] = JSON.parse(playerIds);
      return ids.every(id => previous.has(id)) ? previous : new Set([...previous, ...ids]);
    });
  }, [showPlayers, playerIds]);
  const effectiveQuad = previewQuad ?? sharedPreview.remote ?? scene.manualOutput.quad;
  const quad = aligning ? effectiveQuad : FULL_QUAD;
  const alignment = manualAlignment({ ...scene, manualOutput: { ...scene.manualOutput, quad: effectiveQuad } }, readMediaPicture);
  useLayoutEffect(() => { setSelectedCorners([]); }, [scene.manualOutput.surfaceId, alignment.video?.id, mode, active, alignmentEditing]);
  const layers = surfaceLayers(scene, surface.id);
  const zIndex = (id: string) => layers.findIndex(c => c.id === id) + 1;
  const point = (event: PointerEvent): Point => {
    const r = viewport.current!.getBoundingClientRect();
    return { x: (event.clientX - r.left) / r.width, y: (event.clientY - r.top) / r.height };
  };
  const start = (event: PointerEvent<HTMLElement | SVGElement>, kind: Drag['kind'], timer?: Timer, corner?: number, content?: ContentInstance) => {
    if (!send || (clean && !(alignmentEditing && (kind === 'corner' || kind === 'edge' || kind === 'projection'))) || event.button !== 0 || drag.current) return;
    if ((timer ?? content)?.layer?.locked) return;
    event.preventDefault(); event.stopPropagation();
    let selected: number[] | undefined;
    if (kind === 'corner') {
      selected = event.shiftKey ? (selectedCorners.includes(corner!) ? selectedCorners.filter(i => i !== corner) : [...selectedCorners, corner!])
        : selectedCorners.includes(corner!) ? selectedCorners : [corner!];
      setSelectedCorners(selected);
    } else if (kind === 'edge') { selected = [corner!, (corner! + 1) % 4]; setSelectedCorners(selected); }
    else if (kind === 'projection') setSelectedCorners([]);
    if (kind === 'projection' || kind === 'corner' || kind === 'edge') event.currentTarget.focus({ preventScroll: true });
    // Shift-clicking a selected point removes it without starting a drag of the remaining selection.
    if (kind === 'corner' && !selected!.includes(corner!)) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { kind, quad: structuredClone(quad), anchorBounds: { ...alignment.bounds }, timer: timer ? structuredClone(timer) : undefined, content: content ? structuredClone(content) : undefined, selected, start: point(event), pointerId: event.pointerId };
    if (timer) send({ type: 'timer.select', id: timer.id });
    if (content) send({ type: 'content.select', id: content.id });
  };
  const move = (event: PointerEvent) => {
    const d = drag.current;
    if (!d || event.pointerId !== d.pointerId || !send || (clean && !alignmentEditing)) return;
    const p = point(event), precision = event.altKey ? .01 : event.shiftKey && d.kind === 'projection' ? .1 : 1;
    const delta = { x: (p.x - d.start.x) * precision, y: (p.y - d.start.y) * precision };
    if (d.kind === 'projection') {
      queueQuad(moveAlignment(d.quad, d.anchorBounds, delta));
    } else if (d.kind === 'corner' || d.kind === 'edge') {
      const next = moveAlignmentCorners(d.quad, d.anchorBounds, d.selected!, delta);
      if (next) queueQuad(next);
    } else {
      const item = d.content ?? d.timer!, b = item.bounds, dx = p.x - d.start.x, dy = p.y - d.start.y;
      const minimum = d.content?.kind === 'youtube' || d.content?.kind === 'media' ? YOUTUBE_MIN_BOUNDS : { w: .18, h: .18 };
      const bounds: Bounds = d.kind === 'move' ? { ...b, x: b.x + dx, y: b.y + dy }
        : { ...b, w: clamp(b.w + dx, minimum.w, 1 - b.x), h: clamp(b.h + dy, minimum.h, 1 - b.y) };
      queueDrag({ type: d.content ? 'content.move' : 'timer.move', id: item.id, bounds });
    }
  };
  const nudgeCorners = (event: KeyboardEvent, selected: number[]) => {
    const step = arrowSteps[event.key]; if (!step || !send || drag.current) return;
    event.preventDefault(); setSelectedCorners(selected);
    const amount = event.altKey ? .1 : event.shiftKey ? 10 : 1;
    const next = moveAlignmentCorners(effectiveQuad, alignment.bounds, selected, { x: step.x * amount / WIDTH, y: step.y * amount / HEIGHT });
    if (next) send({ type: 'calibration.set', quad: next });
  };
  return <><div hidden={!active} className={`viewport ${clean ? 'clean' : ''} ${!aligning ? 'layout-view' : ''}`} ref={viewport}
    onPointerMove={move} onPointerUp={finishDrag} onPointerCancel={finishDrag} onLostPointerCapture={finishDrag}>
    <div className="logical-stage" style={{ transform: `scale(${scale})`, filter: `brightness(${scene.display?.brightness ?? 1})`, visibility: clean && scene.display?.blackout ? 'hidden' : undefined }}>
      <div className={`render-plane ${scene.showGrid ? 'with-grid' : ''}`} style={{ transform: cssMatrix(quad), clipPath: measuredMaskCSS(surface.measurement) ?? surfaceClipPath(surface, WIDTH, HEIGHT) }}>
        <SurfaceArtwork scene={scene} surface={surface} liveVideos={playing || clean || aligning} highResolution={clean} active={active} backgroundOnly />
        {layers.filter(c => 'kind' in c && c.kind !== 'art' && layerVisible(c)).map(c => 'kind' in c && !(c.kind === 'youtube' && !window.projectionMedia && showPlayers) ? <div key={c.id} className="painted-layer" data-layer-id={c.id} style={{ zIndex: zIndex(c.id), opacity: layerOpacity(c) }}>
          <LayerArtwork content={c} scene={scene} output={clean} active={active} />
        </div> : null)}
        {!clean && !aligning && scene.contents.filter(c => c.surfaceId === surface.id && c.kind !== 'art' && layerVisible(c) && !(playing && (c.kind === 'youtube' || c.kind === 'program'))).map(c => <div key={c.id}
          className={'content-hitbox ' + (c.id === scene.selectedContentId ? 'selected ' : '') + (playing && c.kind === 'game' ? 'playing' : '')}
          style={{ left: c.bounds.x * WIDTH, top: c.bounds.y * HEIGHT, width: c.bounds.w * WIDTH, height: c.bounds.h * HEIGHT, zIndex: zIndex(c.id), cursor: c.layer?.locked ? 'default' : undefined }}
          role="group" aria-label={c.title + ' · ' + c.kind} tabIndex={0}
          onFocus={() => { if (scene.selectedContentId !== c.id) send?.({ type: 'content.select', id: c.id }); }}
          onPointerDown={playing && c.kind === 'game' ? undefined : event => start(event, 'move', undefined, undefined, c)}>
          <span className="visually-hidden">{c.kind === 'note' ? c.config.text : c.kind === 'recipe' ? c.state.stepIndex < 0 ? c.config.ingredients.join(', ') : c.config.steps[c.state.stepIndex] : c.kind === 'game' ? 'Score ' + c.state.score : c.title}</span>
          {playing && c.kind === 'game' ? <div className="game-input-grid" style={{ left: GAME_GRID.x * 100 + '%', top: GAME_GRID.y * 100 + '%', width: GAME_GRID.w * 100 + '%', height: GAME_GRID.h * 100 + '%' }}>
            {Array.from({ length: 8 }, (_, index) => <button key={index} aria-label={'Target ' + (index + 1) + (c.state.status === 'running' && gameTarget(c) === index ? ', lit' : '')}
              disabled={c.state.status !== 'running'} onClick={() => send?.({ type: 'game.hit', id: c.id, round: c.state.round, target: index })} />)}
          </div> : <button className="resize-handle" aria-label={'Resize ' + c.title} onPointerDown={event => start(event, 'resize', undefined, undefined, c)} />}
        </div>)}
        {active && !alignmentEditing && (clean || playing && !aligning) && scene.contents.filter(c => c.kind === 'program' && c.surfaceId === surface.id && layerVisible(c)).map(c => <div key={'input-' + c.id}
          role="application" aria-label={'Interact with ' + c.title} tabIndex={0}
          style={{ position: 'absolute', left: c.bounds.x * WIDTH, top: c.bounds.y * HEIGHT, width: c.bounds.w * WIDTH, height: c.bounds.h * HEIGHT, zIndex: zIndex(c.id), touchAction: 'none', cursor: 'crosshair', outline: 'none' }}
          onPointerDown={event => { event.stopPropagation(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); const r = viewport.current!.getBoundingClientRect(); const p = programPoint(quad, { x: (event.clientX-r.left)/r.width, y: (event.clientY-r.top)/r.height },c.bounds); if (p) programInput(c.id, { type: 'pointerdown', ...p }); }}
          onPointerMove={event => { event.stopPropagation(); const r = viewport.current!.getBoundingClientRect(); const p = programPoint(quad, { x: (event.clientX-r.left)/r.width, y: (event.clientY-r.top)/r.height },c.bounds); if (p) programInput(c.id, { type: 'pointermove', ...p }); }}
          onPointerUp={event => { event.stopPropagation(); const r = viewport.current!.getBoundingClientRect(); const p = programPoint(quad, { x: (event.clientX-r.left)/r.width, y: (event.clientY-r.top)/r.height },c.bounds); if (p) programInput(c.id, { type: 'pointerup', ...p }); }}
          onPointerCancel={() => programInput(c.id, { type: 'pointerup', x: .5, y: .5 })}
          onKeyDown={event => { if (event.key === 'Escape' || !/^[a-zA-Z0-9 _-]{1,24}$/.test(event.key)) return; event.stopPropagation(); event.preventDefault(); if (!event.repeat) programInput(c.id, { type: 'keydown', key: event.key }); }}
          onKeyUp={event => { if (event.key === 'Escape' || !/^[a-zA-Z0-9 _-]{1,24}$/.test(event.key)) return; event.stopPropagation(); event.preventDefault(); programInput(c.id, { type: 'keyup', key: event.key }); }} />)}
        {scene.showGrid && <><div className="grid-axis horizontal" /><div className="grid-axis vertical" />
          <span className="grid-label tl">01 · TOP LEFT</span><span className="grid-label tr">02 · TOP RIGHT</span>
          <span className="grid-label br">03 · BOTTOM RIGHT</span><span className="grid-label bl">04 · BOTTOM LEFT</span>
          <span className="grid-center">{surface.name.toUpperCase()}<span>1920 × 1080 · test pattern</span></span></>}
        {scene.contents.filter(c => c.kind === 'youtube' && (window.projectionMedia ? c.surfaceId === surface.id : openedPlayers.has(c.id))).map(c => c.kind === 'youtube' ? <div key={c.id} className="youtube-position" hidden={!showPlayers || c.surfaceId !== surface.id || !layerVisible(c)}
          style={{ left: c.bounds.x * WIDTH, top: c.bounds.y * HEIGHT, width: c.bounds.w * WIDTH, height: c.bounds.h * HEIGHT, zIndex: zIndex(c.id), opacity: layerOpacity(c) }}>
          <YouTubePlayer content={c} feedbackHost={feedbackHost} visible={showPlayers && c.surfaceId === surface.id} />
        </div> : null)}
        {scene.timers.filter(t => t.surfaceId === surface.id && layerVisible(t)).map(timer => <div key={timer.id} data-layer-id={timer.id} className={`timer-container ${!clean && !aligning ? 'editable' : ''} ${!clean && !aligning && timer.id === scene.selectedTimerId ? 'selected' : ''}`}
          style={{ left: timer.bounds.x * WIDTH, top: timer.bounds.y * HEIGHT, width: timer.bounds.w * WIDTH, height: timer.bounds.h * HEIGHT, zIndex: zIndex(timer.id), opacity: layerOpacity(timer) }}
          onPointerDown={!aligning ? event => start(event, 'move', timer) : undefined}>
          <TimerFace timer={timer} now={now} />
          {!clean && !aligning && timer.id === scene.selectedTimerId && <button className="resize-handle" aria-label={`Resize ${timer.title}`} onPointerDown={event => start(event, 'resize', timer)} />}
        </div>)}
      </div>
    </div>
    {(!clean || alignmentEditing) && mode === 'align' && <>
      {send && <div className="alignment-move-area" role="button" tabIndex={0} aria-label={alignment.video ? "Move video projection" : "Move entire projection"}
        title="Drag to move. Hold Shift for fine dragging or Alt for extra fine. Arrow keys nudge; Shift + arrows moves 10 pixels."
        style={{ clipPath: `polygon(${alignment.corners.map(p => `${p.x * 100}% ${p.y * 100}%`).join(',')})` }}
        onPointerDown={event => start(event, 'projection')}
        onKeyDown={event => {
          const steps: Record<string, Point> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } };
          const step = steps[event.key]; if (!step) return;
          event.preventDefault(); const amount = event.shiftKey ? 10 : 1;
          send({ type: 'calibration.set', quad: moveAlignment(scene.manualOutput.quad, alignment.bounds, { x: step.x * amount / WIDTH, y: step.y * amount / HEIGHT }) });
        }} />}
      <svg className="quad-outline" viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
        <polygon aria-hidden="true" points={alignment.corners.map(p => `${p.x * WIDTH},${p.y * HEIGHT}`).join(' ')} />
        {send && alignment.corners.map((p, i) => {
          const end = alignment.corners[(i + 1) % 4], selected = [i, (i + 1) % 4];
          return <g key={i} className={'alignment-edge' + (selected.every(index => selectedCorners.includes(index)) ? ' selected' : '')}>
            <line className="alignment-edge-hit" x1={p.x * WIDTH} y1={p.y * HEIGHT} x2={end.x * WIDTH} y2={end.y * HEIGHT}
              role="button" tabIndex={0} aria-label={`Move ${edges[i]} edge`}
              onPointerDown={event => start(event, 'edge', undefined, i)} onKeyDown={event => nudgeCorners(event, selected)}>
              <title>Drag the {edges[i]} edge to move both corners together. Arrow keys nudge.</title>
            </line>
            <line className="alignment-edge-highlight" aria-hidden="true" x1={p.x * WIDTH} y1={p.y * HEIGHT} x2={end.x * WIDTH} y2={end.y * HEIGHT} />
          </g>;
        })}
      </svg>
      {alignment.corners.map((p, i) => <button key={i} className={'corner-handle' + (selectedCorners.includes(i) ? ' selected' : '')} aria-pressed={selectedCorners.includes(i)} aria-label={`Move ${corners[i]} corner`} title={`${corners[i]} · Shift-click to add/remove selection; drag selected corners together. Alt-drag for precision.`}
        style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }} onPointerDown={event => start(event, 'corner', undefined, i)}
        onKeyDown={event => {
          if (event.key === ' ' || event.key === 'Enter') {
            event.preventDefault(); setSelectedCorners(previous => event.shiftKey ? previous.includes(i) ? previous.filter(index => index !== i) : [...previous, i] : [i]); return;
          }
          nudgeCorners(event, selectedCorners.includes(i) ? selectedCorners : [i]);
        }}><span>{cornerTags[i]}</span></button>)}
    </>}
    {!clean && !scene.timers.some(t => t.surfaceId === surface.id) && !scene.contents.some(c => c.surfaceId === surface.id) && !scene.showGrid && <div className="empty-stage"><span className="empty-symbol">＋</span><strong>Your surface is ready.</strong><span>Add content to start making it useful.</span></div>}
  </div>{!clean && <div className="youtube-feedback-list" ref={setFeedbackHost} />}</>;
}

export function NumberField({ label, value, min, max, step = 1, disabled = false, onCommit, suffix }: {
  label: string; value: number; min: number; max: number; step?: number; disabled?: boolean; onCommit: (n: number) => void; suffix?: string;
}) {
  const [draft, setDraft] = useState(String(value));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setDraft(String(value)); }, [value]);
  const commit = () => {
    focused.current = false;
    const n = Number(draft);
    setDraft(String(value));
    if (draft.trim() && Number.isFinite(n) && n >= min && n <= max) onCommit(n);
  };
  return <label className="field"><span>{label}</span><div className="number-wrap"><input type="number" min={min} max={max} step={step} disabled={disabled} value={draft}
    onFocus={() => { focused.current = true; }} onChange={event => setDraft(event.target.value)} onBlur={commit}
    onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { setDraft(String(value)); focused.current = false; } }} />{suffix && <em>{suffix}</em>}</div></label>;
}

export function TimerControls({ timer, now, send }: { timer: Timer; now: number; send: (c: Command) => void }) {
  const [name, setName] = useState(timer.title);
  useEffect(() => setName(timer.title), [timer.id, timer.title]);
  const done = remaining(timer, now) === 0 && timer.status !== 'idle';
  const updateBounds = (key: keyof Bounds, percent: number) => send({ type: 'timer.move', id: timer.id, bounds: { ...timer.bounds, [key]: percent / 100 } });
  return <>
    <div className="section-heading"><span className="eyebrow">TIMER SETTINGS</span><button className="text-button danger" onClick={() => send({ type: 'timer.remove', id: timer.id })}>Remove</button></div>
    <label className="field"><span>Label</span><input value={name} maxLength={60} onChange={e => setName(e.target.value)} onBlur={() => {
      if (name.trim()) send({ type: 'timer.update', id: timer.id, title: name }); else setName(timer.title);
    }} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} /></label>
    <NumberField label="Duration" value={Number((timer.durationMs / 60000).toFixed(3))} min={1 / 60} max={1440} step={.5} suffix="min"
      disabled={timer.status !== 'idle'} onCommit={n => send({ type: 'timer.update', id: timer.id, durationMs: Math.round(n * 60000) })} />
    <div className="timer-actions"><button className="primary" disabled={done} onClick={() => send({ type: 'timer.action', id: timer.id, action: timer.status === 'running' ? 'pause' : 'start' })}>
      {done ? 'Finished' : timer.status === 'running' ? 'Ⅱ  Pause' : timer.status === 'paused' ? '▶  Resume' : '▶  Start timer'}</button>
      <button className="secondary" onClick={() => send({ type: 'timer.action', id: timer.id, action: 'reset' })}>Reset</button></div>
    <p className="hint">{timer.status === 'idle' ? 'The countdown keeps running through layout changes.' : done ? 'Time is up. Reset to start again.' : 'Reset to change the duration.'}</p>
    <div className="divider" />
    <span className="eyebrow">POSITION & SIZE</span>
    <div className="field-grid">
      <NumberField label="Left" value={Math.round(timer.bounds.x * 1000) / 10} min={0} max={100} step={.5} suffix="%" onCommit={n => updateBounds('x', n)} />
      <NumberField label="Top" value={Math.round(timer.bounds.y * 1000) / 10} min={0} max={100} step={.5} suffix="%" onCommit={n => updateBounds('y', n)} />
      <NumberField label="Width" value={Math.round(timer.bounds.w * 1000) / 10} min={18} max={100} step={.5} suffix="%" onCommit={n => updateBounds('w', n)} />
      <NumberField label="Height" value={Math.round(timer.bounds.h * 1000) / 10} min={18} max={100} step={.5} suffix="%" onCommit={n => updateBounds('h', n)} />
    </div>
    <button className="secondary full-width" onClick={() => send({ type: 'timer.move', id: timer.id, bounds: { ...timer.bounds, x: (1 - timer.bounds.w) / 2, y: (1 - timer.bounds.h) / 2 } })}>Center on surface</button>
  </>;
}

export function CalibrationControls({ scene, send }: { scene: Scene; send: (c: Command) => void }) {
  const alignment = manualAlignment(scene, readMediaPicture);
  const update = (index: number, axis: 'x' | 'y', value: number) => {
    const quad = moveAlignmentCorner(scene.manualOutput.quad, alignment.bounds, index, { ...alignment.corners[index], [axis]: value / 100 });
    if (quad) send({ type: 'calibration.set', quad });
  };
  return <>
    <span className="eyebrow">FOUR-CORNER ALIGNMENT</span>
    <h3>{alignment.video ? "Position the video." : "Fit the light to the surface."}</h3>
    <p className="hint">{alignment.video ? `Corners follow “${alignment.video.title}”. Drag the video to move it, or a corner to reshape it. Its backlight and the rest of this surface follow along.` : "Drag the image to move it without resizing. Drag a corner to change its shape. Content follows the same perspective."}</p>
    <p className="hint">Drag an edge to move both ends. Shift-click corners to select a group, then drag any selected corner; their spacing stays fixed. Shift-click again to deselect. Arrow keys nudge the group; Shift + arrows nudges 10 pixels.</p>
    <div className="corner-fields">{alignment.corners.map((p, i) => <div key={i} className="corner-row"><span className="corner-tag" title={corners[i]}>{cornerTags[i]}</span>
      <NumberField label={`${cornerTags[i]} X`} value={Math.round(p.x * 1000) / 10} min={0} max={100} step={.1} suffix="%" onCommit={n => update(i, 'x', n)} />
      <NumberField label={`${cornerTags[i]} Y`} value={Math.round(p.y * 1000) / 10} min={0} max={100} step={.1} suffix="%" onCommit={n => update(i, 'y', n)} />
    </div>)}</div>
    <button className="secondary full-width" onClick={() => send({ type: 'calibration.reset' })}>Reset corners</button>
    <p className="hint">{scene.manualOutput.calibration === 'measured-planar' ? 'This alignment came from a measured planar capture. Adjusting a corner switches to manual alignment.' : 'Use Hardware setup for Kinect-assisted planar calibration.'}</p>
  </>;
}
