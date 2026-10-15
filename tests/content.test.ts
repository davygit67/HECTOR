import test from 'node:test';
import assert from 'node:assert/strict';
import { initialScene, reduceScene, readScene, type Scene, type Command } from '../src/shared/domain.ts';
import { CONTENT_REGISTRY, CONTENT_LIMITS, defaultSpec, clockMs, gameTarget, gameCellAt, type ContentKind, type GameContent, type RecipeContent, type ArtContent } from '../src/shared/content.ts';
import { boundsInDomain } from '../src/shared/spatial.ts';
import { overlaps } from '../src/shared/layout.ts';
function create(scene: Scene, kind: ContentKind, id = kind, surfaceId = 'tabletop', now = 1000) {
  return reduceScene(scene, { type: 'content.create', id, title: 'Example ' + kind, surfaceId, spec: defaultSpec(kind) }, now);
}
function action(scene: Scene, id: string, action: 'start' | 'pause' | 'reset' | 'next' | 'previous', now = 1000) { return reduceScene(scene, { type: 'content.action', id, action }, now); }

test('v2 migration preserves existing spatial state, timer deadline, and manual output', () => {
  let current = reduceScene(initialScene(500), { type: 'timer.create', id: 'timer', title: 'Pasta', durationMs: 60000 }, 500);
  current = reduceScene(current, { type: 'timer.action', id: 'timer', action: 'start' }, 1000);
  const { contents, selectedContentId, ...old } = current;
  const v2 = { ...old, schemaVersion: 2 }, before = JSON.stringify(v2), migrated = readScene(v2);
  assert.equal(migrated.schemaVersion, 3); assert.deepEqual(migrated.contents, []); assert.equal(migrated.selectedContentId, null);
  assert.deepEqual(migrated.timers, current.timers); assert.deepEqual(migrated.manualOutput, current.manualOutput);
  assert.deepEqual(migrated.projectors, current.projectors); assert.equal(JSON.stringify(v2), before);
});
test('registry defaults create and round-trip all kinds without invented runtime state', () => {
  for (const entry of CONTENT_REGISTRY) {
    if (entry.kind === 'youtube') { assert.throws(() => defaultSpec('youtube'), /Provide a YouTube/); continue; }
    if (entry.kind === 'media') { assert.throws(() => defaultSpec('media'), /Import a local media/); continue; }
    const s = create(initialScene(0), entry.kind);
    assert.equal(s.contents[0].kind, entry.kind); assert.equal(s.selectedContentId, entry.kind);
    assert.deepEqual(readScene(s), s);
    const replay = create(s, entry.kind);
    assert.equal(replay, s);
  }
});
test('new panels keep their size and native boundaries while allowing overlap', () => {
  let s = reduceScene(initialScene(), { type: 'timer.create', id: 'timer', title: 'Pasta', durationMs: 60000 });
  s = create(s, 'note'); s = create(s, 'recipe', 'recipe', 'wall');
  const note = s.contents[0], recipe = s.contents[1];
  assert.equal(overlaps(note.bounds, s.timers[0].bounds), true);
  assert.equal(note.bounds.w, .42); assert.equal(note.bounds.h, .38);
  assert.equal(boundsInDomain(s.surfaces[1], recipe.bounds), true);
  assert.deepEqual(s.timers[0].bounds, reduceScene(initialScene(), { type: 'timer.create', id: 'timer', title: 'Pasta', durationMs: 60000 }).timers[0].bounds);
});
test('a full-size panel allows additional overlapping content and explicit placement', () => {
  let s = create(initialScene(), 'note');
  s = reduceScene(s, { type: 'content.move', id: 'note', bounds: { x: 0, y: 0, w: 1, h: 1 } });
  const before = JSON.stringify(s);
  let next = create(s, 'game');
  assert.equal(next.contents.length, 2); assert.equal(overlaps(next.contents[0].bounds, next.contents[1].bounds), true);
  const bounds = { x: .05, y: .2, w: .5, h: .6 };
  next = reduceScene(next, { type: 'content.move', id: 'game', bounds });
  assert.deepEqual(next.contents[1].bounds, bounds); assert.deepEqual(readScene(next), next);
  assert.equal(JSON.stringify(s), before);
});
test('five surface slots count timers and artwork; edits and transfers within that surface use no slot', () => {
  let s = create(initialScene(), 'art');
  for (let i = 0; i < 3; i++) s = create(s, 'note', 'note' + i);
  s = reduceScene(s, { type: 'timer.create', id: 'timer', title: 'Timer', durationMs: 60000 });
  const before = JSON.stringify(s);
  assert.throws(() => create(s, 'recipe'), /5 asset slots/);
  assert.throws(() => reduceScene(s, { type: 'timer.create', id: 'sixth', title: 'Timer', durationMs: 1000 }), /5 asset slots/);
  assert.equal(JSON.stringify(s), before);
  s = reduceScene(s, { type: 'content.update', id: 'note0', title: 'Edited at capacity' });
  s = reduceScene(s, { type: 'content.attach', id: 'note0', surfaceId: 'tabletop' });
  s = reduceScene(s, { type: 'timer.attach', id: 'timer', surfaceId: 'tabletop' });
  s = reduceScene(s, { type: 'timer.action', id: 'timer', action: 'start' }, 1000);
  s = create(s, 'note', 'incoming', 'wall');
  assert.throws(() => reduceScene(s, { type: 'content.attach', id: 'incoming', surfaceId: 'tabletop' }), /5 asset slots/);
  s = reduceScene(s, { type: 'timer.create', id: 'incoming-timer', title: 'Timer', durationMs: 1000, surfaceId: 'wall' });
  assert.throws(() => reduceScene(s, { type: 'timer.attach', id: 'incoming-timer', surfaceId: 'tabletop' }), /5 asset slots/);
  s = reduceScene(s, { type: 'content.remove', id: 'note1' });
  s = reduceScene(s, { type: 'content.attach', id: 'incoming', surfaceId: 'tabletop' });
  assert.equal(s.timers[0].deadline, 61000); assert.deepEqual(readScene(s), s);
});
test('older saves above the new surface limit restore and remain editable without losing assets', () => {
  const s = create(initialScene(), 'note');
  s.contents = Array.from({ length: 6 }, (_, i) => ({ ...structuredClone(s.contents[0]), id: 'old' + i })); s.selectedContentId = 'old0';
  const restored = readScene(s);
  assert.deepEqual(restored, s);
  const edited = reduceScene(restored, { type: 'content.update', id: 'old0', title: 'Still editable' });
  assert.equal(edited.contents.length, 6);
  assert.throws(() => create(edited, 'recipe'), /5 asset slots/);
  assert.equal(reduceScene(edited, { type: 'content.attach', id: 'old0', surfaceId: 'wall' }).contents.length, 6);
});
test('background artwork fills the native domain and does not reserve panel space', () => {
  let s = create(initialScene(), 'art', 'art', 'wall'); s = create(s, 'recipe', 'recipe', 'wall');
  assert.deepEqual(s.contents[0].bounds, { x: 0, y: 0, w: 1, h: 1 });
  assert.throws(() => create(s, 'art', 'other', 'wall'), /already has artwork/);
  assert.throws(() => reduceScene(s, { type: 'content.move', id: 'art', bounds: { x: 0, y: 0, w: .4, h: .4 } }), /fills/);
});
test('recipe next/previous clamp, reset returns ingredients, config replacement resets page', () => {
  let s = create(initialScene(), 'recipe');
  s = action(s, 'recipe', 'previous'); assert.equal((s.contents[0] as RecipeContent).state.stepIndex, -1);
  for (let i = 0; i < 8; i++) s = action(s, 'recipe', 'next');
  assert.equal((s.contents[0] as RecipeContent).state.stepIndex, 2);
  s = action(s, 'recipe', 'reset'); assert.equal((s.contents[0] as RecipeContent).state.stepIndex, -1);
  s = action(s, 'recipe', 'next');
  s = reduceScene(s, { type: 'content.update', id: 'recipe', spec: { kind: 'recipe', config: { ingredients: ['Water'], steps: ['Read the supplied recipe.'], source: '' } } });
  assert.equal((s.contents[0] as RecipeContent).state.stepIndex, -1);
});
test('attach preserves recipe page, art time and game progress', () => {
  for (const kind of ['recipe', 'art', 'game'] as const) {
    let s = create(initialScene(1000), kind);
    s = action(s, kind, kind === 'recipe' ? 'next' : kind === 'game' ? 'start' : 'pause', 2000);
    if (kind === 'game') s = reduceScene(s, { type: 'game.hit', id: kind, round: 0, target: gameTarget(s.contents[0] as GameContent) }, 2200);
    const before = structuredClone(s.contents[0]);
    s = reduceScene(s, { type: 'content.attach', id: kind, surfaceId: 'wall' }, 5000);
    assert.deepEqual(s.contents[0].state, before.state); assert.equal(s.contents[0].id, before.id); assert.equal(s.contents[0].surfaceId, 'wall');
    assert.deepEqual(readScene(s), s);
  }
});
test('art pause/resume uses one persistent clock; config edits preserve that clock', () => {
  let s = create(initialScene(1000), 'art');
  s = action(s, 'art', 'pause', 3000);
  assert.equal(clockMs((s.contents[0] as ArtContent).state.clock, 100000), 2000);
  const before = structuredClone(s.contents[0].state);
  s = reduceScene(s, { type: 'content.update', id: 'art', spec: { kind: 'art', config: { preset: 'stars', palette: 'violet', speed: 2, seed: 17 } } }, 4000);
  assert.deepEqual(s.contents[0].state, before);
  s = action(s, 'art', 'start', 100000); assert.equal(clockMs((s.contents[0] as ArtContent).state.clock, 101000), 3000);
});
test('game uses authoritative hits, rejects stale rounds and ignores elapsed pause time', () => {
  let s = create(initialScene(), 'game'); s = action(s, 'game', 'start', 1000);
  const target = gameTarget(s.contents[0] as GameContent);
  s = reduceScene(s, { type: 'game.hit', id: 'game', round: 0, target: (target + 1) % 8 }, 1100);
  assert.equal((s.contents[0] as GameContent).state.misses, 1);
  s = action(s, 'game', 'pause', 1200);
  assert.throws(() => reduceScene(s, { type: 'game.hit', id: 'game', round: 0, target }, 1300), /Start or resume/);
  s = action(s, 'game', 'start', 50000);
  s = reduceScene(s, { type: 'game.hit', id: 'game', round: 0, target }, 50300);
  assert.equal((s.contents[0] as GameContent).state.score, 95);
  assert.equal((s.contents[0] as GameContent).state.round, 1);
  assert.throws(() => reduceScene(s, { type: 'game.hit', id: 'game', round: 0, target }, 50400), /earlier round/);
});
test('game completion persists and requires reset before rules change or restart', () => {
  let s = create(initialScene(), 'game'); s = action(s, 'game', 'start', 1000);
  for (let round = 0; round < 8; round++) s = reduceScene(s, { type: 'game.hit', id: 'game', round, target: gameTarget(s.contents[0] as GameContent) }, 1100 + round * 100);
  const game = s.contents[0] as GameContent;
  assert.equal(game.state.status, 'finished'); assert.equal(game.state.score, 792); assert.equal(game.state.clock.running, false);
  assert.deepEqual(readScene(s), s); assert.throws(() => action(s, 'game', 'start'), /Reset/);
  assert.throws(() => reduceScene(s, { type: 'content.update', id: 'game', spec: defaultSpec('game') }), /Reset/);
  s = action(s, 'game', 'reset'); assert.equal((s.contents[0] as GameContent).state.score, 0);
});
test('invalid configs, state injection, kind mutation and duplicate identities are rejected atomically', () => {
  const s = create(initialScene(), 'note'), before = JSON.stringify(s);
  for (const command of [
    { type: 'content.update', id: 'note', spec: { kind: 'note', config: { text: 'hello', accent: 'url(script)' } } },
    { type: 'content.update', id: 'note', spec: { kind: 'note', config: { text: 'a'.repeat(CONTENT_LIMITS.noteLength + 1), accent: '#abcdef' } } },
    { type: 'content.update', id: 'note', spec: { kind: 'game', config: { rounds: 8, seed: 1, score: 900 } } },
    { type: 'content.update', id: 'note', spec: defaultSpec('game') },
    { type: 'content.action', id: 'note', action: 'next' },
    { type: 'content.attach', id: 'note', surfaceId: 'missing' },
    { type: 'timer.create', id: 'note', title: 'Duplicate', durationMs: 1000 },
  ]) assert.throws(() => reduceScene(s, command as Command));
  assert.equal(JSON.stringify(s), before);
});
test('restoration rejects invalid content and game runtime state', () => {
  const game = create(initialScene(), 'game');
  for (const value of [
    { ...game, selectedContentId: 'missing' },
    { ...game, contents: [...game.contents, ...game.contents] },
    { ...game, contents: [{ ...game.contents[0], state: { ...(game.contents[0] as GameContent).state, score: 1000 } }] },
    { ...game, contents: [{ ...game.contents[0], bounds: { x: 2, y: 0, w: .4, h: .4 } }] },
  ]) assert.throws(() => readScene(value));
});
test('pointer targets use the same bounded grid in all render paths', () => {
  assert.equal(gameCellAt(.1, .31), 0); assert.equal(gameCellAt(.9, .79), 7);
  assert.equal(gameCellAt(1, .5), null); assert.equal(gameCellAt(.4, .1), null);
});

test('fish preset upgrades existing artwork without changing identity, clock, other content or geometry', () => {
  let s = create(initialScene(1000), 'art', 'existing-art', 'wall');
  s = create(s, 'note', 'existing-note', 'wall');
  s = action(s, 'existing-art', 'pause', 3400);
  const old = structuredClone(s), art = s.contents[0] as ArtContent;
  s = reduceScene(s, { type: 'content.update', id: art.id, spec: { kind: 'art', config: { ...art.config, preset: 'fish' } } }, 6000);
  assert.equal((s.contents[0] as ArtContent).config.preset, 'fish');
  assert.deepEqual(s.contents[0].state, old.contents[0].state);
  assert.equal(s.contents[0].id, old.contents[0].id);
  assert.equal(s.contents[0].surfaceId, 'wall');
  assert.deepEqual(s.contents[1], old.contents[1]);
  assert.deepEqual(s.surfaces, old.surfaces); assert.equal(s.geometryRevision, old.geometryRevision);
  assert.deepEqual(readScene(s), s); assert.equal(s.schemaVersion, old.schemaVersion);
});
