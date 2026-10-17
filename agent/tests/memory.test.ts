import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryStore, type AdjustmentEvent } from '../src/memory.js';
const event = (extra: Partial<AdjustmentEvent> = {}): AdjustmentEvent => ({ id: 'drag-1', actor: 'user', roomId: 'room-a', revision: 3,
  geometryRevision: 2, at: 1234, operation: 'content.move', targetId: 'video-1', surfaceId: 'wall',
  before: { x: .2 }, after: { x: .3 }, ...extra });
test('memory persists explicit preferences and deduplicated completed manual examples across sessions', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pm-memory-')); const path = join(dir, 'memory.json');
  const store = createMemoryStore(path);
  const preference = await store.put({ kind: 'preference', roomId: 'room-a', text: 'Keep video light gentle.', activity: 'movies' });
  await Promise.all([store.record(event()), store.record(event())]);
  const restored = createMemoryStore(path); const state = await restored.list();
  assert.equal(state.entries.length, 2); assert.equal(state.events.length, 1);
  assert.equal(state.entries.find(e => e.source === 'observed')?.confidence, 'tentative');
  assert.equal(state.entries.find(e => e.id === preference.id)?.confidence, 'explicit');
  assert.equal((await restored.recall({ prompt: 'movies video', roomId: 'room-b', geometryRevision: 2, surfaceId: 'wall' })).length, 0);
  assert.equal((await restored.recall({ prompt: 'movies video', roomId: 'room-a', geometryRevision: 9, surfaceId: 'wall' })).length, 1);
  await restored.put({ id: preference.id, kind: 'preference', roomId: 'room-a', text: 'Use bright video light.' });
  await restored.remove(state.entries.find(e => e.source === 'observed')!.id);
  assert.equal((await restored.list()).entries.length, 1);
  await restored.clear(); assert.equal((await createMemoryStore(path).list()).entries.length, 0);
});
test('learning excludes agent/system/noop events, records calibration only as fact, and can be paused', async () => {
  const store = createMemoryStore();
  await store.record(event({ actor: 'agent' })); await store.record(event({ actor: 'system' }));
  await store.record(event({ before: { x: .3 } }));
  assert.equal((await store.list()).events.length, 0);
  await store.record(event({ operation: 'calibration.set' }));
  assert.equal((await store.list()).events.length, 1); assert.equal((await store.list()).entries.length, 0);
  await store.setEnabled(false); await store.record(event({ id: 'drag-2' }));
  assert.equal((await store.list()).events.length, 1);
  await store.put({ roomId: 'room-a', kind: 'preference', text: 'Gentle light' });
  assert.deepEqual(await store.recall({ roomId: 'room-a', geometryRevision: 2, prompt: 'light' }), []);
});
test('corrupt memory is preserved and write failures never claim acceptance', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pm-memory-')); const path = join(dir, 'memory.json');
  await writeFile(path, 'broken');
  await assert.rejects(createMemoryStore(path).list(), /preserved/);
  assert.equal(await readFile(path, 'utf8'), 'broken');
  const store = createMemoryStore(join(path, 'invalid.json'));
  await assert.rejects(store.put({ roomId: 'room-a', kind: 'preference', text: 'A preference' }));
});
test('evidence strips sensitive transport fields and rejects oversized payloads', async () => {
  const store = createMemoryStore();
  await store.record(event({ after: { opacity: .4, path: '/private/file', apiKey: 'fixture-secret', dataUrl: 'pixels' } }));
  const state = await store.list(); assert.deepEqual(state.events[0].after, { opacity: .4 });
  assert.doesNotMatch(JSON.stringify(state), /fixture-secret|private\/file|pixels/);
  await assert.rejects(store.record(event({ id: 'big', after: 'x'.repeat(13000) })), /too large/);
});

test('multiple chat sessions share one serialized memory writer per canonical file path', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pm-memory-')); const path = join(dir, 'shared.json');
  const first = createMemoryStore(path), second = createMemoryStore(join(dir, '.', 'shared.json'));
  assert.equal(first, second);
  await Promise.all([first.put({ roomId: 'room', kind: 'preference', text: 'Gentle lighting' }), second.put({ roomId: 'room', kind: 'preference', text: 'Large timers' })]);
  const saved = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(saved.entries.length, 2); assert.equal((await second.list()).entries.length, 2);
});

test('learned examples use readable summaries and changed style evidence without treating note content as preference', async () => {
  const store = createMemoryStore();
  await store.record(event({ operation: 'content.move', after: { title: 'Movie', kind: 'youtube', bounds: { x: .3, y: .2, w: .5, h: .4 }, state: {}, config: { videoId: 'fixture' } }, before: { bounds: { x: .2, y: .2, w: .5, h: .4 } } }));
  const entry = (await store.list()).entries[0];
  assert.match(entry.text, /Movie.*left: 30%/); assert.doesNotMatch(entry.text, /[{]|videoId/); assert.deepEqual(entry.evidence?.settings, { x: .3 });
  await store.record(event({ id: 'note-edit', operation: 'content.update', targetId: 'note', before: { kind: 'note', config: { text: 'Old', accent: '#ffffff' } }, after: { kind: 'note', config: { text: 'New', accent: '#ffffff' } } }));
  assert.equal((await store.list()).entries.length, 1); assert.equal((await store.list()).events.length, 2);
});

test('cache-busted agent imports retain a shared file writer for existing conversations', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pm-memory-')); const path = join(dir, 'hot-reload.json');
  const other = await import(new URL('../src/memory.ts?build=fixture', import.meta.url).href);
  const first = createMemoryStore(path), second = other.createMemoryStore(path);
  assert.equal(first, second);
  await Promise.all([first.put({ roomId: 'room', kind: 'preference', text: 'First window' }), second.put({ roomId: 'room', kind: 'preference', text: 'Second window' })]);
  assert.equal(JSON.parse(await readFile(path, 'utf8')).entries.length, 2);
});
