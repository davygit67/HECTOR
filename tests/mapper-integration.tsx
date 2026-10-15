import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { initialScene, reduceScene, readScene, type Command, type Scene } from '../src/shared/domain';
import type { MediaContent } from '../src/shared/content';
import { Stage } from '../src/SurfaceEditor';
import { LayerControls, DisplayControls } from '../src/LayerControls';
import { ContentControls } from '../src/ContentControls';
import { ProjectionOutput, type ProjectionOutputHandle } from '../src/ProjectionOutput';
import { configureLocalMedia, importMedia, localMediaSource, removeMediaAsset } from '../src/localMedia';
import { paintMedia } from '../src/mediaPainter';
import { defaultSpec } from '../src/shared/content';
import { surfaceLayers } from '../src/shared/layers';
import { cssMatrix } from '../src/shared/geometry';
import '../src/styles.css';
import '../src/spatial.css';

const initial = reduceScene(reduceScene(initialScene(), { type: 'manual.target', surfaceId: 'wall' }), { type: 'surface.select', id: 'wall' });
initial.effect.enabled = false;
const assets: string[] = [];
const alignmentSession = 'fixture-' + crypto.randomUUID();
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const sameMatrix = (actual: string | undefined, expected: string) => !!actual && Array.from(new DOMMatrix(actual).toFloat64Array()).every((n, i) => Math.abs(n - new DOMMatrix(expected).toFloat64Array()[i]) < .001);
async function waitFor(test: () => boolean) { for (let n = 0; n < 100; n++) { if (test()) return; await pause(50); } throw new Error('Timed out waiting for decoded media.'); }
function Fixture() {
  const [scene, setScene] = useState(initial), current = useRef(scene); current.current = scene;
  const [result, setResult] = useState('Not run'), [stats, setStats] = useState(''), [mode, setMode] = useState<'align' | 'arrange'>('arrange');
  const dispatches = useRef(0), output = useRef<ProjectionOutputHandle>(null);
  const previews = useRef({ frames: 0, commits: 0 });
  configureLocalMedia(scene);
  const send = (command: Command) => { dispatches.current++; setScene(old => reduceScene(old, command)); return { ok: true }; };
  useEffect(() => {
    const previewBus = new BroadcastChannel('projection-mapper-alignment-' + alignmentSession);
    previewBus.onmessage = event => { if (event.data?.final) previews.current.commits++; else previews.current.frames++; };
    const timer = setInterval(() => {
      const video = localMediaSource('fixture-video'), v = video?.element as HTMLVideoElement | undefined;
      const present = document.querySelector<HTMLElement>('.projection-presentation:not([hidden])');
      const plane = present?.querySelector<HTMLElement>('.render-plane');
      setStats(JSON.stringify({ dispatches: dispatches.current, previews: previews.current, order: surfaceLayers(current.current, 'wall').map(c => c.id), videoReady: video?.ready, videoTime: v?.currentTime, videoPaused: v?.paused, videoMuted: v?.muted, sameGeometry: !plane || sameMatrix(plane.style.transform, cssMatrix(current.current.manualOutput.quad)), outputMode: present?.dataset.mode, outputHandles: present?.querySelectorAll('.corner-handle').length, cleanControlsHidden: !present || present.querySelector<HTMLElement>('.projection-controls')?.hidden, markerSize: getComputedStyle(document.querySelector('.corner-handle') ?? document.body, '::before').width }, null, 2));
    }, 250);
    return () => { clearInterval(timer); previewBus.close(); };
  }, []);
  const run = async () => {
    setResult('Running silent media checks…');
    try {
      const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
      const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 160, 180); ctx.fillStyle = '#0000ff'; ctx.fillRect(160, 0, 160, 180);
      const blob = await new Promise<Blob>(resolve => canvas.toBlob(b => resolve(b!), 'image/png'));
      const image = await importMedia(new File([blob], 'fixture-red-blue.png', { type: 'image/png' })); assets.push(image.assetId);
      const videoBlob = await (await fetch('./fixtures/mapper-silent.mp4')).blob();
      const video = await importMedia(new File([videoBlob], 'fixture.mp4', { type: 'video/mp4' })); assets.push(video.assetId);
      let s: Scene = structuredClone(initial);
      s = reduceScene(s, { type: 'content.create', id: 'fixture-image', title: 'Red blue image', surfaceId: 'wall', spec: { kind: 'media', config: image } });
      s = reduceScene(s, { type: 'content.create', id: 'fixture-video', title: 'Silent local video', surfaceId: 'wall', spec: { kind: 'media', config: video } });
      s = reduceScene(s, { type: 'content.create', id: 'fixture-note', title: 'Top note', surfaceId: 'wall', spec: defaultSpec('note') });
      s = reduceScene(s, { type: 'timer.create', id: 'fixture-timer', title: 'Front timer', surfaceId: 'wall', durationMs: 60000 });
      s = reduceScene(s, { type: 'content.select', id: 'fixture-video' });
      setScene(s); configureLocalMedia(s);
      await waitFor(() => !!localMediaSource('fixture-video')?.ready && !!localMediaSource('fixture-image')?.ready);
      const native = localMediaSource('fixture-video')!.element as HTMLVideoElement;
      if (!native.paused || !native.muted) throw new Error('New source did not start paused/muted.');
      const sample = document.createElement('canvas'); sample.width = 320; sample.height = 180; const sampleCtx = sample.getContext('2d')!;
      const content = { ...s.contents[0], bounds: { x: 0, y: 0, w: 1, h: 1 } } as MediaContent;
      paintMedia(sampleCtx, content, 320, 180);
      if (sampleCtx.getImageData(20, 90, 1, 1).data[0] < 240) throw new Error('Local image did not render.');
      content.config = { ...content.config, flipX: true }; sampleCtx.clearRect(0, 0, 320, 180); paintMedia(sampleCtx, content, 320, 180);
      if (sampleCtx.getImageData(20, 90, 1, 1).data[2] < 240) throw new Error('Horizontal flip failed.');
      if (JSON.stringify(readScene(s)) !== JSON.stringify(s)) throw new Error('Media scene round trip failed.');
      s = reduceScene(s, { type: 'content.action', id: 'fixture-video', action: 'start' }); setScene(s); configureLocalMedia(s);
      await waitFor(() => native.currentTime > .1 && !native.paused);
      s = reduceScene(s, { type: 'content.action', id: 'fixture-video', action: 'pause' }); setScene(s); configureLocalMedia(s);
      const stopped = native.currentTime; await pause(250); if (!native.paused || Math.abs(native.currentTime - stopped) > .1) throw new Error('Pause failed.');
      // Dispose and reload from IndexedDB, with no transient blob URL in saved scene.
      configureLocalMedia(initial); configureLocalMedia(s);
      await waitFor(() => !!localMediaSource('fixture-video')?.ready && !!localMediaSource('fixture-image')?.ready);
      setMode('align');
      const bus = new BroadcastChannel('projection-mapper-alignment-' + alignmentSession);
      const shifted = s.manualOutput.quad.map(p => ({ x: p.x + .01, y: p.y })) as typeof s.manualOutput.quad;
      await pause(50); bus.postMessage({ surfaceId: 'wall', quad: shifted });
      await waitFor(() => sameMatrix(document.querySelector<HTMLElement>('.viewport:not(.clean) .render-plane')?.style.transform, cssMatrix(shifted)));
      bus.postMessage({ surfaceId: 'wall', quad: [{ x: NaN, y: 0 }], final: true });
      await pause(50);
      if (!sameMatrix(document.querySelector<HTMLElement>('.viewport:not(.clean) .render-plane')?.style.transform, cssMatrix(shifted))) throw new Error('Invalid transient preview was accepted.');
      bus.postMessage({ surfaceId: 'wall', quad: s.manualOutput.quad, final: true }); bus.close();
      await waitFor(() => sameMatrix(document.querySelector<HTMLElement>('.viewport:not(.clean) .render-plane')?.style.transform, cssMatrix(s.manualOutput.quad)));
      setMode('arrange');
      setResult('PASS: image/video import, paused/muted defaults, decoded pixels, flip, play/pause, scene round trip, disposal, IndexedDB reload and validated transient alignment transport.');
    } catch (error) { setResult('FAIL: ' + (error as Error).message); }
  };
  return <div style={{ padding: 24 }}><h1>Mapper integration checks</h1><p>Isolated in-memory room; silent synthetic files only. No user scene reads or writes.</p>
    <div style={{ display: 'flex', gap: 10, margin: '12px 0' }}><button onClick={run}>Run silent media checks</button><button onClick={() => setMode(mode === 'align' ? 'arrange' : 'align')}>Toggle alignment</button><button onClick={() => output.current?.enter('align')}>Align full screen</button><button onClick={() => output.current?.enter('project')}>Project full screen</button><button onClick={() => { setScene(initial); configureLocalMedia(initial); assets.splice(0).forEach(id => void removeMediaAsset(id)); setResult('Fixture media cleared'); }}>Clear fixture media</button></div>
    <p id="test-result" role="status">{result}</p>
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(480px, 1fr) 300px', gap: 20, marginTop: 20 }}><div><Stage alignmentSession={alignmentSession} scene={scene} now={Date.now()} mode={mode} send={send} /><LayerControls scene={scene} send={send} /><DisplayControls scene={scene} send={send} /><pre id="checks">{stats}</pre></div><aside>{scene.contents.find(c => c.id === scene.selectedContentId) && <ContentControls content={scene.contents.find(c => c.id === scene.selectedContentId)!} scene={scene} send={send} onPlay={() => {}} />}</aside></div>
    <ProjectionOutput alignmentSession={alignmentSession} ref={output} scene={scene} now={Date.now()} send={send} saveStatus="saved" />
  </div>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
