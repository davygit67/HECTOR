import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3 } from 'three';
import { initialScene, readScene, reduceScene, remaining } from '../src/shared/domain.ts';
import { FULL_QUAD, DEFAULT_QUAD } from '../src/shared/geometry.ts';
import { boundsInDomain, cameraPoint, coverageWeights, defaultSpatial, fitBounds, inDomain, surfacePoint, surfaceUV, visibleFrom, LEGACY_WALL_BOUNDARY, LEGACY_WALL_HOLES } from '../src/shared/spatial.ts';
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test('v1 migration preserves timer identity, placement, pause/deadline and manual mapping', () => {
  const legacy = { schemaVersion: 1, revision: 57, showGrid: true, quad: structuredClone(DEFAULT_QUAD), selectedTimerId: 'old', timers: [
    { id: 'old', title: 'Pasta', durationMs: 600000, bounds: { x: .1, y: .2, w: .6, h: .4 }, status: 'running', remainingMs: 600000, deadline: 900000 },
    { id: 'paused', title: 'Paused', durationMs: 300000, bounds: { x: .2, y: .3, w: .4, h: .3 }, status: 'paused', remainingMs: 120000, deadline: null },
  ] };
  const saved = JSON.stringify(legacy), scene = readScene(legacy);
  assert.equal(scene.schemaVersion, 3); assert.equal(scene.revision, 57);
  assert.deepEqual(scene.manualOutput.quad, legacy.quad); assert.equal(scene.manualOutput.surfaceId, 'tabletop');
  legacy.timers.forEach((timer, i) => assert.deepEqual(scene.timers[i], { ...timer, surfaceId: 'tabletop' }));
  assert.equal(remaining(scene.timers[0], 350000), 550000); assert.equal(remaining(scene.timers[1], 999999), 120000);
  assert.equal(JSON.stringify(legacy), saved); assert.deepEqual(readScene(scene), scene);
});
test('world/UV embedding round-trips on perpendicular surfaces', () => {
  for (const s of defaultSpatial().surfaces) {
    for (const uv of [...FULL_QUAD, { x: .4, y: .7 }]) { const result = surfaceUV(s, surfacePoint(s, uv)); near(result.x, uv.x); near(result.y, uv.y); }
  }
  const table = defaultSpatial().surfaces[0]; near(surfacePoint(table, { x: .5, y: .5 })[1], .8);
});
test('coverage projection matches the actual Three.js rendering camera', () => {
  const scene = initialScene();
  for (const p of [...scene.projectors, scene.viewer]) {
    const camera = new PerspectiveCamera(p.fov, p.aspect, .05, 40); camera.position.set(...p.position); camera.lookAt(...p.target); camera.updateMatrixWorld();
    for (const surface of scene.surfaces) for (const uv of [...FULL_QUAD, { x: .5, y: .5 }]) {
      const world = surfacePoint(surface, uv), expected = new Vector3(...world).project(camera), actual = cameraPoint(p, world);
      near(actual.x, (expected.x + 1) / 2); near(actual.y, (1 - expected.y) / 2);
    }
  }
});
test('native domains reject excluded regions and panels enclosing a hole', () => {
  const wall = { ...defaultSpatial().surfaces[1], holes: structuredClone(LEGACY_WALL_HOLES) };
  assert.equal(inDomain(wall, { x: .1, y: .7 }), false);
  assert.equal(inDomain(wall, { x: .98, y: .02 }), true);
  assert.equal(inDomain({ ...wall, boundary: LEGACY_WALL_BOUNDARY }, { x: .98, y: .02 }), false);
  assert.equal(boundsInDomain(wall, { x: .03, y: .45, w: .25, h: .5 }), false);
  const fitted = fitBounds(wall, { x: .04, y: .55, w: .35, h: .3 });
  assert.equal(boundsInDomain(wall, fitted), true);
  assert.throws(() => fitBounds(wall, { x: 0, y: 0, w: 1, h: 1 }));
});
test('old simulated corner and left hole migrate once without changing content or manual alignment', () => {
  let old = reduceScene(initialScene(1000), { type: 'manual.target', surfaceId: 'wall' });
  old = reduceScene(old, { type: 'timer.create', id: 'wall-clock', title: 'Wall timer', durationMs: 60000, surfaceId: 'wall' });
  old = reduceScene(old, { type: 'timer.action', id: 'wall-clock', action: 'start' }, 1000);
  old.surfaces[1].boundary = structuredClone(LEGACY_WALL_BOUNDARY);
  old.surfaces[1].holes = structuredClone(LEGACY_WALL_HOLES);
  const original = JSON.stringify(old), migrated = readScene(old);
  assert.deepEqual(migrated.surfaces[1].boundary, FULL_QUAD);
  assert.equal(inDomain(migrated.surfaces[1], { x: .99, y: .01 }), true);
  assert.deepEqual(migrated.manualOutput, old.manualOutput);
  assert.deepEqual(migrated.timers, old.timers); assert.deepEqual(migrated.contents, old.contents);
  assert.deepEqual(migrated.surfaces[1].holes, []);
  assert.equal(inDomain(migrated.surfaces[1], { x: .1, y: .7 }), true);
  assert.equal(migrated.geometryRevision, old.geometryRevision + 1);
  assert.equal(migrated.revision, old.revision + 1);
  assert.ok(migrated.coverage.every(c => c.geometryRevision === migrated.geometryRevision));
  assert.deepEqual(readScene(migrated), migrated); assert.equal(JSON.stringify(old), original);
});
test('a saved left hole migrates independently of the old notch, with no reset', () => {
  const old = initialScene(1000); old.surfaces[1].holes = structuredClone(LEGACY_WALL_HOLES);
  const scene = readScene(old);
  assert.equal(inDomain(scene.surfaces[1], { x: .1, y: .7 }), true);
  assert.equal(scene.geometryRevision, old.geometryRevision + 1);
  assert.ok(scene.coverage.every(c => c.geometryRevision === scene.geometryRevision));
  assert.deepEqual(scene.manualOutput, old.manualOutput); assert.deepEqual(scene.projectors, old.projectors);
  assert.deepEqual(readScene(scene), scene);
  assert.equal(reduceScene(scene, { type: 'surface.demo-exclusion', id: 'wall', enabled: false }), scene);
  const bad = structuredClone(scene); bad.surfaces[1].holes = [[{ x: 0, y: 0 }]];
  assert.throws(() => readScene(bad), /boundary/);
});
test('new rooms have a full wall and cannot re-enable the retired demo obstacle', () => {
  let scene = initialScene();
  assert.deepEqual(scene.surfaces[1].holes, []);
  scene = reduceScene(scene, { type: 'timer.create', id: 't', title: 'Left timer', durationMs: 60000, surfaceId: 'wall' });
  scene = reduceScene(scene, { type: 'timer.move', id: 't', bounds: { x: .02, y: .55, w: .18, h: .2 } });
  const before = JSON.stringify(scene);
  assert.throws(() => reduceScene(scene, { type: 'surface.demo-exclusion', id: 'wall', enabled: true }), /no demo cutout/);
  assert.equal(JSON.stringify(scene), before); assert.deepEqual(readScene(scene), scene);
});
test('moving a surface carries content without changing its local placement or clock', () => {
  let scene = reduceScene(initialScene(1000), { type: 'timer.create', id: 't', title: 'Timer', durationMs: 60000 }, 1000);
  scene = reduceScene(scene, { type: 'timer.action', id: 't', action: 'start' }, 1000);
  const before = structuredClone(scene.timers[0]), oldWorld = surfacePoint(scene.surfaces[0], before.bounds);
  scene = reduceScene(scene, { type: 'surface.move', id: 'tabletop', origin: [-.6, 1.1, -.45] }, 2000);
  assert.deepEqual(scene.timers[0], before); const nextWorld = surfacePoint(scene.surfaces[0], before.bounds);
  near(nextWorld[0] - oldWorld[0], .5); near(nextWorld[1] - oldWorld[1], .3);
  assert.equal(remaining(scene.timers[0], 3000), 58000); assert.equal(scene.geometryRevision, 1);
  assert.ok(scene.coverage.every(c => c.geometryRevision === 1));
});
test('reattaching a running timer fits the new surface and retains its identity/deadline', () => {
  let scene = reduceScene(initialScene(), { type: 'timer.create', id: 't', title: 'Timer', durationMs: 60000 });
  scene = reduceScene(scene, { type: 'timer.action', id: 't', action: 'start' }, 1000);
  scene = reduceScene(scene, { type: 'timer.attach', id: 't', surfaceId: 'wall' }, 2000);
  assert.equal(scene.timers[0].surfaceId, 'wall'); assert.equal(scene.timers[0].deadline, 61000);
  assert.ok(boundsInDomain(scene.surfaces[1], scene.timers[0].bounds));
  assert.equal(scene.manualOutput.surfaceId, 'tabletop');
});
test('valid overlap weights sum to one; disabling a projector redistributes its contribution', () => {
  const scene = initialScene(), table = scene.surfaces[0]; let overlaps = 0;
  for (let y = 0; y <= 10; y++) for (let x = 0; x <= 10; x++) {
    const uv = { x: x / 10, y: y / 10 }, weights = coverageWeights(scene, table, uv), sum = weights.reduce((a, b) => a + b, 0);
    if (sum) near(sum, 1);
    if (weights.every(w => w > 0)) {
      overlaps++;
      const disabled = reduceScene(scene, { type: 'projector.update', id: 'projector-a', enabled: false });
      assert.deepEqual(coverageWeights(disabled, table, uv), [0, 1]);
      assert.deepEqual(disabled.timers, scene.timers); assert.deepEqual(disabled.surfaces, scene.surfaces);
      const both = reduceScene(disabled, { type: 'projector.update', id: 'projector-b', enabled: false });
      assert.deepEqual(coverageWeights(both, table, uv), [0, 0]);
    }
  }
  assert.ok(overlaps > 20, 'default simulated projectors should have meaningful overlap');
});
test('projector movement changes coverage, not content or legacy state', () => {
  const scene = initialScene(1000);
  const moved = reduceScene(scene, { type: 'projector.update', id: 'projector-a', position: [8, 2.85, 2.1], target: [8, 1, -2] }, 5000);
  assert.deepEqual(scene.effect, moved.effect); assert.deepEqual(scene.surfaces, moved.surfaces);
  assert.equal(coverageWeights(moved, moved.surfaces[0], { x: .5, y: .5 })[0], 0);
});
test('world geometry occludes projector rays and excluded regions get no contribution', () => {
  const scene = initialScene(), wall = scene.surfaces[1], table = scene.surfaces[0];
  const projector = { ...scene.projectors[0], position: [0, 2, 2] as [number,number,number], target: [0, 0, -1.65] as [number,number,number], fov: 100 };
  assert.equal(visibleFrom(scene, wall, { x: .5, y: .95 }, projector), false);
  assert.equal(visibleFrom({ ...scene, surfaces: [wall] }, wall, { x: .5, y: .95 }, projector), true);
  assert.deepEqual(coverageWeights(scene, { ...wall, holes: LEGACY_WALL_HOLES }, { x: .1, y: .7 }), [0, 0]);
  assert.equal(inDomain(table, { x: .5, y: .5 }), true);
});
test('viewer movement is independent of coverage, content, and projector poses', () => {
  const scene = initialScene(), moved = reduceScene(scene, { type: 'viewer.update', position: [-1, 1.7, 4.2] });
  assert.deepEqual(moved.projectors, scene.projectors); assert.deepEqual(moved.coverage, scene.coverage); assert.deepEqual(moved.timers, scene.timers);
  assert.notDeepEqual(cameraPoint(moved.viewer, [0, 1, -1]), cameraPoint(scene.viewer, [0, 1, -1]));
});
test('reject invalid spatial saves and rebuild derived coverage', () => {
  const scene = initialScene();
  for (const bad of [
    { ...scene, selectedSurfaceId: 'missing' },
    { ...scene, surfaces: [] },
    { ...scene, viewer: { ...scene.viewer, position: scene.viewer.target } },
    { ...scene, effect: { ...scene.effect, elapsedMs: NaN } },
    { ...scene, surfaces: scene.surfaces.map((s, i) => i ? s : { ...s, u: [2, 0, 0] }) },
  ]) assert.throws(() => readScene(bad));
  assert.deepEqual(readScene({ ...scene, coverage: [] }).coverage, scene.coverage);
});
