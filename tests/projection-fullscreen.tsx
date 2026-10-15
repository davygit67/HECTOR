import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { ProjectionOutputHandle } from '../src/ProjectionOutput';
import { initialScene, reduceScene, type Command } from '../src/shared/domain';
import { cssMatrix } from '../src/shared/geometry';
import { manualAlignment } from '../src/shared/manualAlignment';
import { startNativeMedia, configureMedia } from '../src/nativeMedia';
import { analyzeColors } from '../src/shared/backlight';
import type { MediaEvent } from '../src/shared/media';
import { defaultSpec } from '../src/shared/content';
import '../src/styles.css';
import '../src/spatial.css';
import '../src/hardware.css';

let initial = initialScene();
for (const command of [
  { type: 'manual.target', surfaceId: 'wall' },
  { type: 'surface.demo-exclusion', id: 'wall', enabled: false },
  { type: 'effect.set', enabled: false },
  { type: 'grid.set', visible: true },
  { type: 'content.create', id: 'test-art', title: 'Silent test art', surfaceId: 'wall', spec: defaultSpec('art') },
  { type: 'calibration.set', quad: [{ x: .17, y: .13 }, { x: .85, y: .2 }, { x: .78, y: .87 }, { x: .11, y: .78 }] },
] as const) initial = reduceScene(initial, command as any);
const videoFixture = new URLSearchParams(location.search).has('video');
let emit: (event: MediaEvent) => void = () => {};
let mediaCommands = 0;
if (videoFixture) {
  initial = reduceScene(initial, { type: 'content.remove', id: 'test-art' });
  initial = reduceScene(initial, { type: 'content.create', id: 'silent-video', surfaceId: 'wall', title: 'Silent video fixture', spec: { kind: 'youtube', config: { videoId: 'M7lc1UVf-VE', startSeconds: 0, backlight: true, backlightSettings: { intensity: 1.4, spread: .3, smoothingMs: 0 } } } });
  initial = reduceScene(initial, { type: 'content.move', id: 'silent-video', bounds: { x: .2, y: .1, w: .6, h: .8 } });
  // Synthetic pixels only. This fixture never opens YouTube or the host's media source.
  window.projectionMedia = { subscribe: listener => { emit = listener; return () => {}; }, snapshot: async () => [], command: async () => { mediaCommands++; }, input: async () => { mediaCommands++; } };
  startNativeMedia(); configureMedia(initial);
  const canvas = document.createElement('canvas'); canvas.width = 1920; canvas.height = 1080;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createLinearGradient(0, 0, 1920, 1080); gradient.addColorStop(0, '#ff4ca6'); gradient.addColorStop(.5, '#5c41f5'); gradient.addColorStop(1, '#00c8ff');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 1920, 1080); ctx.strokeStyle = '#fff'; ctx.lineWidth = 12; ctx.strokeRect(6, 6, 1908, 1068);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 100px sans-serif'; ctx.fillText('VIDEO FRAME', 600, 570);
  const small = document.createElement('canvas'); small.width = 96; small.height = 54; const smallCtx = small.getContext('2d')!; smallCtx.drawImage(canvas, 0, 0, 96, 54);
  canvas.toBlob(async blob => {
    const jpeg = new Uint8Array(await blob!.arrayBuffer());
    const state = { contentId: 'silent-video', generation: 1, ready: true, playing: false, hasPlayed: true, muted: true, status: 'Silent synthetic video', currentTime: 0, duration: 1 };
    emit({ type: 'state', state });
    emit({ type: 'frame', frame: { contentId: state.contentId, generation: 1, sequence: 1, width: 1920, height: 1080, jpeg, sample: { colors: analyzeColors(smallCtx.getImageData(0, 0, 96, 54)), sampledAt: Date.now(), costMs: 0, dark: false } } });
    setInterval(() => emit({ type: 'state', state }), 1000);
  }, 'image/jpeg', .95);
}
const { ProjectionOutput } = await import('../src/ProjectionOutput');
const { Stage } = await import('../src/SurfaceEditor');
const before = JSON.stringify(initial);
function Fixture() {
  const [scene, setScene] = useState(initial);
  const send = (command: Command) => setScene(current => reduceScene(current, command));
  const ref = useRef<ProjectionOutputHandle>(null), [checks, setChecks] = useState({}), [standalone, setStandalone] = useState(false);
  useEffect(() => {
    const interval = setInterval(() => {
      const output = document.querySelector<HTMLElement>('.projection-presentation')!;
      const plane = output.querySelector<HTMLElement>('.render-plane');
      const host = output.hidden ? document.querySelector<HTMLElement>('#fixture-controls .viewport')! : output;
      const videoCorners = [...host.querySelectorAll<HTMLElement>('[data-native-corner]')].map(n => n.getBoundingClientRect());
      const handles = [...host.querySelectorAll<HTMLElement>('.corner-handle')].map(n => n.getBoundingClientRect());
      const anchorErrorPixels = videoCorners.length === 4 && handles.length === 4 ? Math.max(...handles.map((r, i) => Math.hypot(r.x + r.width / 2 - videoCorners[i].x, r.y + r.height / 2 - videoCorners[i].y))) : null;
      setChecks({ videoFixture, anchorErrorPixels, mediaCommands, anchorCorners: manualAlignment(scene).corners, active: !output.hidden, mode: output.dataset.mode, quad: scene.manualOutput.quad, browserFullscreen: document.fullscreenElement === output,
        outputBackground: getComputedStyle(output).backgroundColor, gridVisible: !!plane?.classList.contains('with-grid'),
        cornerHandles: output.querySelectorAll('.corner-handle').length,
        savedAlignmentPreserved: !plane || Array.from(new DOMMatrix(plane.style.transform).toFloat64Array()).every((v, i) => Math.abs(v - new DOMMatrix(cssMatrix(scene.manualOutput.quad)).toFloat64Array()[i]) < .001),
        controlsVisible: output.classList.contains('controls-visible'), sceneUnchanged: before === JSON.stringify(scene),
        studioInert: document.querySelector<HTMLElement>('#fixture-controls')?.inert });
    }, 250);
    return () => clearInterval(interval);
  }, [scene]);
  return <><div id="fixture-controls" style={{ padding: 30 }}><h1>Fullscreen projection verification</h1><p>Silent generated content. The saved grid remains enabled in the editor; presentation hides it without editing the scene.</p>
    <button className="primary" onClick={() => ref.current?.enter()}>Project full screen</button><button onClick={() => ref.current?.enter('align')}>Align full screen</button>
    <button className="secondary" onClick={() => setStandalone(true)}>Test separate output</button>
    <pre id="results" style={{ maxHeight: 230, overflow: 'auto' }}>{JSON.stringify(checks, null, 2)}</pre><div style={{width: 480}}><Stage scene={scene} now={0} mode="align" send={send} /></div></div>
    <ProjectionOutput key={String(standalone)} ref={ref} scene={scene} now={0} standalone={standalone} send={send} saveStatus="saved" /></>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
