import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialScene, reduceScene, type Command } from '../src/shared/domain';
import { compositionCommands, makeComposition, reduceBatch } from '../src/shared/studioScene';
import { adjustmentFor, mergeAdjustment } from '../src/shared/adjustments';
import { createChatController, type AgentCanvas } from '../host/chat-controller';
import type { AgentMemory } from '../src/shared/studio';

const note: Command = { type: 'content.create', id: 'note', title: 'A note', surfaceId: 'back-wall', spec: { kind: 'note', config: { text: 'Hello', accent: '#ffffff' } } };
test('batch publishes one revision and never partially applies or accepts a stale scene', () => {
  const original = initialScene(), scene = { ...original, selectedSurfaceId: 'wall' };
  const id = scene.surfaces[1].id;
  const create = { ...note, surfaceId: id };
  const next = reduceBatch(scene, [create, { type: 'content.move', id: 'note', bounds: { x: .2, y: .2, w: .3, h: .3 } }], scene.revision);
  assert.equal(next.revision, scene.revision + 1); assert.equal(next.contents.length, 1); assert.equal(scene.contents.length, 0);
  assert.throws(() => reduceBatch(scene, [create, { type: 'content.remove', id: 'missing' }], scene.revision));
  assert.equal(scene.contents.length, 0);
  assert.throws(() => reduceBatch(next, [create], scene.revision), /scene changed/);
  assert.throws(() => reduceBatch(scene, [{ type: 'effect.set', enabled: true }], scene.revision), /Unsupported/);
  assert.throws(() => reduceBatch(scene, Array.from({ length: 161 }, () => create), scene.revision), /160/);
});
test('composition recall preserves current calibration and room geometry, pauses artwork, restores layouts and layer settings', () => {
  let scene = initialScene(); const surfaceId = scene.surfaces[1].id;
  scene = reduceScene(scene, { ...note, surfaceId });
  scene = reduceScene(scene, { type: 'content.create', id: 'art', title: 'Stars', surfaceId, spec: { kind: 'art', config: { preset: 'stars', palette: 'violet', speed: 1, seed: 42 } } });
  scene = reduceScene(scene, { type: 'content.move', id: 'note', bounds: { x: .3, y: .2, w: .25, h: .3 } });
  scene = reduceScene(scene, { type: 'layer.configure', id: 'note', settings: { opacity: .6, visible: false, locked: true } });
  const saved = makeComposition(scene, 'Movie room', 'saved');
  scene = reduceScene(scene, { type: 'content.remove', id: 'note' });
  scene = reduceScene(scene, { type: 'manual.target', surfaceId });
  scene = reduceScene(scene, { type: 'calibration.set', quad: [{ x: .1, y: .15 }, { x: .9, y: .1 }, { x: .85, y: .85 }, { x: .1, y: .9 }] });
  const recalled = reduceBatch(scene, compositionCommands(scene, saved), scene.revision);
  assert.deepEqual(recalled.manualOutput, scene.manualOutput); assert.deepEqual(recalled.surfaces, scene.surfaces);
  assert.equal(recalled.geometryRevision, scene.geometryRevision);
  assert.deepEqual(recalled.contents.find(c => c.id === 'note')!.bounds, saved.contents.find(c => c.id === 'note')!.bounds);
  assert.equal(recalled.contents.find(c => c.id === 'note')!.layer!.opacity, .6);
  const art = recalled.contents.find(c => c.kind === 'art'); assert.equal(art?.kind === 'art' && art.state.clock.running, false);
  const changed = structuredClone(scene); changed.surfaces[1].width += 1;
  assert.throws(() => compositionCommands(changed, saved), /surface shape changed/);
});
test('completed manual changes record bounded relevant facts and coalesce first-before/final-after', () => {
  let scene = initialScene(); const surfaceId = scene.surfaces[0].id;
  scene = reduceScene(scene, { ...note, surfaceId });
  const move: Command = { type: 'content.move', id: 'note', bounds: { x: .1, y: .1, w: .3, h: .3 } };
  const next = reduceScene(scene, move), end = reduceScene(next, { ...move, bounds: { ...move.bounds, x: .2 } });
  const a = adjustmentFor(move, scene, next, 'room', 'a')!, b = adjustmentFor(move, next, end, 'room', 'b')!;
  const merged = mergeAdjustment(a, b);
  assert.deepEqual(merged.before, scene.contents[0]); assert.deepEqual(merged.after, end.contents[0]); assert.equal(merged.id, 'a');
  assert.equal(merged.actor, 'user'); assert.equal(merged.surfaceId, surfaceId);
  assert.equal(adjustmentFor({ type: 'content.select', id: 'note' }, scene, next, 'room', 'c'), null);
  assert.equal(adjustmentFor(move, scene, scene, 'room', 'c'), null);
});
test('Studio port is guarded after cancellation and outside active agent turns', async () => {
  let calls = 0, bound!: AgentCanvas;
  const scene = initialScene();
  const canvas = {
    getSnapshot: async () => ({ scene, saveStatus: 'saved' as const, saveError: null, storage: 'browser' as const, displays: [], output: { open: false, fullscreen: false, displayId: null } }),
    dispatch: async () => ({ ok: true as const, scene }),
    studio: { inspect: async () => ({ roomId: 'fixture' }) as never, observe: async () => { calls++; return {} as never; }, execute: async () => { calls++; return {} as never; } },
  };
  const chat = createChatController(canvas, async port => { bound = port; return { busy: false, clear() {}, cancel() {}, async send() { await port.studio!.execute({ type: 'asset.import' }); chat.cancel(); assert.throws(() => port.studio!.execute({ type: 'asset.import' }), /stopped/); return { text: '', status: 'complete' }; } }; }, () => {});
  await chat.getState(); assert.throws(() => bound.studio!.execute({ type: 'asset.import' }), /stopped/);
  await chat.send('Choose an asset'); assert.equal(calls, 1);
  assert.throws(() => bound.studio!.observe({}), /stopped/); chat.dispose();
});
test('memory management reports persistence failures and rejects synthetic manual demonstrations', async () => {
  const scene = initialScene(); let recorded = 0;
  const memory: AgentMemory = { list: async () => ({ entries: [], events: [], enabled: true }), put: async () => { throw new Error('Disk full; memory not saved.'); }, remove: async () => {}, clear: async () => {}, setEnabled: async () => {}, record: async () => { recorded++; } };
  const chat = createChatController({ getSnapshot: async () => ({ scene } as never), dispatch: async () => ({ ok: true, scene }) }, async () => ({ memory, busy: false, clear() {}, cancel() {}, send: async () => ({ text: '', status: 'complete' }) }), () => {});
  await assert.rejects(chat.memory({ action: 'put', entry: { kind: 'preference', text: 'Soft light', roomId: 'fixture' } }), /not saved/);
  await assert.rejects(chat.memory({ action: 'record', event: { actor: 'agent' } as never }), /manual/);
  assert.equal(recorded, 0); assert.equal((await chat.memory({ action: 'list' })).enabled, true); chat.dispose();
});
