import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { decodeSensorFrame, encodeSensorFrame, encodeSensorSession, type SensorSession } from '../../src/shared/sensor.js';
import { syntheticFrame } from '../../src/shared/syntheticSensor.js';
import { parseSensorBridgeStatus } from '../../src/shared/sensorBridge.js';
import { SensorInbox } from '../../src/shared/sensorStream.js';
import { PacketReader } from '../src/protocol.js';
import { allowedOrigin, startBridge } from '../src/server.js';
import { demoSource, readRecording, replaySource } from '../src/sources.js';
import { nativeSource } from '../src/native.js';
import { RecoveryBackoff } from '../src/recovery.js';
import type { Sink } from '../src/types.js';

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate: () => boolean, timeout = 2500) {
  const deadline = Date.now() + timeout;
  while (!predicate()) { if (Date.now() > deadline) throw new Error('Condition timed out.'); await pause(10); }
}
function connect(port: number, origin: string | undefined = 'http://127.0.0.1:5173') {
  return new WebSocket(`ws://127.0.0.1:${port}`, origin ? { origin } : {});
}
function recording(gap = 35): SensorSession {
  return { version: 1, id: 'helper-test', name: 'Helper replay test', createdAtMs: 1000, kind: 'recording', provenance: 'synthetic', status: 'complete', message: '',
    frames: [syntheticFrame(4, 1000), syntheticFrame(5, 1000 + gap), syntheticFrame(6, 1000 + gap * 2)], captures: [], plannedPatterns: [] };
}
function nativePacket() {
  const frame = syntheticFrame(0, Date.now());
  frame.device = { ...frame.device, id: 'fake-native', kind: 'kinect-v2', color: { width: 2, height: 1 }, depth: { width: 2, height: 1 }, colorIntrinsics: null, depthIntrinsics: null };
  frame.color = new Uint8Array([1,2,3,4,5,6]); frame.depth = new Uint16Array([0,2200]);
  const bytes = encodeSensorFrame(frame), prefix = Buffer.alloc(4); prefix.writeUInt32LE(bytes.length);
  return Buffer.concat([prefix, bytes]);
}
function nativeStatus(state: string) {
  const bytes = Buffer.from(JSON.stringify({ protocol: 'pm-sensor', version: 1, type: 'status', mode: 'live', state, message: 'Test native state' }));
  const prefix = Buffer.alloc(4); prefix.writeUInt32LE(bytes.length); return Buffer.concat([prefix, bytes]);
}

test('native framing handles byte-at-a-time fragmentation and coalesced packets', () => {
  const expected = nativePacket(), output: Buffer[] = [], reader = new PacketReader(b => output.push(b));
  for (const byte of expected) reader.push(Uint8Array.of(byte));
  reader.push(Buffer.concat([expected, expected])); reader.finish();
  assert.equal(output.length, 3);
  assert.equal(decodeSensorFrame(output[0]).device.id, 'fake-native');
  assert.deepEqual(output[0], output[2]);
});
test('native framing rejects oversized lengths before allocation and truncated EOF', () => {
  const reader = new PacketReader(() => assert.fail());
  assert.throws(() => reader.push(Buffer.from([255,255,255,255])), /size limit/);
  assert.throws(() => reader.push(Buffer.from([0])), /failed/);
  const partial = new PacketReader(() => assert.fail()); partial.push(nativePacket().subarray(0, 20));
  assert.throws(() => partial.finish(), /during a frame/);
});
test('origin allowlist rejects arbitrary local ports, remote and opaque origins', () => {
  for (const origin of [undefined, 'null', 'https://evil.example', 'http://127.0.0.1.evil.example:5173', 'http://127.0.0.1:5174', 'http://127.0.0.1:5173/']) assert.equal(allowedOrigin(origin), false);
  assert.equal(allowedOrigin('http://127.0.0.1:5173'), true);
});
test('actual WebSocket demo sends canonical status before ordered frames', async t => {
  const bridge = await startBridge({ mode: 'demo', source: demoSource, port: 0 }); t.after(() => bridge.stop());
  const socket = connect(bridge.port); t.after(() => socket.terminate());
  const inbox = new SensorInbox(), messages: string[] = [];
  socket.on('message', (bytes, binary) => {
    if (!binary) { messages.push(parseSensorBridgeStatus(bytes.toString()).mode); return; }
    assert.equal(messages[0], 'demo'); inbox.push(decodeSensorFrame(new Uint8Array(bytes as Buffer)));
  });
  await until(() => (inbox.latest?.frame.sequence ?? -1) >= 3);
  assert.equal(inbox.latest?.frame.device.kind, 'synthetic');
  assert.ok(bridge.stats.sentFrames >= 2);
});
test('WebSocket rejects absent/foreign Origin and client write messages', async t => {
  const bridge = await startBridge({ mode: 'demo', source: demoSource, port: 0 }); t.after(() => bridge.stop());
  for (const origin of [null, 'https://untrusted.example']) {
    const socket = origin === null ? new WebSocket(`ws://127.0.0.1:${bridge.port}`) : connect(bridge.port, origin);
    const [error] = await once(socket, 'error'); assert.match(String(error), /403/);
  }
  const allowed = connect(bridge.port); await once(allowed, 'open');
  allowed.send('change source'); const [code] = await once(allowed, 'close'); assert.equal(code, 1008);
});
test('source startup failure stays observable while live recovery is pending and stop cancels retries', async () => {
  let starts = 0;
  const bridge = await startBridge({ mode: 'live', retryMs: 30, source: () => { starts++; throw new Error('test failure'); }, port: 0 });
  assert.equal(bridge.status.state, 'waiting'); assert.match(bridge.status.message, /test failure/); await bridge.stop();
  await pause(90); assert.equal(starts, 1);
});
test('invalid asynchronous live frame retires source and announces a waiting boundary', async t => {
  let sink!: Sink, stopped = false;
  const bridge = await startBridge({ mode: 'live', port: 0, source: s => { sink = s; s.status('streaming', 'test'); return { stop: () => { stopped = true; } }; } }); t.after(() => bridge.stop());
  sink.frame(syntheticFrame(0, Date.now()));
  assert.equal(bridge.status.state, 'waiting'); assert.equal(stopped, true);
});

test('same WebSocket survives failed source recovery with a boundary before sequence zero and no retired callbacks', async t => {
  const sinks: Sink[] = []; let stops = 0;
  const bridge = await startBridge({ mode: 'live', port: 0, retryMs: 30, source: sink => {
    sinks.push(sink); sink.status('streaming', 'test acquisition'); return { stop() { stops++; } };
  } }); t.after(() => bridge.stop());
  const socket = connect(bridge.port); t.after(() => socket.terminate());
  const inbox = new SensorInbox(), events: string[] = [];
  socket.on('message', (bytes, binary) => {
    if (!binary) { const status = parseSensorBridgeStatus(bytes.toString()); events.push(status.state); if (status.state !== 'streaming') inbox.reset(); }
    else { const frame = decodeSensorFrame(new Uint8Array(bytes as Buffer)); inbox.push(frame); events.push(`frame:${frame.sequence}`); }
  });
  await once(socket, 'open'); const frame = decodeSensorFrame(nativePacket().subarray(4));
  sinks[0].frame(frame); await until(() => events.includes('frame:0'));
  sinks[0].frame(frame); // Duplicate sequence retires this acquisition rather than replaying it.
  await until(() => sinks.length === 2);
  sinks[0].status('error', 'late retired status'); sinks[0].frame({ ...frame, sequence: 10 });
  sinks[1].frame(frame); await until(() => events.filter(e => e === 'frame:0').length === 2);
  assert.equal(socket.readyState, WebSocket.OPEN); assert.equal(stops, 1);
  assert.equal(events.includes('error'), false); assert.equal(events.includes('frame:10'), false);
  const first = events.indexOf('frame:0'), last = events.lastIndexOf('frame:0');
  assert.ok(events.slice(first + 1, last).includes('waiting')); assert.equal(inbox.latest!.frame.sequence, 0);
});

test('live source factory throw recovers and synchronous failed source handle is retired exactly once', async t => {
  let attempts = 0, stops = 0; const states: string[] = [];
  const bridge = await startBridge({ mode: 'live', port: 0, retryMs: 10, onStatus: s => states.push(s.state), source: sink => {
    attempts++;
    if (attempts === 1) throw new Error('transient opening failure');
    sink.status('streaming', 'test');
    if (attempts === 2) sink.frame(syntheticFrame(0, Date.now()));
    else sink.frame(decodeSensorFrame(nativePacket().subarray(4)));
    return { stop() { stops++; } };
  } }); t.after(() => bridge.stop());
  await until(() => attempts === 3);
  assert.equal(stops, 1); assert.equal(bridge.status.state, 'streaming');
  assert.ok(states.filter(s => s === 'waiting').length >= 3);
});

test('recovery backoff is bounded and a single intermittent frame cannot reset a failure streak', () => {
  const retry = new RecoveryBackoff(); assert.equal(retry.nextDelay(), 2000);
  retry.frame(0); assert.equal(retry.nextDelay(), 4000);
  retry.frame(0); retry.frame(500); retry.frame(1000); retry.frame(1500);
  assert.equal(retry.nextDelay(), 8000); assert.equal(retry.nextDelay(), 10000);
  for (let i = 0; i < 5; i++) retry.frame(i * 500);
  assert.equal(retry.nextDelay(), 2000);
});

test('native synchronous launch failure retries and stop prevents later launches', async () => {
  let launches = 0, frames = 0; const states: string[] = [], packet = nativePacket().toString('base64');
  const source = nativeSource('unused', { retryMs: 15, launch: () => {
    if (++launches === 1) throw new Error('temporary process launch failure');
    return spawn(process.execPath, ['-e', `process.stdout.write(Buffer.from('${packet}','base64'));setInterval(()=>{},1000)`], { stdio: ['pipe','pipe','pipe'] });
  } })({ status: state => states.push(state), frame: () => { frames++; } });
  try { await until(() => frames === 1); } finally { source.stop(); }
  await pause(60); assert.equal(launches, 2); assert.equal(states[0], 'waiting'); assert.ok(states.includes('streaming'));
});
test('backpressure skips surplus frames and sends only bounded in-flight work', async t => {
  let sink!: Sink;
  const bridge = await startBridge({ mode: 'demo', port: 0, source: s => { sink = s; s.status('streaming', 'test'); return { stop() {} }; } }); t.after(() => bridge.stop());
  const socket = connect(bridge.port); t.after(() => socket.terminate()); await once(socket, 'open');
  for (let i = 0; i < 30; i++) sink.frame(syntheticFrame(i, Date.now()));
  assert.equal(bridge.stats.sentFrames, 1); assert.equal(bridge.stats.skippedFrames, 29);
});
test('waiting resets stream identity so reconnect can begin sequence zero', async t => {
  let sink!: Sink;
  const bridge = await startBridge({ mode: 'live', port: 0, source: s => { sink = s; return { stop() {} }; } }); t.after(() => bridge.stop());
  const frame = decodeSensorFrame(nativePacket().subarray(4));
  sink.status('streaming', 'ready'); sink.frame(frame); sink.status('waiting', 'disconnected');
  sink.status('streaming', 'ready'); sink.frame(frame); assert.equal(bridge.status.state, 'streaming');
});
test('PMS1 replay retains original acquisition times and completes exactly once', async t => {
  const expected = recording(), bridge = await startBridge({ mode: 'replay', port: 0, source: replaySource(expected) }); t.after(() => bridge.stop());
  const socket = connect(bridge.port), sequences: number[] = [], times: number[] = [], modes: string[] = [];
  t.after(() => socket.terminate());
  socket.on('message', (data, binary) => {
    if (binary) { const frame = decodeSensorFrame(new Uint8Array(data as Buffer)); sequences.push(frame.sequence); times.push(frame.capturedAtMs); }
    else modes.push(parseSensorBridgeStatus(data.toString()).mode);
  });
  await until(() => bridge.status.state === 'ended'); await pause(40);
  assert.deepEqual(sequences, [4,5,6]); assert.deepEqual(times, [1000,1035,1070]); assert.ok(modes.every(mode => mode === 'replay'));
  socket.close(); await once(socket, 'close');
  const next = connect(bridge.port); t.after(() => next.terminate()); const replayed: number[] = [];
  next.on('message', (data, binary) => { if (binary) replayed.push(decodeSensorFrame(new Uint8Array(data as Buffer)).sequence); });
  await until(() => replayed.length === 3); assert.deepEqual(replayed, [4,5,6]);
});
test('replay heartbeat survives long recording gaps and stop cancels timers', async () => {
  const states: string[] = [], frames: number[] = [];
  const source = replaySource(recording(16000))({ status: state => states.push(state), frame: frame => frames.push(frame.sequence) });
  await pause(2100); source.stop(); assert.ok(states.length >= 2); assert.deepEqual(frames, [4]);
});
test('session file import validates bytes and rejects malformed data', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'pm-helper-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'sample.pmsession'); await writeFile(path, encodeSensorSession(recording()));
  assert.equal((await readRecording(path)).frames.length, 3);
  await writeFile(path, Buffer.from('invalid')); await assert.rejects(readRecording(path), /sensor file/);
  assert.throws(() => replaySource(recording(), 0), /speed/);
});
test('unsupported platform reports an honest live error without synthetic fallback', () => {
  const states: string[] = [];
  const source = nativeSource('/missing', { platform: 'darwin' })({ status: (state, message) => states.push(`${state}:${message}`), frame: () => assert.fail('No fake native frames') });
  source.stop(); assert.match(states[0], /error:.*requires Windows/);
});
test('native crash restarts with waiting status and stop terminates child', async () => {
  let launches = 0; const children: ReturnType<typeof spawn>[] = [], states: string[] = [];
  const source = nativeSource('unused', { retryMs: 20, launch: () => {
    launches++; const child = spawn(process.execPath, ['-e', 'setTimeout(()=>process.exit(1),30)'], { stdio: ['pipe','pipe','pipe'] }); children.push(child); return child;
  } })({ status: state => states.push(state), frame: () => assert.fail() });
  try { await until(() => launches >= 2); } finally { source.stop(); }
  const count = launches; await pause(70); assert.equal(launches, count); assert.ok(states.includes('waiting')); assert.ok(children.every(child => child.killed || child.exitCode !== null));
});
test('native fragmented output decodes; stale acquisition restarts before browser timeout', async () => {
  const frame = nativePacket().toString('base64'); let frames = 0, launches = 0; const states: string[] = [];
  const source = nativeSource('unused', { watchdogMs: 100, retryMs: 20, launch: () => {
    launches++; return spawn(process.execPath, ['-e', `const b=Buffer.from('${frame}','base64');process.stdout.write(b.subarray(0,3));setTimeout(()=>process.stdout.write(b.subarray(3)),5);setInterval(()=>{},1000);`], { stdio: ['pipe','pipe','pipe'] });
  } })({ status: state => states.push(state), frame: () => { frames++; } });
  try { await until(() => launches >= 2 && frames >= 1); } finally { source.stop(); }
  assert.ok(states.includes('streaming')); assert.ok(states.includes('waiting'));
});

test('native statuses and frames share order; frames after retirement are ignored', async () => {
  let frames = 0; const states: string[] = [];
  const packets = Buffer.concat([nativeStatus('waiting'), nativeStatus('streaming'), nativePacket(), nativeStatus('waiting'), nativePacket()]).toString('base64');
  const source = nativeSource('unused', { retryMs: 5000, launch: () => spawn(process.execPath, ['-e', `process.stdout.write(Buffer.from('${packets}','base64'));setInterval(()=>{},1000);`], { stdio: ['pipe','pipe','pipe'] }) })({ status: state => states.push(state), frame: () => { frames++; } });
  try { await until(() => frames >= 1 && states.at(-1) === 'waiting'); await pause(40); }
  finally { source.stop(); }
  assert.equal(frames, 1); assert.equal(states.filter(state => state === 'streaming').length, 1);
});

test('watchdog ignores a retired child that writes another frame before exiting', async () => {
  let frames = 0; const states: string[] = [];
  const packet = nativePacket().toString('base64');
  const source = nativeSource('unused', { watchdogMs: 100, retryMs: 5000, launch: () => spawn(process.execPath, ['-e',
    `const b=Buffer.from('${packet}','base64');process.on('SIGTERM',()=>{process.stdout.write(b);setTimeout(()=>process.exit(0),70)});process.stdout.write(b);setInterval(()=>{},1000);`
  ], { stdio: ['pipe','pipe','pipe'] }) })({ status: state => states.push(state), frame: () => { frames++; } });
  try { await until(() => frames === 1 && states.filter(state => state === 'waiting').length >= 2); await pause(120); }
  finally { source.stop(); }
  assert.equal(frames, 1); assert.equal(states.filter(state => state === 'streaming').length, 1);
});

test('actual C# encoder fixture is accepted by the canonical TypeScript decoder', { skip: !process.env.PM_NATIVE_FIXTURE }, async () => {
  const bytes = await readFile(process.env.PM_NATIVE_FIXTURE!); let decoded = false;
  const reader = new PacketReader(packet => {
    const frame = decodeSensorFrame(packet); decoded = true;
    assert.equal(frame.sequence, 7); assert.deepEqual([...frame.color], [3,2,1,8,7,6]); assert.deepEqual([...frame.depth], [0,2200]);
  }); reader.push(bytes); reader.finish(); assert.equal(decoded, true);
});

test('actual C# registered RGB/XYZ fixture preserves geometry through app encoding', { skip: !process.env.PM_NATIVE_REGISTERED_FIXTURE }, async () => {
  const bytes = await readFile(process.env.PM_NATIVE_REGISTERED_FIXTURE!); let decoded = false;
  const reader = new PacketReader(packet => {
    const frame = decodeSensorFrame(packet); decoded = true;
    assert.equal(frame.device.colorRegistration, 'depth');
    assert.deepEqual(frame.device.color, frame.device.depth);
    assert.deepEqual([...frame.color], [0,0,0,8,7,6]);
    assert.deepEqual([...frame.depth], [0,2200]);
    assert.deepEqual([...frame.cameraPoints!], [0,0,0,-.25,.5,Math.fround(2.2)]);
    assert.deepEqual(frame.floorPlane, [0,1,0,1.5]);
    assert.deepEqual(decodeSensorFrame(encodeSensorFrame(frame)), { ...frame, color: new Uint8Array(frame.color) });
  }); reader.push(bytes.subarray(0, 11)); reader.push(bytes.subarray(11)); reader.finish(); assert.equal(decoded, true);
});
