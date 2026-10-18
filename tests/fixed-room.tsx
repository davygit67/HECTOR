import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { initialScene, reduceScene } from '../src/shared/domain';
import { reduceBatch } from '../src/shared/studioScene';
import { copyFrame, encodeSensorFrame } from '../src/shared/sensor';
import { measuredRoomFixture } from './fixtures/measured-room';
import { solveRoomSurfaces } from '../src/shared/roomSolve';
import { getRoomReference, saveRoomReference, loadRoomReference } from '../src/roomModelStore';
import type { Snapshot, Bridge } from '../src/shared/bridge';
import '../src/styles.css';
import '../src/spatial.css';
import '../src/hardware.css';

// Disposable origin only. Analytic frames pretend to be the SDK solely to exercise provenance guards.
if (location.port !== '5175') throw new Error('Run this isolated fixture on port 5175, never on the user Studio origin.');
let scene = initialScene();
const listeners = new Set<(s: Snapshot) => void>();
const snapshot = (): Snapshot => ({ scene, storage: 'browser', saveStatus: 'saved', saveError: null, displays: [], output: { open: false, fullscreen: false, displayId: null } });
const mockBridge: Bridge = { getSnapshot: async () => snapshot(), subscribe: fn => { listeners.add(fn); return () => { listeners.delete(fn); }; }, output: async () => {}, dispatch: async c => { try { scene = reduceScene(scene, c); listeners.forEach(fn => fn(snapshot())); return { ok: true, scene }; } catch (e) { return { ok: false, error: String(e) }; } } };
window.projection = mockBridge;
mockBridge.batch = async (commands, revision) => { try { scene = reduceBatch(scene, commands, revision); listeners.forEach(fn => fn(snapshot())); return { ok: true, scene }; } catch (e) { return { ok: false, error: String(e) }; } };
const fixture = measuredRoomFixture(), sockets: MockSocket[] = [];
let moved = false;
class MockSocket {
  binaryType = ''; onmessage: ((event: { data: unknown }) => void) | null = null; onclose: (() => void) | null = null;
  onerror: (() => void) | null = null; timer: ReturnType<typeof setInterval>; sequence = 0;
  constructor() {
    sockets.push(this);
    setTimeout(() => this.onmessage?.({ data: JSON.stringify({ protocol: 'pm-sensor', version: 1, type: 'status', mode: 'live', state: 'streaming', message: 'Synthetic integration fixture' }) }), 20);
    this.timer = setInterval(() => {
      const f = copyFrame(fixture.frames[0]); f.device.kind = 'kinect-v2'; f.sequence = this.sequence++; f.capturedAtMs = Date.now();
      for (let i = 0; i < f.depth.length; i++) { f.color.set([90, 190, 170], i * 3); if (moved && f.depth[i]) { f.depth[i] += 100; f.cameraPoints![i * 3 + 2] += .1; } }
      this.onmessage?.({ data: encodeSensorFrame(f).buffer });
    }, 200);
  }
  close() { clearInterval(this.timer); }
  drop() { this.close(); this.onclose?.(); }
}
window.WebSocket = MockSocket as unknown as typeof WebSocket;
const { HardwareWorkspace } = await import('../src/HardwareWorkspace');
const { SpatialView } = await import('../src/SpatialView');
const { executeStudio, studioPort } = await import('../src/studioRuntime');
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const checks: string[] = [];
function assert(ok: unknown, name: string) { if (!ok) throw new Error(name); checks.push('PASS ' + name); }
function App() {
  const [s, setS] = useState(snapshot()), [status, setStatus] = useState('Running isolated workflow…');
  useEffect(() => mockBridge.subscribe(setS), []);
  useEffect(() => { void (async () => {
    await loadRoomReference(); await saveRoomReference(null); await delay(300);
    assert((await executeStudio({ type: 'hardware.action', command: { action: 'connect-live' } })).ok, 'Connect the mock helper');
    await delay(500);
    const capture = await executeStudio({ type: 'hardware.action', command: { action: 'scan-room' } });
    assert(capture.ok, 'Real capture loop and worker complete: ' + capture.message);
    await delay(700); const r = getRoomReference()!;
    assert(r?.positions.length > 15000, 'Stable point cloud persisted');
    assert((await studioPort.inspect()).hardware.roomModel?.state === 'ready', 'Three fresh frames revalidate the saved room');
    const session = structuredClone(fixture); session.provenance = 'sensor'; session.frames.forEach(f => { f.device.kind = 'kinect-v2'; }); session.captures.forEach(c => { c.presentation.mode = 'output-window'; });
    const candidate = solveRoomSurfaces(session, r).candidates[0];
    await mockBridge.dispatch({ type: 'surface.measure', surface: candidate.surface });
    assert(scene.surfaces[0].measurement?.roomReferenceId === r.id, 'Calibrated surface and cloud share a metric frame');
    const blocked = await executeStudio({ type: 'scene.batch', commands: [{ type: 'surface.fill', id: 'tabletop', color: '#ff0000' }], expectedRevision: scene.revision });
    assert(!blocked.ok && blocked.message.includes('Fresh room'), 'No physical fill without a qualified projector output');
    const old = sockets.at(-1)!; old.drop(); await delay(50);
    assert(getRoomReference()?.id === r.id, 'USB loss retains the saved cloud');
    assert((await studioPort.inspect()).hardware.roomModel?.canMap === false, 'USB loss removes live eligibility');
    await delay(1500); assert(sockets.length === 2, 'Transport reconnects automatically');
    assert((await studioPort.inspect()).hardware.roomModel?.state === 'ready', 'New acquisition verifies before reuse');
    moved = true; await delay(500);
    assert((await studioPort.inspect()).hardware.roomModel?.state === 'moved', 'Moved sensor blocks further mapping');
    moved = false; await delay(700);
    assert((await studioPort.inspect()).hardware.roomModel?.state === 'moved', 'Returning geometry cannot silently clear movement warning');
    assert(getRoomReference()?.invalidated === 'moved', 'Movement warning is persisted for later refreshes');
    await executeStudio({ type: 'hardware.action', command: { action: 'disconnect' } });
    setStatus(`${checks.length} checks passed. Analytic fixture only; no physical device used.`);
  })().catch(e => setStatus('FAIL ' + String(e))); }, []);
  return <><main className="hardware-workspace"><h1>Fixed-room integration fixture</h1><p id="result" role="status">{status}</p><pre>{checks.join('\n')}</pre><div style={{ height: 440 }}><SpatialView scene={s.scene} view="orbit" /></div></main><HardwareWorkspace snapshot={s} /></>;
}
createRoot(document.getElementById('root')!).render(<App />);
