import test from 'node:test';
import assert from 'node:assert/strict';
import { ART_PRESETS, CONTENT_LIMITS, CONTENT_REGISTRY, changeClock, type ArtContent } from '../src/shared/content';
import { swimmingFish } from '../src/shared/art-motion';

const art = (): ArtContent => ({
  id: 'fish', title: 'Fish', kind: 'art', surfaceId: 'wall', bounds: { x: 0, y: 0, w: 1, h: 1 },
  config: { preset: 'fish', palette: 'lagoon', seed: 42, speed: 1 },
  state: { clock: { running: true, startedAt: 1000, elapsedMs: 0 } },
});
test('every permitted preset has an accurate serializable appearance descriptor for UI and agent', () => {
  assert.deepEqual(Object.keys(ART_PRESETS), [...CONTENT_LIMITS.presets]);
  const entry = CONTENT_REGISTRY.find(e => e.kind === 'art')!;
  assert.deepEqual(JSON.parse(JSON.stringify(entry.presets)), ART_PRESETS);
  assert.match(ART_PRESETS.fish.description, /eyes, fins and moving tails/);
  assert.match(ART_PRESETS.contours.description, /not fish/);
});
test('fish animate deterministically across outputs, remain bounded over long sessions, and start visible', () => {
  const a = art(), first = swimmingFish(a, 1000);
  assert.deepEqual(first, swimmingFish(structuredClone(a), 1000));
  assert.ok(first.filter(f => f.x > .05 && f.x < .95).length >= 8);
  assert.ok(first.some(f => f.direction === 1)); assert.ok(first.some(f => f.direction === -1));
  assert.notDeepEqual(first, swimmingFish(a, 2000));
  for (const time of [1000, 2000, 3600000, 1e12]) {
    for (const f of swimmingFish(a, time)) {
      assert.ok(f.x >= -.2 && f.x <= 1.2);
      assert.ok(f.y > 0 && f.y < 1);
      assert.ok(Object.values(f).every(Number.isFinite));
    }
  }
});
test('fish pause/resume without jumping; speed changes animation time and seed changes the school', () => {
  const a = art(); changeClock(a.state.clock, false, 8000);
  const paused = swimmingFish(a, 8000);
  assert.deepEqual(paused, swimmingFish(a, 900000));
  changeClock(a.state.clock, true, 900000);
  assert.deepEqual(paused, swimmingFish(a, 900000));
  assert.notDeepEqual(paused, swimmingFish(a, 901000));
  const normal = art(), faster = art(); faster.config.speed = 2;
  assert.deepEqual(swimmingFish(normal, 11000), swimmingFish(faster, 6000));
  faster.config.seed++; assert.notDeepEqual(swimmingFish(normal, 11000), swimmingFish(faster, 6000));
});
