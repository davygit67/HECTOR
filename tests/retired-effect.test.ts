import test from 'node:test';
import assert from 'node:assert/strict';
import { initialScene, readScene, reduceScene } from '../src/shared/domain';
import { defaultSpec } from '../src/shared/content';
import { surfaceFrameKey } from '../src/shared/renderActivity';
import { artworkSceneKey } from '../src/shared/renderKeys';

test('fresh browser and desktop scenes have no implicit animated background', () => {
  const scene = initialScene(1000);
  assert.equal(scene.effect.enabled, false);
  assert.equal(scene.effect.running, false);
  assert.equal(scene.contents.length, 0);
  assert.deepEqual(readScene(scene), scene);
});

test('old v2/v3 ripple settings migrate once without changing content, clocks or alignment', () => {
  let legacy = reduceScene(initialScene(1000), { type: 'timer.create', id: 'tea', title: 'Tea', durationMs: 120000, surfaceId: 'tabletop' }, 1000);
  legacy = reduceScene(legacy, { type: 'timer.action', id: 'tea', action: 'start' }, 1000);
  legacy = reduceScene(legacy, { type: 'content.create', id: 'art', title: 'Chosen art', surfaceId: 'wall', spec: defaultSpec('art') }, 1000);
  legacy.effect = { enabled: true, running: true, startedAt: 300, elapsedMs: 850 };
  const saved = JSON.stringify(legacy), restored = readScene(legacy);
  assert.deepEqual(restored, { ...legacy, revision: legacy.revision + 1, effect: { ...legacy.effect, enabled: false, running: false } });
  assert.deepEqual(readScene(restored), restored);
  assert.equal(JSON.stringify(legacy), saved);
  const oldV2 = readScene({ ...legacy, schemaVersion: 2, contents: undefined, selectedContentId: null });
  assert.equal(oldV2.effect.enabled, false); assert.equal(oldV2.effect.running, false);
  assert.deepEqual(oldV2.timers, legacy.timers);
  assert.deepEqual(oldV2.manualOutput, legacy.manualOutput);
});

test('stale clients cannot enable or resume the retired demo; disabling remains safe', () => {
  const scene = initialScene();
  for (const command of [{ enabled: true }, { running: true }, { enabled: false, running: true }]) {
    assert.throws(() => reduceScene(scene, { type: 'effect.set', ...command }), /removed and cannot be enabled/);
  }
  const disabled = reduceScene(scene, { type: 'effect.set', enabled: false, running: false });
  assert.equal(disabled.effect.enabled, false); assert.equal(disabled.effect.running, false);
  const stale = { ...scene, effect: { ...scene.effect, enabled: true, running: true } };
  const changed = reduceScene(stale, { type: 'grid.set', visible: false });
  assert.equal(changed.effect.enabled, false); assert.equal(changed.effect.running, false);
});

test('an already-open legacy scene cannot animate or invalidate surfaces with its retired flags', () => {
  const scene = initialScene();
  const stale = { ...scene, effect: { enabled: true, running: true, startedAt: 1, elapsedMs: 500 } };
  const revisions = { media: () => 0, local: () => 0, light: () => ({ revision: 0, alpha: 0 }) };
  assert.equal(artworkSceneKey(scene, true), artworkSceneKey(stale, true));
  for (const surface of scene.surfaces) {
    assert.equal(surfaceFrameKey(stale, surface.id, 1000, true, false, revisions), surfaceFrameKey(stale, surface.id, 9000, true, false, revisions));
  }
});
