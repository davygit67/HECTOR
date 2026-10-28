import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ambientDefaults, initialScene, reduceScene, sceneSchema, type Scene } from '../src/core/model';
import { SceneSession } from '../src/core/session';
import { atomicWrite, documentSchema, readProject } from '../electron/persistence';
const lit = { ...ambientDefaults, enabled: true, toneProfile: 'vivid' as const, spread: .25 };
const youtube = { id: 'yt', name: 'YouTube · M7lc1UVf-VE', kind: 'youtube' as const, videoId: 'M7lc1UVf-VE', start: 30, color: '#8f72ff', loop: false, speed: 1, volume: 0 };
const withAmbient = (scene: Scene) => reduceScene(scene, { type: 'surface.update', id: 'surface-1', patch: { ambient: lit } });
describe('ambient backlight in the scene', () => {
  it('is optional, so projects saved before it existed still load and render without light', () => {
    const legacy = initialScene();
    expect(legacy.surfaces[0].ambient).toBeUndefined();
    expect(documentSchema.parse({ format: 'hector', version: 1, scene: legacy, assets: {} }).scene.surfaces[0].ambient).toBeUndefined();
    expect(withAmbient(legacy).surfaces[0].ambient).toEqual(lit);
  });
  it.each([
    ['intensity above the implementation limit', { intensity: 3 }], ['spread below the limit', { spread: .01 }], ['fractional smoothing', { smoothingMs: 4.5 }],
    ['an unknown lighting style', { toneProfile: 'neon' }], ['an unknown setting', { roomFill: .5 }], ['opacity above 1', { opacity: 1.2 }]
  ])('rejects %s', (_label, patch) => {
    expect(() => reduceScene(initialScene(), { type: 'surface.update', id: 'surface-1', patch: { ambient: { ...lit, ...patch } } })).toThrow();
  });
  it('cannot change on a locked surface', () => {
    const locked = reduceScene(initialScene(), { type: 'surface.update', id: 'surface-1', patch: { locked: true } });
    expect(() => withAmbient(locked)).toThrow(/Unlock/);
  });
  it('is staged in Preview & Apply, mirrored in Live Edit, and follows undo/redo', async () => {
    const session = new SceneSession(initialScene(), async () => {});
    session.command({ type: 'surface.update', id: 'surface-1', patch: { ambient: lit } });
    expect(session.draft.surfaces[0].ambient).toEqual(lit);
    expect(session.applied.surfaces[0].ambient).toBeUndefined();
    session.undo(); expect(session.draft.surfaces[0].ambient).toBeUndefined();
    session.redo(); expect(session.draft.surfaces[0].ambient).toEqual(lit);
    await session.save(true); expect(session.applied.surfaces[0].ambient).toEqual(lit);
    await session.switchMode('live');
    session.command({ type: 'surface.update', id: 'surface-1', patch: { ambient: { ...lit, enabled: false } } });
    expect(session.applied.surfaces[0].ambient?.enabled).toBe(false);
    session.undo(); expect(session.applied.surfaces[0].ambient?.enabled).toBe(true);
  });
});
describe('YouTube sources in the scene', () => {
  const add = (source: object) => reduceScene(initialScene(), { type: 'source.put', source });
  it('stores only the validated video ID and start offset', () => {
    const scene = add(youtube);
    expect(scene.sources[1]).toEqual(youtube);
    expect(reduceScene(scene, { type: 'surface.update', id: 'surface-1', patch: { sourceId: 'yt' } }).surfaces[0].sourceId).toBe('yt');
  });
  it.each([
    ['a missing video ID', { ...youtube, videoId: undefined }], ['a malformed video ID', { ...youtube, videoId: 'bad id' }],
    ['a URL instead of an ID', { ...youtube, videoId: 'https://youtu.be/M7lc1UVf-VE' }], ['a negative start', { ...youtube, start: -1 }],
    ['a video ID on another kind', { ...youtube, kind: 'video', assetId: 'asset' }], ['a URL field', { ...youtube, url: 'https://youtu.be/x' }]
  ])('rejects %s', (_label, source) => expect(() => add(source)).toThrow());
  it('round-trips with ambient settings through project persistence', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hector-ambient-'));
    try {
      const scene = reduceScene(withAmbient(add(youtube)), { type: 'surface.update', id: 'surface-1', patch: { sourceId: 'yt' } });
      await atomicWrite(join(dir, 'project.json'), { format: 'hector', version: 1, scene, assets: {} });
      const restored = await readProject(join(dir, 'project.json'));
      expect(restored.scene).toEqual(sceneSchema.parse(scene));
      expect(restored.scene.surfaces[0].ambient).toEqual(lit);
      expect(restored.assets).toEqual({});
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
