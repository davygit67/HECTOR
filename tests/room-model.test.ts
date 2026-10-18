import test from 'node:test';
import assert from 'node:assert/strict';
import { measuredRoomFixture } from './fixtures/measured-room.js';
import { copyFrame } from '../src/shared/sensor.js';
import { aggregateRoom, cameraToRoom, RoomContinuity, roomMatchesFrame, sampleRoomFrame, validateRoomReference } from '../src/shared/roomModel.js';
import { solveRoomSurfaces } from '../src/shared/roomSolve.js';

function fixture() {
  const session = measuredRoomFixture(), frames = session.frames.slice(0, 12).map(copyFrame);
  frames.forEach((f, i) => { f.sequence = i; f.capturedAtMs = 10000 + 200 * i; });
  return { session, frames, room: () => aggregateRoom(frames.map(sampleRoomFrame), 'room-one') };
}
test('temporal room consensus reduces noise, retains metric coordinates and never fills unobserved rays', () => {
  const f = fixture();
  f.frames.forEach((frame, n) => {
    const offset = n % 2 ? 3 : -3;
    for (let i = 0; i < frame.depth.length; i++) if (frame.depth[i]) { frame.depth[i] += offset; frame.cameraPoints![i * 3 + 2] += offset / 1000; }
    if (n < 2) { frame.depth[1000] += 400; frame.cameraPoints![3002] += .4; }
  });
  const r = f.room(); assert.equal(r.frames, 12); assert.equal(r.spanMs, 2200); assert.equal(r.source, 'synthetic');
  assert.equal(r.witness.meters[0], 0); assert.ok(Math.abs(r.witness.meters[1000] - 2) < .004);
  assert.ok(r.positions.length / 3 > 5000); assert.equal(r.transform.floorAligned, true);
  const index = r.witness.meters.findIndex(Boolean), p = Array.from(f.frames[0].cameraPoints!.subarray(index * 3, index * 3 + 3)) as [number, number, number];
  const expected = cameraToRoom(p, r.transform); assert.ok(Math.abs(r.positions[1] - expected[1]) < .004);
});
test('dynamic pixels are omitted, while widespread motion and changed floor reject the scan', () => {
  const f = fixture();
  f.frames.forEach((frame, n) => { if (n < 6) { frame.depth[1000] += 100; frame.cameraPoints![3002] += .1; } });
  assert.equal(f.room().witness.meters[1000], 0);
  f.frames.forEach((frame, n) => { if (n < 6) for (let i = 0; i < frame.depth.length; i++) if (frame.depth[i]) { frame.depth[i] += 100; frame.cameraPoints![i * 3 + 2] += .1; } });
  assert.throws(f.room, /Too little stable/);
  const tilt = fixture(); tilt.frames[4].floorPlane![3] += .1; assert.throws(tilt.room, /Floor orientation/);
});
test('mixed devices, source epochs, dimensions and short captures cannot form one room', () => {
  const f = fixture(); f.frames[5].device.id = 'new-camera'; assert.throws(f.room, /sensor changed/);
  const epoch = fixture(); epoch.frames[7].sequence = 0; assert.throws(epoch.room, /sensor changed/);
  const short = fixture(); short.frames.forEach((f, i) => { f.capturedAtMs = 10000 + i * 10; }); assert.throws(short.room, /1.5 seconds/);
});
test('recovery keeps saved geometry but requires three fresh distinct observations and expires promptly', () => {
  const f = fixture(), r = f.room(), tracker = new RoomContinuity(); tracker.setReference(r);
  assert.equal(tracker.status(20000).state, 'stale');
  for (let i = 0; i < 3; i++) { const frame = copyFrame(f.frames[0]); frame.capturedAtMs = 20000 + i * 200; tracker.observe(frame, frame.capturedAtMs, 0); }
  assert.equal(tracker.status(20400).state, 'ready'); assert.equal(tracker.status(20400).canMap, false, 'synthetic is never physically ready');
  tracker.disconnected(); assert.equal(tracker.reference, r); assert.equal(tracker.status(20400).state, 'stale');
  const returning = copyFrame(f.frames[0]); returning.capturedAtMs = 21000;
  tracker.observe(returning, 21000, 1); assert.equal(tracker.status(21000).state, 'checking');
  tracker.observe(returning, 21200, 1); assert.notEqual(tracker.status(21200).state, 'ready');
  returning.capturedAtMs = 21400; tracker.observe(returning, 21400, 1); returning.capturedAtMs = 21600; tracker.observe(returning, 21600, 1);
  assert.equal(tracker.status(21600).state, 'checking', 'duplicate frame reset match count');
  returning.capturedAtMs = 21800; tracker.observe(returning, 21800, 1); assert.equal(tracker.status(21800).state, 'ready');
  assert.equal(tracker.status(24000).state, 'stale');
});
test('movement and replacement latch invalidity instead of averaging a shifted room into place', () => {
  const f = fixture(), r = f.room(), tracker = new RoomContinuity(); tracker.setReference(r);
  const moved = copyFrame(f.frames[0]); moved.capturedAtMs = 20000; moved.depth = moved.depth.map(v => v ? v + 90 : v);
  tracker.observe(moved, 20000, 1); assert.equal(tracker.status(20000).state, 'moved'); assert.equal(tracker.reference, r);
  for (let i = 1; i < 5; i++) { const frame = copyFrame(f.frames[0]); frame.capturedAtMs = 20000 + i * 200; tracker.observe(frame, frame.capturedAtMs, 1); }
  assert.equal(tracker.status(20800).state, 'moved');
  const restored = new RoomContinuity(); restored.setReference({ ...r, invalidated: 'moved' });
  assert.equal(restored.status(21000).state, 'moved', 'persisted warning survives refresh');
  tracker.setReference(r); moved.device.id = 'replacement'; tracker.observe(moved, 21000, 2); assert.equal(tracker.status(21000).state, 'different-sensor');
});
test('old replay and uncertain clocks cannot revalidate live physical readiness', () => {
  const f = fixture(); f.frames.forEach(frame => { frame.device.kind = 'kinect-v2'; });
  const tracker = new RoomContinuity(); tracker.setReference(f.room());
  for (let i = 0; i < 4; i++) tracker.observe(f.frames[i], 30000 + i * 200, 0);
  assert.equal(tracker.status(31000).canMap, false);
  for (let i = 0; i < 3; i++) { const frame = copyFrame(f.frames[0]); frame.capturedAtMs = 32000 + i * 200; tracker.observe(frame, frame.capturedAtMs, 0); }
  assert.equal(tracker.status(32400).canMap, true);
  const uncertain = copyFrame(f.frames[0]); uncertain.capturedAtMs = 32600; uncertain.clockUncertaintyMs = 1000; tracker.observe(uncertain, 32600, 0);
  assert.equal(tracker.status(32600).canMap, false);
});
test('persisted reference validation rejects malformed transforms and inflated point data', () => {
  const r = fixture().room(); validateRoomReference(structuredClone(r));
  assert.throws(() => validateRoomReference({ ...r, positions: [NaN] }), /Invalid/);
  assert.throws(() => validateRoomReference({ ...r, transform: { ...r.transform, up: [1, 1, 0] } }), /metric room/);
  assert.throws(() => validateRoomReference({ ...r, witness: { ...r.witness, meters: [] } }), /metric room/);
});
test('plane solver uses the frozen metric frame and calibration ID, never a later floor estimate', () => {
  const f = fixture(), r = f.room();
  f.session.frames.forEach(frame => { frame.floorPlane![3] += .015; });
  const solved = solveRoomSurfaces(f.session, r), table = solved.candidates.find(c => c.kind === 'table')!;
  assert.ok(table); assert.ok(Math.abs(table.heightAboveFloor! - .8) < .001); assert.equal(table.surface.measurement?.roomReferenceId, r.id);
  f.session.frames[0].device.id = 'other'; assert.equal(roomMatchesFrame(r, f.session.frames[0]), false);
});
