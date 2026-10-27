import { describe, expect, it, vi } from 'vitest';
import { SceneSession } from '../src/core/session';
import { initialScene, newSurface, reduceScene, sceneSchema } from '../src/core/model';
const rename = (name: string) => ({ type: 'scene.rename', name });
describe('draft / applied / saved state', () => {
  it('isolates draft edits until persistence succeeds', async () => {
    let finish!: () => void;
    const persist = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const session = new SceneSession(undefined, persist);
    session.command(rename('Draft'));
    expect(session.applied.name).toBe('Untitled setup');
    const save = session.save(true);
    expect(session.applied.name).toBe('Untitled setup');
    expect(() => session.command(rename('Race'))).toThrow(/progress/);
    finish(); await save;
    expect(session.applied.name).toBe('Draft');
    expect(session.snapshot()).toMatchObject({ unsaved: false, unapplied: false });
  });
  it('retains applied output, draft and saved state after save failure', async () => {
    const persist = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Disk full'));
    const session = new SceneSession(undefined, persist); await session.save(true);
    const applied = structuredClone(session.applied), saved = structuredClone(session.saved);
    session.command(rename('Keep me'));
    await expect(session.save(true)).rejects.toThrow('Disk full');
    expect(session.draft.name).toBe('Keep me'); expect(session.applied).toEqual(applied); expect(session.saved).toEqual(saved);
    expect(session.snapshot()).toMatchObject({ unsaved: true, unapplied: true, busy: false });
  });
  it('requires explicit resolution before Live Edit and supports cancellation', async () => {
    const session = new SceneSession(); session.command(rename('Pending'));
    expect(await session.switchMode('live')).toBe(false); expect(await session.switchMode('live','cancel')).toBe(false);
    expect(session.mode).toBe('preview'); expect(session.draft.name).toBe('Pending');
    await session.switchMode('live','discard'); expect(session.draft).toEqual(session.applied);
    session.command(rename('Live')); expect(session.applied.name).toBe('Live'); expect(session.snapshot().unsaved).toBe(true);
  });
  it('does not switch modes when Apply fails', async () => {
    const session = new SceneSession(undefined, async () => { throw new Error('Denied'); }); session.command(rename('Pending'));
    await expect(session.switchMode('live','apply')).rejects.toThrow('Denied'); expect(session.mode).toBe('preview');
  });
  it('undo/redo obey mode and discard cannot revive unapplied history', async () => {
    const session = new SceneSession(); session.command(rename('One')); session.command(rename('Two'));
    session.undo(); expect(session.draft.name).toBe('One'); expect(session.applied.name).toBe('Untitled setup');
    session.redo(); expect(session.draft.name).toBe('Two'); session.discard(); expect(session.snapshot().canUndo).toBe(false);
    await session.switchMode('live'); session.command(rename('Live')); session.undo(); expect(session.applied.name).toBe('Untitled setup');
    session.redo(); expect(session.applied.name).toBe('Live');
  });
  it('preserves live source references when the draft removes media', () => {
    const session = new SceneSession(); session.command({ type: 'source.remove', id: 'aurora' });
    expect(session.draft.sources).toHaveLength(0); expect(session.applied.sources).toHaveLength(1); expect(session.applied.surfaces[0].sourceId).toBe('aurora');
  });
  it('rejects malformed projects, crossed corners, duplicate IDs and locked changes', () => {
    const scene = initialScene();
    expect(() => sceneSchema.parse({ ...scene, version: 999 })).toThrow();
    expect(() => sceneSchema.parse({ ...scene, sources: [...scene.sources,...scene.sources] })).toThrow();
    expect(() => reduceScene(scene, { type: 'surface.update', id: 'surface-1', patch: { corners: [[0,0],[1,1],[1,0],[0,1]] } })).toThrow();
    const locked = reduceScene(scene, { type: 'surface.update', id: 'surface-1', patch: { locked: true } });
    expect(() => reduceScene(locked, { type: 'surface.remove', id: 'surface-1' })).toThrow(/Unlock/);
    expect(() => reduceScene(scene, { type: 'surface.add', surface: newSurface('surface-1','Duplicate',null) })).toThrow();
    expect(() => reduceScene(scene, { type: 'surface.update', id: 'surface-1', patch: { crop: [.7,0,.4,0] } })).toThrow();
  });
});
describe('asset reachability', () => {
  const video = (assetId: string) => ({ type: 'source.put', source: { id: 'clip', assetId, kind: 'video', name: 'clip.mp4', color: '#8f72ff', loop: true, speed: 1, volume: 0 } });
  const assetIds = (session: SceneSession) => new Set(session.reachableScenes().flatMap(s => s.sources.map(x => x.assetId).filter(Boolean)));
  it('keeps media referenced by applied output and undo history after the draft drops it', async () => {
    const session = new SceneSession();
    session.command(video('applied-asset')); await session.save(true);
    session.command({ type: 'source.remove', id: 'clip' });
    session.command(video('draft-asset')); session.command({ type: 'source.remove', id: 'clip' });
    expect(assetIds(session)).toEqual(new Set(['applied-asset', 'draft-asset']));
    session.discard();
    expect(assetIds(session)).toEqual(new Set(['applied-asset']));
  });
});
