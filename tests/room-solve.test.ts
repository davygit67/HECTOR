import test from 'node:test';
import assert from 'node:assert/strict';
import { measuredRoomFixture } from './fixtures/measured-room.js';
import { decodeProjectorPixels, solveRoomSurfaces } from '../src/shared/roomSolve.js';
import { copyFrame, decodeSensorFrame, encodeSensorFrame, validateFrame, frameBytes } from '../src/shared/sensor.js';
import { initialScene, readScene, reduceScene } from '../src/shared/domain.js';
import { artworkSceneKey } from '../src/shared/renderKeys.js';
import { measurementMatchesFrame } from '../src/shared/measured.js';

test('registered SDK points round trip, copy and byte accounting; malformed additions reject', () => {
  const frame = measuredRoomFixture().frames[0], decoded = decodeSensorFrame(encodeSensorFrame(frame));
  assert.deepEqual(decoded, frame); assert.deepEqual(copyFrame(frame), frame); assert.notEqual(copyFrame(frame).cameraPoints, frame.cameraPoints);
  assert.equal(frameBytes(frame), frame.color.byteLength + frame.depth.byteLength + frame.cameraPoints!.byteLength);
  const bad = copyFrame(frame); bad.cameraPoints![100] = NaN; assert.throws(() => validateFrame(bad), /camera points/);
  assert.throws(() => validateFrame({ ...frame, floorPlane: [0, 0, 4, 2] }), /floor/);
});
test('Gray decoding and robust measured table fit retain an occluder hole and metric size', () => {
  const session = measuredRoomFixture(), decoded = decodeProjectorPixels(session);
  assert.ok(decoded.pixels.filter(Boolean).length > 5000);
  const solved = solveRoomSurfaces(session), table = solved.candidates.find(c => c.kind === 'table')!;
  assert.ok(table); assert.ok(table.rmsPx < .8); assert.ok(Math.abs(table.heightAboveFloor! - .8) < .01);
  assert.ok(table.surface.width > 1.3 && table.surface.width < 1.5); assert.ok(table.surface.height > .9 && table.surface.height < 1.1);
  const mask = table.surface.measurement!.mask;
  assert.equal(mask.bits[Math.floor(mask.height / 2) * mask.width + Math.floor(mask.width / 2)], '0');
  assert.equal(mask.bits[20 * mask.width + 20], '1');
  assert.equal(table.surface.provenance, 'simulated');
});
test('no floor estimate means a plane candidate, never an invented table identity', () => {
  const result = solveRoomSurfaces(measuredRoomFixture({ floor: false, clutter: false }));
  assert.ok(result.candidates.length); assert.ok(result.candidates.every(c => c.kind === 'unknown'));
});
test('motion, incomplete capture, changed output and low contrast fail closed', () => {
  const moved = measuredRoomFixture(); moved.frames[5].depth = moved.frames[5].depth.map(n => n ? n + 100 : n);
  assert.throws(() => solveRoomSurfaces(moved), /moved/);
  const incomplete = measuredRoomFixture(); incomplete.status = 'cancelled'; assert.throws(() => solveRoomSurfaces(incomplete), /complete/);
  const changed = measuredRoomFixture(); changed.captures[5].presentation.viewport.width = 2000; assert.throws(() => solveRoomSurfaces(changed), /geometry changed/);
  const dark = measuredRoomFixture(); dark.frames.forEach(f => f.color.fill(10)); assert.throws(() => solveRoomSurfaces(dark), /Too few/);
});
test('measured import and agent fill use one canonical target, preserve assets and persist evidence', () => {
  const candidate = solveRoomSurfaces(measuredRoomFixture()).candidates.find(c => c.kind === 'table')!;
  let scene = reduceScene(initialScene(), { type: 'timer.create', id: 't', title: 'Existing timer', durationMs: 60000 });
  const oldTimer = structuredClone(scene.timers[0]);
  scene = reduceScene(scene, { type: 'surface.measure', surface: candidate.surface });
  assert.deepEqual(scene.timers[0], oldTimer); assert.equal(scene.manualOutput.calibration, 'measured-planar');
  const key = artworkSceneKey(scene, false);
  scene = reduceScene(scene, { type: 'surface.fill', id: 'tabletop', color: '#FF0000' });
  assert.equal(scene.surfaces[0].fill, '#ff0000'); assert.notEqual(artworkSceneKey(scene, false), key);
  assert.deepEqual(readScene(scene), scene);
  assert.throws(() => reduceScene(scene, { type: 'surface.move', id: 'tabletop', origin: [0, 1, 0] }), /Recalibrate/);
  assert.throws(() => reduceScene(scene, { type: 'surface.fill', id: 'tabletop', color: 'red' }), /hex/);
  const tuned = reduceScene(scene, { type: 'calibration.set', quad: scene.manualOutput.quad });
  assert.equal(tuned.manualOutput.calibration, 'manual-2d');
  assert.equal(reduceScene(tuned, { type: 'surface.fill', id: 'tabletop', color: '#0000ff' }).manualOutput.calibration, 'manual-2d');
});
test('saved depth witness rejects sensor swaps, rig changes and newly missing depths', () => {
  const session = measuredRoomFixture(), m = solveRoomSurfaces(session).candidates[0].surface.measurement!, frame = copyFrame(session.frames[0]);
  assert.equal(measurementMatchesFrame(m, frame), true);
  assert.equal(measurementMatchesFrame(m, { ...frame, device: { ...frame.device, id: 'other-sensor' } }), false);
  frame.depth = frame.depth.map(v => v ? v + 60 : v); assert.equal(measurementMatchesFrame(m, frame), false);
  frame.depth.fill(0); assert.equal(measurementMatchesFrame(m, frame), false);
});
