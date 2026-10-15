import test from 'node:test';
import assert from 'node:assert/strict';
import { formatTime, initialScene, readScene, reduceScene, remaining, type Command } from '../src/shared/domain.ts';
import { DEFAULT_QUAD } from '../src/shared/geometry.ts';

const create: Command = { type: 'timer.create', id: 'timer-1', title: 'Focus', durationMs: 300000 };
const action = (action: 'start' | 'pause' | 'reset'): Command => ({ type: 'timer.action', id: 'timer-1', action });

test('timer follows elapsed time, pauses, resumes, and resets deterministically', () => {
  let scene = reduceScene(initialScene(), create, 1000);
  scene = reduceScene(scene, action('start'), 1000);
  assert.equal(remaining(scene.timers[0], 11234), 289766);
  scene = reduceScene(scene, action('pause'), 11234);
  assert.equal(remaining(scene.timers[0], 999999), 289766);
  scene = reduceScene(scene, action('start'), 20000);
  assert.equal(remaining(scene.timers[0], 21000), 288766);
  assert.equal(remaining(scene.timers[0], 500000), 0);
  scene = reduceScene(scene, action('reset'), 500000);
  assert.equal(remaining(scene.timers[0], 999999), 300000);
  assert.equal(scene.timers[0].status, 'idle');
});
test('saving, restoring, and recalibrating never restart a running timer', () => {
  let scene = reduceScene(reduceScene(initialScene(), create, 1000), action('start'), 1000);
  scene = reduceScene(scene, { type: 'calibration.set', quad: [{ x: .15, y: .3 }, { x: .75, y: .1 }, { x: .88, y: .85 }, { x: .12, y: .85 }] }, 9000);
  scene = reduceScene(scene, { type: 'timer.move', id: 'timer-1', bounds: { x: .1, y: .2, w: .5, h: .4 } }, 10000);
  const restored = readScene(JSON.parse(JSON.stringify(scene)));
  assert.equal(remaining(restored.timers[0], 20000), 281000);
  assert.equal(restored.timers[0].deadline, 301000);
  assert.deepEqual(restored, scene);
});
test('repeated create, start, and pause commands are harmless', () => {
  let scene = reduceScene(initialScene(), create);
  scene = reduceScene(scene, create);
  assert.equal(scene.timers.length, 1);
  scene = reduceScene(scene, action('start'), 1000);
  assert.equal(reduceScene(scene, action('start'), 10000).timers[0].deadline, 301000);
  scene = reduceScene(scene, action('pause'), 12000);
  assert.equal(reduceScene(scene, action('pause'), 14000).timers[0].remainingMs, 289000);
});
test('bad commands do not mutate the existing scene', () => {
  const scene = reduceScene(initialScene(), create);
  const original = JSON.stringify(scene);
  for (const c of [
    { type: 'timer.update', id: 'timer-1', durationMs: -1 },
    { type: 'timer.update', id: 'timer-1', title: '' },
    { type: 'calibration.set', quad: [] },
    { type: 'not-a-command' },
    { type: 'timer.action', id: 'missing', action: 'pause' },
  ]) assert.throws(() => reduceScene(scene, c as Command));
  assert.equal(JSON.stringify(scene), original);
});
test('duration changes require a reset and deletion preserves another selection', () => {
  let scene = reduceScene(reduceScene(initialScene(), create), action('start'), 1000);
  assert.throws(() => reduceScene(scene, { type: 'timer.update', id: 'timer-1', durationMs: 60000 }));
  scene = reduceScene(scene, action('reset'));
  scene = reduceScene(scene, { type: 'timer.update', id: 'timer-1', durationMs: 60000 });
  assert.equal(scene.timers[0].remainingMs, 60000);
  scene = reduceScene(scene, { ...create, id: 'timer-2' });
  scene = reduceScene(scene, { type: 'timer.remove', id: 'timer-2' });
  assert.equal(scene.selectedTimerId, 'timer-1');
  scene = reduceScene(scene, { type: 'timer.remove', id: 'timer-1' });
  assert.equal(scene.selectedTimerId, null);
});
test('invalid persisted scenes are rejected', () => {
  const scene = reduceScene(initialScene(), create);
  for (const value of [null, {}, { ...scene, schemaVersion: 99 }, { ...scene, manualOutput: { ...scene.manualOutput, quad: [] } },
    { ...scene, selectedTimerId: 'missing' }, { ...scene, timers: [...scene.timers, ...scene.timers] },
    { ...scene, timers: [{ ...scene.timers[0], status: 'running', deadline: null }] },
    { ...scene, timers: [{ ...scene.timers[0], bounds: { x: .9, y: 0, w: .5, h: .5 } }] },
  ]) assert.throws(() => readScene(value));
  assert.deepEqual(readScene(scene), scene);
});
test('calibration reset preserves content and grid settings', () => {
  let scene = reduceScene(initialScene(), create);
  scene = reduceScene(scene, { type: 'grid.set', visible: true });
  scene = reduceScene(scene, { type: 'calibration.reset' });
  assert.deepEqual(scene.manualOutput.quad, DEFAULT_QUAD); assert.equal(scene.showGrid, true); assert.equal(scene.timers.length, 1);
});
test('timer display rounds up, stays at zero, and supports hours', () => {
  assert.equal(formatTime(300000), '05:00'); assert.equal(formatTime(299001), '05:00');
  assert.equal(formatTime(1), '00:01'); assert.equal(formatTime(-1), '00:00');
  assert.equal(formatTime(3661000), '1:01:01');
});
