import React from 'react';
import { createRoot } from 'react-dom/client';
import { initialScene, reduceScene } from '../src/shared/domain';
import { reduceBatch } from '../src/shared/studioScene';
import type { MemoryState } from '../src/shared/studio';
import type { Snapshot } from '../src/shared/bridge';
import '../src/styles.css';

// Disposable scene/storage and silent media. Never access the user's live room or host agent.
const storage = new Map<string, string>();
Object.defineProperty(window, 'localStorage', { value: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) } });
const open = indexedDB.open.bind(indexedDB);
indexedDB.open = (name, version) => open('studio-tools-fixture-' + name, version);
let scene = initialScene();
const listeners = new Set<(snapshot: Snapshot) => void>();
const snapshot = (): Snapshot => ({ scene: structuredClone(scene), storage: 'browser', saveStatus: 'saved', saveError: null, displays: [], output: { open: false, fullscreen: false, displayId: null } });
const emit = () => listeners.forEach(fn => fn(snapshot()));
window.projection = { getSnapshot: async () => snapshot(), dispatch: async command => { try { scene = reduceScene(scene, command); emit(); return { ok: true, scene: structuredClone(scene) }; } catch (e) { return { ok: false, error: String(e) }; } }, batch: async (commands, revision) => { try { scene = reduceBatch(scene, commands, revision); emit(); return { ok: true, scene: structuredClone(scene) }; } catch (e) { return { ok: false, error: String(e) }; } }, output: async () => {}, subscribe: fn => { listeners.add(fn); return () => { listeners.delete(fn); }; } };
const memory: MemoryState = { entries: [], events: [], enabled: true };
window.projectionChat = { getState: async () => ({ ready: true, busy: false, configurationError: null, progress: null, messages: [] }), send: async () => {}, cancel: async () => {}, clear: async () => {}, subscribe: () => () => {}, memory: async request => {
  if (request.action === 'record' && memory.enabled) memory.events.push(request.event);
  if (request.action === 'setEnabled') memory.enabled = request.enabled;
  if (request.action === 'clear') { memory.entries = []; memory.events = []; }
  if (request.action === 'remove') memory.entries = memory.entries.filter(e => e.id !== request.id);
  if (request.action === 'put') { const entry = { ...request.entry, id: request.entry.id ?? crypto.randomUUID(), source: 'explicit' as const, confidence: 'explicit' as const, updatedAt: Date.now() }; memory.entries = [...memory.entries.filter(e => e.id !== entry.id), entry]; }
  return structuredClone(memory);
} };
const realHost = new URLSearchParams(location.search).has('host');
if (realHost) delete window.projectionChat;
const { SpatialStudio } = await import('../src/SpatialStudio');
const { studioPort } = await import('../src/studioRuntime');
const { bridge, agentDispatch } = await import('../src/bridge');
const { handleCanvasRpc } = await import('../src/chatBridge');
// The scene bridge above is already captured. Use an isolated browser room ID for host checks.
if (realHost) { delete window.projection; scene = reduceScene(scene, { type: 'content.create', id: 'host-fixture-note', surfaceId: scene.surfaces[0].id, title: 'Silent host fixture', spec: { kind: 'note', config: { text: 'HELLO FROM THE STUDIO', accent: '#ff6633' } } }); }
createRoot(document.getElementById('root')!).render(<SpatialStudio />);
const checks = document.getElementById('checks')!;
checks.style.cssText = 'background:white;padding:12px';
const button = document.createElement('button'); button.textContent = 'Run isolated Studio checks'; checks.append(button);
const report = document.createElement('pre'); report.id = 'check-results'; checks.append(report);
const assert = (ok: unknown, message: string) => { if (!ok) throw new Error(message); report.textContent += 'PASS ' + message + '\n'; };
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
button.onclick = async () => {
  button.disabled = true; report.textContent = '';
  try {
    const surfaceId = scene.surfaces[0].id;
    await bridge.dispatch({ type: 'content.create', id: 'fixture-note', title: 'Fixture note', surfaceId, spec: { kind: 'note', config: { text: 'A real rendered preview', accent: '#ff6633' } } });
    await wait(700); assert(memory.events.length === 1, 'one completed manual action is recorded');
    await handleCanvasRpc({ id: 'fixture', operation: 'dispatch', command: { type: 'content.update', id: 'fixture-note', title: 'Agent edit' } });
    await wait(700); assert(memory.events.length === 1, 'agent RPC changes are not mislabeled manual corrections');
    await studioPort.execute({ type: 'ui.navigate', page: 'studio', view: 'arrange', inspector: 'content' });
    await studioPort.execute({ type: 'ui.configure', expandedAssetId: 'fixture-note', coverage: true });
    await wait(100); assert((await studioPort.inspect()).ui.inspector === 'content', 'agent uses integrated Content inspector');
    const saved = await studioPort.execute({ type: 'composition.save', name: 'Fixture composition' });
    assert(saved.ok, 'composition saved');
    const id = (saved.value as { id: string }).id;
    await agentDispatch({ type: 'content.remove', id: 'fixture-note' });
    assert((await studioPort.execute({ type: 'composition.recall', id })).ok && scene.contents.length === 1, 'composition recall restores content atomically');
    const revision = scene.revision;
    const failed = await studioPort.execute({ type: 'scene.batch', expectedRevision: revision, commands: [{ type: 'grid.set', visible: true }, { type: 'content.remove', id: 'nonexistent' }] });
    assert(!failed.ok && scene.revision === revision && !scene.showGrid, 'failed batch leaves scene untouched');
    const observation = await studioPort.observe({ surfaceId, maxWidth: 480 });
    assert(observation.image?.width === 480 && observation.image.data.length > 1000 && !observation.stale, 'actual bounded renderer image with current revision');
    const image = document.createElement('img'); image.src = 'data:image/png;base64,' + observation.image!.data; image.width = 240; image.alt = 'Agent observation of the fixture note'; checks.append(image);
    assert(observation.physical === false, 'preview never claims measured physical output');
    const handoff = await studioPort.execute({ type: 'asset.import' });
    assert(handoff.outcome === 'handoff', 'file chooser requires an explicit click');
    await studioPort.execute({ type: 'ui.navigate', page: 'hardware' }); await wait(150);
    await studioPort.execute({ type: 'hardware.action', command: { action: 'connect-demo' } }); await wait(300);
    assert((await studioPort.inspect()).hardware.provenance === 'synthetic', 'hardware demo keeps explicit synthetic provenance');
    await studioPort.execute({ type: 'hardware.action', command: { action: 'record', seconds: 1 } }); await wait(1500);
    const hardware = (await studioPort.inspect()).hardware;
    assert(!hardware.recording && hardware.sessions.length > 0 && !hardware.geometrySolved, 'sensor recording retained without claiming geometry calibration');
    await studioPort.execute({ type: 'hardware.action', command: { action: 'disconnect' } });
    await studioPort.execute({ type: 'ui.navigate', page: 'studio', inspector: 'assistant' });
    report.textContent += 'ALL CHECKS PASSED\n';
  } catch (error) { report.textContent += 'FAIL ' + String(error); }
};
