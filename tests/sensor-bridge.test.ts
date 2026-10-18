import test from 'node:test';
import assert from 'node:assert/strict';
import { localSensor, recoveringSensor, type LocalSensorMode, type LocalSensorState } from '../src/sensorSources.ts';
import { parseSensorBridgeStatus, validateSensorBridgeStatus } from '../src/shared/sensorBridge.ts';
import { SensorInbox } from '../src/shared/sensorStream.ts';
import { encodeSensorFrame } from '../src/shared/sensor.ts';
import { syntheticFrame } from '../src/shared/syntheticSensor.ts';

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const status = (mode = 'live', state = 'streaming', message = 'Helper status') => JSON.stringify({ protocol: 'pm-sensor', version: 1, type: 'status', mode, state, message });
class Socket {
  binaryType = ''; closed = false;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  close() { this.closed = true; }
  send(data: unknown) { this.onmessage?.({ data }); }
}
function frame(sequence = 0, kind = 'kinect-v2', time = Date.now()) {
  const value = syntheticFrame(sequence, time); value.device = { ...value.device, kind: kind as 'kinect-v2' | 'synthetic' }; return encodeSensorFrame(value).buffer;
}
function fixture(options = {}) {
  const socket = new Socket(), inbox = new SensorInbox();
  const events: { state: LocalSensorState; mode: LocalSensorMode; message: string }[] = [];
  const source = localSensor(inbox, 'ws://localhost:5174', (state, message, mode) => events.push({ state, message, mode }), { createSocket: () => socket as unknown as WebSocket, ...options });
  return { socket, inbox, events, source };
}
test('helper status accepts only the versioned bounded control protocol', () => {
  assert.equal(parseSensorBridgeStatus(status('demo', 'waiting')).mode, 'demo');
  for (const input of ['{}', '{', status('remote'), status('live', 'made-up'), status('live', 'waiting', 'x'.repeat(501)), status('live', 'waiting', '\u0000'), ' '.repeat(4097)]) assert.throws(() => parseSensorBridgeStatus(input));
  assert.throws(() => validateSensorBridgeStatus({ protocol: 'pm-sensor', version: 1, type: 'status', mode: ['live'], state: 'streaming', message: '' }));
});
test('legacy live PMF1 works; generated frames require an explicit demo handshake', () => {
  const legacy = fixture(); legacy.socket.send(frame()); assert.equal(legacy.events.at(-1)?.state, 'connected'); legacy.source.stop();
  const bad = fixture(); bad.socket.send(frame(0, 'synthetic')); assert.equal(bad.events.at(-1)?.state, 'error'); assert.equal(bad.inbox.latest, null); bad.source.stop();
  const demo = fixture(); demo.socket.send(status('demo')); demo.socket.send(frame(0, 'synthetic'));
  assert.deepEqual([demo.events.at(-1)?.state, demo.events.at(-1)?.mode], ['connected', 'demo']); demo.source.stop();
});
test('helper cannot switch provenance or send inconsistent source kinds mid-connection', () => {
  const f = fixture(); f.socket.send(status('live')); f.socket.send(frame()); f.socket.send(status('replay'));
  assert.equal(f.events.at(-1)?.state, 'error'); assert.equal(f.socket.closed, true); assert.equal(f.inbox.latest, null); f.source.stop();
  const demo = fixture(); demo.socket.send(status('demo')); demo.socket.send(frame()); assert.match(demo.events.at(-1)!.message, /generated/); demo.source.stop();
});
test('waiting invalidates acquisition, clears stale frames and permits a new live session', async () => {
  const f = fixture(); f.socket.send(status()); f.socket.send(frame(5));
  const generation = f.inbox.generation, pending = f.inbox.waitAfter(Date.now() + 20000, new AbortController().signal);
  f.socket.send(status('live', 'waiting', 'Reconnect USB.')); await assert.rejects(pending, /Reconnect USB/);
  assert.ok(f.inbox.generation > generation); assert.equal(f.inbox.latest, null); assert.equal(f.events.at(-1)?.state, 'waiting');
  f.socket.send(status()); f.socket.send(frame(0)); assert.equal(f.events.at(-1)?.state, 'connected'); f.source.stop();
});
test('replay keeps original capture times and cannot silently become a live source', async () => {
  const f = fixture({ staleFrameMs: 5, heartbeatTimeoutMs: 1000, healthIntervalMs: 2 });
  f.socket.send(status('replay')); f.socket.send(frame(0, 'kinect-v2', 1000)); await pause(20);
  assert.equal(f.socket.closed, false); assert.equal(f.events.at(-1)?.mode, 'replay'); assert.equal(f.inbox.latest?.frame.capturedAtMs, 1000);
  f.socket.send(status('replay', 'ended')); assert.equal(f.events.at(-1)?.state, 'ended'); assert.equal(f.inbox.latest, null); f.source.stop();
});
test('stalled startup, active source, and missing waiting heartbeat fail with recovery guidance', async () => {
  const starting = fixture({ firstFrameTimeoutMs: 5, healthIntervalMs: 2 }); await pause(25); assert.equal(starting.events.at(-1)?.state, 'error'); assert.match(starting.events.at(-1)!.message, /reconnect/); starting.source.stop();
  const stale = fixture({ staleFrameMs: 5, healthIntervalMs: 2 }); stale.socket.send(status()); stale.socket.send(frame()); await pause(25); assert.match(stale.events.at(-1)!.message, /stopped sending/); stale.source.stop();
  const waiting = fixture({ heartbeatTimeoutMs: 5, healthIntervalMs: 2 }); waiting.socket.send(status('live', 'waiting')); await pause(25); assert.match(waiting.events.at(-1)!.message, /stopped responding/); waiting.source.stop();
});
test('fatal helper errors and malformed frames clear data; stopped sources ignore late events', () => {
  const f = fixture(); f.socket.send(status()); f.socket.send(frame()); f.socket.send(status('live', 'error', 'SDK missing.'));
  assert.equal(f.events.at(-1)?.message, 'SDK missing.'); assert.equal(f.inbox.latest, null); const count = f.events.length;
  f.socket.send(frame(1)); f.socket.onerror?.(); assert.equal(f.events.length, count); f.source.stop();
  const invalid = fixture(); invalid.socket.send(new ArrayBuffer(5)); assert.equal(invalid.events.at(-1)?.state, 'error'); invalid.source.stop();
});

test('automatic recovery resets acquisition, ignores old sockets, accepts sequence zero and stops retrying on demand', async () => {
  const sockets: Socket[] = [], inbox = new SensorInbox(), events: string[] = [];
  const source = recoveringSensor(inbox, 'ws://localhost:5174', state => events.push(state), { retryBaseMs: 2, createSocket: () => { const s = new Socket(); sockets.push(s); return s as unknown as WebSocket; } });
  sockets[0].send(status()); sockets[0].send(frame(9)); const generation = inbox.generation;
  const waiting = inbox.waitAfter(Date.now() + 10000, new AbortController().signal);
  sockets[0].onclose?.(); await assert.rejects(waiting, /disconnected/); assert.equal(inbox.latest, null); assert.ok(inbox.generation > generation);
  await pause(20); assert.equal(sockets.length, 2);
  sockets[0].send(frame(10)); assert.equal(inbox.latest, null);
  sockets[1].send(status()); sockets[1].send(frame(0)); assert.equal(events.at(-1), 'connected');
  sockets[1].onerror?.(); source.stop(); await pause(20); assert.equal(sockets.length, 2);
});
test('recovery is bounded and does not retry corrupt data, fatal SDK failures or ended replay', async () => {
  const sockets: Socket[] = [], inbox = new SensorInbox(), events: string[] = [];
  const source = recoveringSensor(inbox, 'ws://localhost:5174', state => events.push(state), { maxReconnects: 1, retryBaseMs: 2, createSocket: () => { const s = new Socket(); sockets.push(s); return s as unknown as WebSocket; } });
  sockets[0].onerror?.(); await pause(20); sockets[1].onerror?.(); await pause(20); assert.equal(events.at(-1), 'error'); assert.equal(sockets.length, 2); source.stop();
  for (const payload of [new ArrayBuffer(3), status('live', 'error', 'No SDK'), status('replay', 'ended')]) {
    let calls = 0; const socket = new Socket();
    const stopped = recoveringSensor(new SensorInbox(), 'ws://localhost:5174', () => {}, { retryBaseMs: 2, createSocket: () => { calls++; return socket as unknown as WebSocket; } });
    socket.send(payload); await pause(10); assert.equal(calls, 1); stopped.stop();
  }
});
