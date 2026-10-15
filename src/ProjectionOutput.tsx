import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { Command, Scene } from './shared/domain';
import type { Snapshot } from './shared/bridge';
import { Stage } from './SurfaceEditor';
import { SpatialView } from './SpatialView';
import { PatternOutput } from './CalibrationOutput';
import './projection-output.css';
import { manualAlignment } from './shared/manualAlignment';

type PresentationMode = 'align' | 'project';
export interface ProjectionOutputHandle { enter(mode?: PresentationMode): void }

/** One fixed output viewport: alignment only adds overlays, never changes the geometry. */
export const ProjectionOutput = forwardRef<ProjectionOutputHandle, {
  scene: Scene; now: number; standalone?: boolean; send?: (command: Command) => void;
  issue?: string | null; saveStatus?: Snapshot['saveStatus'];
  alignmentSession?: string;
}>(function ProjectionOutput({ scene, now, standalone = false, send, issue, saveStatus, alignmentSession }, ref) {
  const screen = useRef<HTMLDivElement>(null), lastFocus = useRef<HTMLElement | null>(null);
  const enteredFullscreen = useRef(false);
  const requestVersion = useRef(0), modeRef = useRef<PresentationMode>('project');
  const [active, setActive] = useState(standalone), [fullscreen, setFullscreen] = useState(false);
  const [mode, setMode] = useState<PresentationMode>('project');
  const [grid, setGrid] = useState(true), [toolbarTop, setToolbarTop] = useState(false);
  const [controls, setControls] = useState(true), [error, setError] = useState<string | null>(null);
  const manual = !standalone || scene.outputView === 'manual';
  const editing = mode === 'align' && manual && !!send;
  const changeMode = (next: PresentationMode) => {
    if (next === 'align' && (!manual || !send)) return;
    modeRef.current = next; setMode(next);
    setControls(next === 'align');
    screen.current?.focus({ preventScroll: true });
  };
  const returnToEditor = () => {
    requestVersion.current++;
    setActive(false); setError(null); enteredFullscreen.current = false;
    modeRef.current = 'project'; setMode('project');
  };
  const enter = (requested: PresentationMode = 'project') => {
    const next = requested === 'align' && manual && send ? 'align' : 'project';
    const version = ++requestVersion.current;
    if (!active) lastFocus.current = document.activeElement as HTMLElement | null;
    modeRef.current = next;
    // Commit inside the click gesture, preserving the browser's fullscreen activation.
    flushSync(() => { setActive(true); setMode(next); setControls(next === 'align'); setError(null); });
    screen.current?.focus({ preventScroll: true });
    if (document.fullscreenElement === screen.current) return;
    try {
      if (!screen.current?.requestFullscreen) throw new Error('Fullscreen API unavailable');
      void screen.current.requestFullscreen({ navigationUI: 'hide' }).then(() => {
        if (version !== requestVersion.current && document.fullscreenElement === screen.current) void document.exitFullscreen().catch(() => {});
      }).catch(() => {
        if (version !== requestVersion.current) return;
        setError('Your browser did not enter full screen. Click Full screen again, or press F11 in Chrome on Windows.');
        setControls(true);
      });
    } catch {
      setError('Full screen is unavailable here. Press F11 in Chrome on Windows, or return to the studio.');
      setControls(true);
    }
  };
  const leave = () => {
    if (document.fullscreenElement === screen.current) void document.exitFullscreen().catch(() => {});
    if (!standalone) returnToEditor();
  };
  useImperativeHandle(ref, () => ({ enter }));
  useEffect(() => {
    if (!active || !screen.current) return;
    const siblings = Array.from(screen.current.parentElement?.children ?? []).filter(node => node !== screen.current) as HTMLElement[];
    const previous = siblings.map(node => node.inert), overflow = document.body.style.overflow;
    siblings.forEach(node => { node.inert = true; }); document.body.style.overflow = 'hidden';
    return () => {
      siblings.forEach((node, i) => { node.inert = previous[i]; }); document.body.style.overflow = overflow;
      if (!standalone) lastFocus.current?.focus({ preventScroll: true });
    };
  }, [active, standalone]);
  useEffect(() => {
    const changed = () => {
      const ours = document.fullscreenElement === screen.current;
      setFullscreen(ours);
      if (ours) { enteredFullscreen.current = true; setError(null); setControls(modeRef.current === 'align'); screen.current?.focus({ preventScroll: true }); }
      else if (enteredFullscreen.current) {
        enteredFullscreen.current = false;
        if (!standalone) returnToEditor();
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !active) return;
      if (document.fullscreenElement === screen.current) void document.exitFullscreen().catch(() => {});
      if (!standalone) returnToEditor();
    };
    document.addEventListener('fullscreenchange', changed);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('fullscreenchange', changed); document.removeEventListener('keydown', escape); };
  }, [active, standalone]);
  // Grid is a local alignment aid. Switching modes never changes the saved scene or Stage dimensions.
  const renderScene = { ...scene, showGrid: editing && grid };
  const surfaceName = scene.surfaces.find(s => s.id === scene.manualOutput.surfaceId)?.name ?? 'Surface';
  const shown = editing || (!fullscreen && controls);
  const alignmentVideo = manual ? manualAlignment(scene).video : undefined;
  return <div ref={screen} hidden={!active} tabIndex={-1} data-mode={editing ? 'align' : 'project'}
    className={'projection-presentation' + (shown ? ' controls-visible' : '') + (editing ? ' alignment-editing' : '') + (toolbarTop ? ' toolbar-top' : '')}
    role="region" aria-label="Projection output"
    onKeyDown={event => {
      const target = event.target as HTMLElement;
      if (event.altKey || event.ctrlKey || event.metaKey || target.matches('textarea,select,input:not([type="checkbox"]):not([type="radio"])') || target.isContentEditable) return;
      if (event.key.toLowerCase() === 'a' && manual && send) { event.preventDefault(); changeMode('align'); }
      if (event.key.toLowerCase() === 'p') { event.preventDefault(); changeMode('project'); }
    }}>
    {active && <PatternOutput><main className="output-screen" inert={!editing}><div className="output-fit">
      {manual ? <Stage scene={renderScene} now={now} mode="align" clean alignmentEditing={editing} send={send} alignmentSession={alignmentSession} /> : <div style={{ width: '100%', height: '100%', visibility: scene.display?.blackout ? 'hidden' : undefined }}><SpatialView scene={renderScene} view={scene.outputView as 'projector-a' | 'projector-b'} presenting /></div>}
    </div></main></PatternOutput>}
    <div className="projection-controls" aria-label="Projection controls" hidden={!shown} inert={!shown}>
      <div><strong>{manual ? (editing && alignmentVideo ? alignmentVideo.title : surfaceName) + (editing ? ' · align corners' : ' · projection') : 'Projection output'}</strong>
        <span>{editing ? (alignmentVideo ? 'Corners follow the video; backlight follows along. Drag the video to move; drag a corner to reshape. P projects; A aligns.' : 'Drag the image to move; drag a corner to reshape. Arrow keys nudge; Shift nudges 10. P projects; A aligns.') : !standalone ? 'A shows alignment controls. Esc returns to the studio.' : fullscreen ? 'A shows alignment controls. Esc leaves full screen.' : 'Move this window onto the projector, then choose Align full screen or Full screen.'}</span>
        {editing && <span role="status">{saveStatus === 'error' ? 'Alignment could not be saved. Return to the studio to resolve it.' : saveStatus === 'saving' ? 'Saving alignment…' : saveStatus === 'saved' ? 'Alignment saved' : 'Changes apply immediately'}</span>}</div>
      {manual && send && <div className="projection-mode-buttons" role="group" aria-label="Output mode">
        <button className={editing ? 'primary' : 'secondary'} aria-pressed={editing} onClick={() => fullscreen ? changeMode('align') : enter('align')}>{fullscreen ? 'Align corners' : 'Align full screen'}</button>
        <button className={!editing ? 'primary' : 'secondary'} aria-pressed={!editing} onClick={() => fullscreen ? changeMode('project') : enter('project')}>{fullscreen ? 'Project' : 'Full screen'}</button>
      </div>}
      {editing && <><label className="projection-grid-toggle"><input type="checkbox" checked={grid} onChange={event => setGrid(event.target.checked)} />Alignment grid</label>
        <button className="secondary" onClick={() => setToolbarTop(value => !value)}>Move toolbar {toolbarTop ? 'down' : 'up'}</button></>}
      {!fullscreen && !(manual && send) && <button className="primary" onClick={() => enter()}>Full screen</button>}
      {fullscreen && standalone && <button className="secondary" onClick={leave}>Exit full screen</button>}
      {!standalone && <button className="secondary" onClick={leave}>Back to studio</button>}
      {!fullscreen && !editing && <button className="secondary" onClick={() => { setError(null); setControls(false); }}>Hide controls</button>}
      {(error || issue) && <p role="alert">{error || issue}</p>}
    </div>
  </div>;
});
