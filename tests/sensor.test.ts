import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeSensorFrame, encodeSensorFrame, decodeSensorSession, encodeSensorSession, validateSession, type SensorSession } from '../src/shared/sensor.ts';
import { syntheticFrame } from '../src/shared/syntheticSensor.ts';
import { localSensorURL, SensorInbox } from '../src/shared/sensorStream.ts';

function recording(): SensorSession {
  return { version: 1, id: 'test-recording', name: 'Synthetic test', createdAtMs: 1000, kind: 'recording', provenance: 'synthetic', status: 'complete', message: '',
    frames: [syntheticFrame(0, 1000), syntheticFrame(1, 1200)], captures: [], plannedPatterns: [] };
}
test('binary RGB/depth frame preserves units, intrinsics, invalid samples and uint16 byte order', () => {
  const frame = syntheticFrame(44, 123456.25); frame.depth[0] = 0; frame.depth[1] = 65535; frame.depth[2] = 258;
  const encoded = encodeSensorFrame(frame), unaligned = new Uint8Array(encoded.length + 3); unaligned.set(encoded, 3);
  assert.deepEqual(decodeSensorFrame(unaligned.subarray(3)), frame);
});
test('binary recording round-trips without JSON pixel arrays', () => {
  const session = recording(), binary = encodeSensorSession(session);
  assert.deepEqual(decodeSensorSession(binary), session);
  const rawSize = session.frames.reduce((n, f) => n + f.color.byteLength + f.depth.byteLength, 0);
  assert.ok(binary.length < rawSize + 5000);
});
test('rejects corrupt, truncated, oversized and mislabeled session data', () => {
  const encoded = encodeSensorSession(recording());
  for (const bytes of [encoded.slice(0, 3), encoded.slice(0, -1), new Uint8Array([...encoded, 0])]) assert.throws(() => decodeSensorSession(bytes));
  const bad = recording(); bad.provenance = 'sensor'; assert.throws(() => validateSession(bad), /labels/);
  const dimension = syntheticFrame(1, 1); dimension.device = structuredClone(dimension.device); dimension.device.color.width = 100000;
  assert.throws(() => encodeSensorFrame(dimension), /dimensions/);
  const raw = encodeSensorFrame(syntheticFrame(0, 1)); new DataView(raw.buffer).setUint32(4, 0xffffffff, true);
  assert.throws(() => decodeSensorFrame(raw), /metadata/);
});
test('session validation rejects frame reordering and changing sensor modes', () => {
  const session = recording(); session.frames.reverse(); assert.throws(() => validateSession(session), /ordered/);
  const changed = recording(); changed.frames[1].device = structuredClone(changed.frames[1].device); changed.frames[1].device.depthScaleMeters = .01;
  assert.throws(() => validateSession(changed), /stable sensor/);
});
test('capture inbox ignores delayed exposures even if they arrive after settling', async () => {
  const inbox = new SensorInbox(), controller = new AbortController();
  let resolved = false;
  const promise = inbox.waitAfter(2000, controller.signal, 500).then(value => { resolved = true; return value; });
  inbox.push(syntheticFrame(0, 1000), 2100); await Promise.resolve(); assert.equal(resolved, false);
  const uncertain = syntheticFrame(1, 2050); uncertain.clockUncertaintyMs = 100; inbox.push(uncertain, 2150);
  await Promise.resolve(); assert.equal(resolved, false);
  inbox.push(syntheticFrame(2, 2200), 2210); assert.equal((await promise).frame.sequence, 2);
});
test('capture waits cancel promptly, time out and reject disconnects without stale reuse', async () => {
  const inbox = new SensorInbox(), cancelled = new AbortController();
  const waiting = inbox.waitAfter(1000, cancelled.signal, 500); cancelled.abort(); await assert.rejects(waiting, /cancelled/);
  await assert.rejects(inbox.waitAfter(1000, new AbortController().signal, 5), /No fresh/);
  const disconnect = inbox.waitAfter(1000, new AbortController().signal); inbox.reset(); await assert.rejects(disconnect, /disconnected/);
  inbox.push(syntheticFrame(0, 1100), 1101); assert.equal(inbox.latest?.frame.sequence, 0);
});
test('live frames enforce sequence order and local sensor endpoint restrictions', () => {
  const inbox = new SensorInbox(); inbox.push(syntheticFrame(4, 1000), 1001);
  assert.throws(() => inbox.push(syntheticFrame(3, 1200), 1201), /out-of-order/);
  assert.equal(localSensorURL('ws://127.0.0.1:5174'), 'ws://127.0.0.1:5174/');
  assert.equal(localSensorURL('ws://[::1]:5174'), 'ws://[::1]:5174/');
  for (const endpoint of ['https://localhost:5174', 'ws://example.com', 'ws://localhost.evil.test', 'ws://user:pass@localhost:5174']) assert.throws(() => localSensorURL(endpoint), /local bridge/);
});
