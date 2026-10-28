import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createProjectionInbox } from '../src/relay/inbox.js';
import { createProjectionRelayServer } from '../src/relay/server.js';
import { createProjectionRelayWorker } from '../src/relay/worker.js';
import { readProjectionRelayConfig, type ProjectionRelayStatus } from '../src/relay/types.js';
import { createProjectionAgent } from '../src/projection-agent.js';
import { canvasFixture } from './canvas-fixture.js';
import { MockLanguageModelV4, textReply, toolReply } from './model.js';

const cleanups = new WeakMap<TestContext, (() => unknown | Promise<unknown>)[]>();
function cleanup(t: TestContext, work: () => unknown | Promise<unknown>) {
  let list = cleanups.get(t);
  if (!list) { list = []; cleanups.set(t, list); t.after(async () => { for (const fn of list!.reverse()) await fn(); }); }
  list.push(work);
}
const request = (requestId = 'task-1') => ({ kind: 'task_update' as const, requestId, targetId: 'home-studio', title: 'Research complete', summary: 'Three useful results are ready.', ttlSeconds: 60 });
function directory(t: TestContext) { const path = mkdtempSync(join(tmpdir(), 'projection-relay-test-')); cleanup(t, () => rmSync(path, { recursive: true, force: true })); return path; }
function fixture(t: TestContext, options: { now?: () => number; capacity?: number } = {}) {
  const dir = directory(t), path = join(dir, 'inbox.json');
  const inbox = createProjectionInbox({ path, targetId: 'home-studio', ...options }); cleanup(t, () => inbox.close());
  return { dir, path, inbox };
}
async function httpFixture(t: TestContext) {
  const f = fixture(t), submitToken = randomBytes(32).toString('hex'), deviceToken = randomBytes(32).toString('hex'), allowedHosts: string[] = ['localhost'];
  const server = createProjectionRelayServer({ inbox: f.inbox, submitToken, deviceToken, allowedHosts });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = (server.address() as { port: number }).port;
  allowedHosts.push('127.0.0.1:' + port);
  cleanup(t, () => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }));
  const url = 'http://127.0.0.1:' + port;
  const post = (path: string, value: unknown, token = submitToken, headers = {}) => fetch(url + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, ...headers }, body: JSON.stringify(value),
  });
  return { ...f, server, url, submitToken, deviceToken, post };
}

test('relay configuration defaults off and never permits insecure remote credential transport', () => {
  assert.equal(readProjectionRelayConfig({}), null);
  assert.throws(() => readProjectionRelayConfig({ PROJECTION_RELAY_URL: 'https://example.com' }), /Set the relay/);
  const env = { PROJECTION_RELAY_URL: 'https://example.com', PROJECTION_RELAY_DEVICE_TOKEN: 'x'.repeat(32), PROJECTION_RELAY_DEVICE_ID: 'home-studio' };
  assert.equal(readProjectionRelayConfig(env)?.deviceId, 'home-studio');
  for (const url of ['http://example.com', 'https://user:secret@example.com', 'https://example.com/mcp', 'https://example.com?token=x']) assert.throws(() => readProjectionRelayConfig({ ...env, PROJECTION_RELAY_URL: url }));
  assert.ok(readProjectionRelayConfig({ ...env, PROJECTION_RELAY_URL: 'http://127.0.0.1:8787' }));
});

test('inbox persists requests, deduplicates retries and rejects changed payload under the same ID', t => {
  const f = fixture(t);
  const first = f.inbox.submit(request());
  assert.equal(first.state, 'queued'); assert.equal(first.projectionVerified, false);
  assert.equal(f.inbox.submit(request()).id, first.id); assert.equal(f.inbox.submit(request()).duplicate, true);
  assert.throws(() => f.inbox.submit({ ...request(), summary: 'different' }), /different content/);
  assert.throws(() => f.inbox.submit({ ...request(), targetId: 'wrong-room' }), /Unknown projector/);
  assert.throws(() => f.inbox.submit({ ...request('large'), summary: '\u0000'.repeat(4000) }), /message limit/);
  assert.equal(JSON.parse(readFileSync(f.path, 'utf8')).jobs.length, 1);
  assert.throws(() => createProjectionInbox({ path: f.path, targetId: 'home-studio' }), /locked/);
  f.inbox.close();
  assert.throws(() => createProjectionInbox({ path: f.path, targetId: 'other-room' }), /another installation/);
  const reopened = createProjectionInbox({ path: f.path, targetId: 'home-studio' });
  try { assert.equal(reopened.get(first.id).state, 'queued'); assert.equal(reopened.submit(request()).duplicate, true); } finally { reopened.close(); }
});

test('expired and cancelled jobs cannot start; running jobs never automatically replay', t => {
  let time = 1000; const { inbox } = fixture(t, { now: () => time });
  const expired = inbox.submit(request('expire'));
  time += 61000; assert.equal(inbox.claim(), null); assert.equal(inbox.get(expired.id).state, 'expired');
  const pending = inbox.submit(request('cancel')), lease = inbox.claim()!;
  inbox.cancel(pending.id); assert.throws(() => inbox.start(pending.id, lease.leaseToken));
  const running = inbox.submit(request('run')), claimed = inbox.claim()!;
  assert.throws(() => inbox.start(running.id, 'wrong'), /lease/);
  inbox.start(running.id, claimed.leaseToken); assert.equal(inbox.claim(), null);
  assert.throws(() => inbox.cancel(running.id), /Only requests/);
  time += 181000; assert.equal(inbox.get(running.id).state, 'uncertain'); assert.equal(inbox.claim(), null);
  const receipt = { status: 'incomplete' as const, text: 'Note created; requested movie generation unavailable.' };
  assert.equal(inbox.finish(running.id, claimed.leaseToken, receipt).state, 'incomplete');
  assert.equal(inbox.finish(running.id, claimed.leaseToken, receipt).state, 'incomplete');
  assert.throws(() => inbox.finish(running.id, claimed.leaseToken, { status: 'complete', text: 'different' }), /different completion/);
});

test('abandoned unstarted leases can retry, retention is bounded and data corruption fails closed', t => {
  let time = 1000; const { inbox, path } = fixture(t, { now: () => time, capacity: 1 });
  const first = inbox.submit(request()); const lease = inbox.claim()!;
  time += 31000; const next = inbox.claim()!;
  assert.equal(next.job.id, first.id); assert.notEqual(next.leaseToken, lease.leaseToken);
  assert.throws(() => inbox.start(first.id, lease.leaseToken), /lease/);
  assert.throws(() => inbox.submit(request('second')), /retention limit/);
  inbox.close(); writeFileSync(path, 'corrupt');
  assert.throws(() => createProjectionInbox({ path, targetId: 'home-studio' }), /not reset/);
  assert.equal(readFileSync(path, 'utf8'), 'corrupt');
});

test('HTTP relay enforces credentials, roles, origin, host, target, fields and size', async t => {
  const f = await httpFixture(t);
  assert.equal((await f.post('/jobs', request(), 'wrong')).status, 401);
  assert.equal((await f.post('/jobs', request(), f.deviceToken)).status, 401);
  assert.equal((await f.post('/device/claim', { deviceId: 'home-studio' }, f.submitToken)).status, 401);
  assert.equal((await f.post('/jobs', request(), f.submitToken, { Origin: 'https://unrelated.example' })).status, 403);
  assert.equal(await new Promise<number>(resolve => { const req = httpRequest(f.url + '/jobs', { method: 'POST', headers: { Host: 'unrelated.example', Authorization: 'Bearer ' + f.submitToken } }, res => { res.resume(); resolve(res.statusCode!); }); req.end(); }), 403);
  assert.equal((await f.post('/device/claim', { deviceId: 'other-room' }, f.deviceToken)).status, 409);
  assert.equal((await f.post('/jobs', { ...request(), arbitraryCode: 'no' })).status, 400);
  assert.equal((await f.post('/jobs', { ...request(), summary: 'x'.repeat(40000) })).status, 409);
  assert.equal((await f.post('/jobs', request())).status, 200);
  assert.equal(f.inbox.status().counts.queued, 1);
});

test('official MCP client discovers tools and sends a task update through actual HTTP transport', async t => {
  const f = await httpFixture(t), client = new Client({ name: 'relay-test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(f.url + '/mcp'), { requestInit: { headers: { Authorization: 'Bearer ' + f.submitToken } } }));
  cleanup(t, () => client.close());
  assert.deepEqual((await client.listTools()).tools.map(tool => tool.name).sort(), ['cancel_projection_request', 'get_projection_request', 'get_projector_status', 'publish_task_update', 'request_projection']);
  const args = { requestId: 'mcp-task', targetId: 'home-studio', title: 'Done', summary: 'The task is complete.' };
  const created = await client.callTool({ name: 'publish_task_update', arguments: args });
  assert.equal(created.isError, undefined);
  const job = created.structuredContent as { id: string; state: string }; assert.equal(job.state, 'queued');
  const retry = await client.callTool({ name: 'publish_task_update', arguments: args }); assert.equal((retry.structuredContent as Record<string, unknown>)?.id, job.id);
  const cancelled = await client.callTool({ name: 'cancel_projection_request', arguments: { id: job.id } }); assert.equal((cancelled.structuredContent as Record<string, unknown>)?.state, 'cancelled');
  const status = await client.callTool({ name: 'get_projector_status', arguments: {} }); assert.equal((status.structuredContent as Record<string, unknown>)?.projectionVerified, false);
});

test('outbound worker waits for readiness and executes a real agent tool through the canonical canvas once', async t => {
  const f = await httpFixture(t), canvas = canvasFixture();
  const model = new MockLanguageModelV4({ doGenerate: [toolReply('create_timer', { surfaceId: 'tabletop', title: 'Cloud task', durationSeconds: 120, start: false }), textReply('Timer added.')] });
  const agent = createProjectionAgent({ canvas: canvas.port, model });
  const job = f.inbox.submit({ kind: 'creative_prompt', requestId: 'timer', targetId: 'home-studio', prompt: 'Create a two-minute timer on the tabletop without starting it.' });
  let ready = false, deliveries = 0;
  const worker = createProjectionRelayWorker({ url: f.url, token: f.deviceToken, deviceId: 'home-studio', receiptPath: join(f.dir, 'receipts.json'), target: {
    ready: async () => ready, deliver: async delivery => { deliveries++; assert.equal(delivery.targetId, 'home-studio'); const { status, text } = await agent.send(delivery.prompt); return { status, text }; },
  } }); cleanup(t, () => worker.close());
  await worker.pollOnce(); assert.equal(f.inbox.get(job.id).state, 'queued'); assert.equal(deliveries, 0);
  ready = true; await Promise.all([worker.pollOnce(), worker.pollOnce()]);
  assert.equal(deliveries, 1); assert.equal(f.inbox.get(job.id).state, 'complete'); assert.equal(canvas.scene().timers.length, 1);
  await worker.pollOnce(); assert.equal(deliveries, 1); assert.equal(f.inbox.get(job.id).projectionVerified, false);
});

test('worker persists partial outcomes, contains errors and never returns credential diagnostics', async t => {
  const f = await httpFixture(t), statuses: ProjectionRelayStatus[] = [];
  const job = f.inbox.submit(request());
  let deliveries = 0;
  const worker = createProjectionRelayWorker({ url: f.url, token: f.deviceToken, deviceId: 'home-studio', receiptPath: join(f.dir, 'receipts.json'), onStatus: s => statuses.push(s), target: {
    ready: async () => true, deliver: async () => { deliveries++; throw new Error(f.deviceToken); },
  } }); cleanup(t, () => worker.close());
  await worker.pollOnce(); await worker.pollOnce();
  assert.equal(deliveries, 1); assert.equal(f.inbox.get(job.id).state, 'uncertain');
  assert.doesNotMatch(JSON.stringify([statuses, f.inbox.get(job.id)]), new RegExp(f.deviceToken));
});

test('restart retries a saved acknowledgement without executing the agent again', async t => {
  const f = await httpFixture(t), job = f.inbox.submit(request()), lease = f.inbox.claim()!;
  f.inbox.start(job.id, lease.leaseToken);
  const receipt = { status: 'incomplete', text: 'Note created; another part is unavailable.' };
  const receiptPath = join(f.dir, 'receipts.json');
  writeFileSync(receiptPath, JSON.stringify({ version: 1, relay: f.url, deviceId: 'home-studio', pending: { lease, receipt } }));
  let deliveries = 0;
  const worker = createProjectionRelayWorker({ url: f.url, token: f.deviceToken, deviceId: 'home-studio', receiptPath, target: {
    ready: async () => true, deliver: async () => { deliveries++; return { status: 'complete', text: 'Wrong replay' }; },
  } }); cleanup(t, () => worker.close());
  await worker.pollOnce(); assert.equal(deliveries, 0); assert.equal(f.inbox.get(job.id).state, 'incomplete');
  assert.equal(JSON.parse(readFileSync(receiptPath, 'utf8')).pending, null);
});

test('interrupted delivery with no receipt becomes uncertain and never replays', async t => {
  const f = await httpFixture(t), job = f.inbox.submit(request()), lease = f.inbox.claim()!; f.inbox.start(job.id, lease.leaseToken);
  const receiptPath = join(f.dir, 'receipts.json');
  writeFileSync(receiptPath, JSON.stringify({ version: 1, relay: f.url, deviceId: 'home-studio', pending: { lease } }));
  let deliveries = 0;
  const worker = createProjectionRelayWorker({ url: f.url, token: f.deviceToken, deviceId: 'home-studio', receiptPath, target: {
    ready: async () => true, deliver: async () => { deliveries++; return { status: 'complete', text: 'Wrong replay' }; },
  } }); cleanup(t, () => worker.close());
  await worker.pollOnce(); assert.equal(deliveries, 0); assert.equal(f.inbox.get(job.id).state, 'uncertain');
});

test('pause cancels only active delivery, records its result and leaves later jobs queued', async t => {
  const f = await httpFixture(t), job = f.inbox.submit(request()), next = f.inbox.submit(request('next'));
  let begin!: () => void, finish!: () => void, cancels = 0;
  const started = new Promise<void>(resolve => { begin = resolve; });
  const worker = createProjectionRelayWorker({ url: f.url, token: f.deviceToken, deviceId: 'home-studio', receiptPath: join(f.dir, 'receipts.json'), target: {
    ready: async () => true, deliver: async () => { begin(); await new Promise<void>(resolve => { finish = resolve; }); return { status: 'cancelled', text: 'Stopped; accepted changes remain.' }; },
    cancel() { cancels++; finish(); },
  } }); cleanup(t, () => worker.close());
  const pending = worker.pollOnce(); await started; await worker.stop(); await pending;
  assert.equal(cancels, 1); assert.equal(f.inbox.get(job.id).state, 'cancelled'); assert.equal(f.inbox.get(next.id).state, 'queued');
});

test('stdio MCP proxy talks to the same durable inbox without starting a second writer', async t => {
  const f = await httpFixture(t), client = new Client({ name: 'stdio-relay-test', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', 'src/relay/stdio.ts'],
    cwd: process.cwd(), env: { PROJECTION_RELAY_URL: f.url, PROJECTION_RELAY_SUBMIT_TOKEN: f.submitToken }, stderr: 'pipe' });
  await client.connect(transport); cleanup(t, () => client.close());
  const result = await client.callTool({ name: 'request_projection', arguments: { requestId: 'stdio-visual', targetId: 'home-studio', prompt: 'Create a calm starfield on the wall.' } });
  assert.equal(result.isError, false);
  assert.equal(f.inbox.status().counts.queued, 1);
  const online = await client.callTool({ name: 'get_projector_status', arguments: {} }); assert.equal(online.isError, false);
  assert.match(JSON.stringify(online.content), /home-studio/);
});

test('cancellation between claim and start leaves no blocked receipt and permits later jobs', async t => {
  const f = await httpFixture(t), job = f.inbox.submit(request()); let readiness = 0, deliveries = 0;
  const worker = createProjectionRelayWorker({ url: f.url, token: f.deviceToken, deviceId: 'home-studio', receiptPath: join(f.dir, 'receipts.json'), target: {
    ready: async () => { if (++readiness === 2) f.inbox.cancel(job.id); return true; },
    deliver: async () => { deliveries++; return { status: 'complete', text: 'Accepted' }; },
  } }); cleanup(t, () => worker.close());
  await worker.pollOnce(); assert.equal(deliveries, 0); assert.equal(f.inbox.get(job.id).state, 'cancelled');
  const next = f.inbox.submit(request('next')); await worker.pollOnce();
  assert.equal(deliveries, 1); assert.equal(f.inbox.get(next.id).state, 'complete');
});

test('lost HTTP completion response retries only the saved receipt, not the scene edit', async t => {
  const f = await httpFixture(t), job = f.inbox.submit(request());
  const finish = f.inbox.finish; let loseResponse = true, deliveries = 0;
  f.inbox.finish = (...args) => { const result = finish(...args); if (loseResponse) { loseResponse = false; throw new Error('Simulated lost response after durable write'); } return result; };
  const worker = createProjectionRelayWorker({ url: f.url, token: f.deviceToken, deviceId: 'home-studio', receiptPath: join(f.dir, 'receipts.json'), target: {
    ready: async () => true, deliver: async () => { deliveries++; return { status: 'complete', text: 'Note accepted.' }; },
  } }); cleanup(t, () => worker.close());
  await worker.pollOnce(); assert.equal(f.inbox.get(job.id).state, 'complete');
  await worker.pollOnce(); assert.equal(deliveries, 1); assert.equal(JSON.parse(readFileSync(join(f.dir, 'receipts.json'), 'utf8')).pending, null);
});

test('lost HTTP start response never invokes the agent and settles as uncertain', async t => {
  const f = await httpFixture(t), job = f.inbox.submit(request()); const start = f.inbox.start; let deliveries = 0;
  f.inbox.start = (...args) => { start(...args); throw new Error('Simulated lost start response'); };
  const worker = createProjectionRelayWorker({ url: f.url, token: f.deviceToken, deviceId: 'home-studio', receiptPath: join(f.dir, 'receipts.json'), target: {
    ready: async () => true, deliver: async () => { deliveries++; return { status: 'complete', text: 'Must not execute' }; },
  } }); cleanup(t, () => worker.close());
  await worker.pollOnce(); assert.equal(f.inbox.get(job.id).state, 'running');
  await worker.pollOnce(); assert.equal(deliveries, 0); assert.equal(f.inbox.get(job.id).state, 'uncertain');
});
