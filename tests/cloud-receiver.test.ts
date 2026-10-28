import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCloudReceiver, type CloudReceiverLoader } from '../host/cloud-receiver';
import { createChatController } from '../host/chat-controller';
import { initialScene, reduceScene } from '../src/shared/domain';
import type { ChatOutcome } from '../src/shared/chat';
import type { ProjectionDelivery, ProjectionDeliveryReceipt, ProjectionRelayWorkerOptions } from '../agent/src/relay/types';
import { createProjectionRelayWorker } from '../agent/src/relay/worker';
import { createProjectionRelayServer } from '../agent/src/relay/server';
import { createProjectionInbox } from '../agent/src/relay/inbox';

const config = { url: 'https://relay.example.test', token: 'private-test-credential-'.repeat(3), deviceId: 'test-room' };
const job = (overrides: Partial<ProjectionDelivery> = {}): ProjectionDelivery => ({ id: randomUUID(), targetId: config.deviceId, kind: 'creative_prompt', prompt: 'Create a note', createdAt: Date.now(), expiresAt: Date.now() + 60000, ...overrides });
const done: ChatOutcome = { status: 'complete', text: 'A note was created.' };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => resolve = r); return { resolve, promise }; }
const tick = () => new Promise<void>(r => setTimeout(r, 1));
function fixture(t: TestContext) {
  const workers: { options: ProjectionRelayWorkerOptions; starts: number; stops: number; closes: number; deliver(job: ProjectionDelivery): Promise<ProjectionDeliveryReceipt> }[] = [];
  const load: CloudReceiverLoader = async () => ({ config, createWorker(options) {
    let active: Promise<ProjectionDeliveryReceipt> | undefined;
    const record = { options, starts: 0, stops: 0, closes: 0, deliver(value: ProjectionDelivery) { return active = options.target.deliver(value).finally(() => { active = undefined; }); } };
    workers.push(record);
    return { start() { record.starts++; }, async stop() { record.stops++; await active; }, async close() { record.closes++; }, async pollOnce() {} };
  } });
  const receiver = createCloudReceiver(load, '/private/test-data');
  t.after(() => receiver.dispose());
  return { receiver, workers, load };
}

test('cloud receiver defaults off; checking setup creates no worker and never invokes an agent', async t => {
  let calls = 0;
  const { receiver, workers } = fixture(t);
  receiver.register('tab-a', { ready: () => true, deliver: async () => { calls++; return done; }, cancel() {} });
  const state = await receiver.request('tab-a', 'state');
  assert.equal(state.configured, true); assert.equal(state.receiving, false); assert.equal(state.ownsTarget, false);
  assert.equal(workers.length, 0); assert.equal(calls, 0);
  const unconfigured = createCloudReceiver(async () => null, '/private/test-data');
  t.after(() => unconfigured.dispose());
  unconfigured.register('tab', { ready: () => true, deliver: async () => done, cancel() {} });
  assert.equal((await unconfigured.request('tab', 'state')).configured, false);
  await assert.rejects(unconfigured.request('tab', 'receive'), /Configure/);
});

test('explicit single-tab ownership, pause/resume/release and private credential boundary', async t => {
  const { receiver, workers } = fixture(t); let ready = true;
  for (const id of ['a', 'b']) receiver.register(id, { ready: () => ready, deliver: async () => done, cancel() {} });
  assert.equal((await receiver.request('a', 'receive')).receiving, true);
  assert.equal(await workers[0].options.target.ready(), true);
  assert.equal((await receiver.request('b', 'state')).claimedElsewhere, true);
  await assert.rejects(receiver.request('b', 'receive'), /Another Studio/);
  await assert.rejects(receiver.request('b', 'pause'), /Only/);
  await assert.rejects(receiver.request('b', 'release'), /Only/);
  assert.match(workers[0].options.receiptPath, /cloud-receipts\/[a-f0-9]{24}\.json$/);
  assert.doesNotMatch(JSON.stringify(receiver.view('a')), /private-test|relay\.example/);
  ready = false; assert.equal(await workers[0].options.target.ready(), false);
  await receiver.request('a', 'pause'); await tick();
  assert.equal(receiver.view('a').ownsTarget, true); assert.equal(receiver.view('a').receiving, false);
  await receiver.request('a', 'receive'); assert.equal(workers.length, 1);
  await receiver.request('a', 'release'); await tick();
  assert.equal(workers[0].closes, 1);
  await receiver.request('b', 'receive'); assert.equal(workers.length, 2);
});

test('claimed cloud delivery waits for manual chat then reuses the same conversation', async t => {
  const { receiver, workers } = fixture(t), manual = deferred<ChatOutcome>(), manualStarted = deferred<void>();
  let sessions = 0, sends = 0, cancels = 0;
  const chat = createChatController({ getSnapshot: async () => ({ scene: initialScene() } as never), dispatch: async () => ({ ok: true, scene: initialScene() }) }, async () => {
    sessions++;
    return { busy: false, clear() {}, cancel() { cancels++; }, async send() { sends++; if (sends === 1) { manualStarted.resolve(); return manual.promise; } return done; } };
  }, () => {});
  t.after(() => chat.dispose()); await chat.getState();
  receiver.register('a', { ready: () => chat.currentState().ready && !chat.currentState().busy, deliver: prompt => chat.send(prompt, 'cloud'), cancel: () => chat.cancel() });
  await receiver.request('a', 'receive');
  const local = chat.send('Manual request'); await manualStarted.promise;
  const cloud = workers[0].deliver(job());
  await tick(); assert.equal(sends, 1); assert.equal(receiver.view('a').busy, true);
  manual.resolve(done); await local;
  assert.deepEqual(await cloud, done); assert.equal(sends, 2); assert.equal(sessions, 1); assert.equal(cancels, 0);
  const messages = (await chat.getState()).messages;
  assert.equal(messages[0].source, undefined); assert.equal(messages[2].source, 'cloud');
  assert.deepEqual(receiver.view('a').lastReceipt?.text, done.text);
});

test('pausing while cloud waits never cancels manual chat', async t => {
  const { receiver, workers } = fixture(t); let ready = true, calls = 0, cancels = 0;
  receiver.register('a', { ready: () => ready, deliver: async () => { calls++; return done; }, cancel() { cancels++; } });
  await receiver.request('a', 'receive'); ready = false;
  const pending = workers[0].deliver(job());
  await receiver.request('a', 'pause');
  assert.equal((await pending).status, 'cancelled'); assert.equal(calls, 0); assert.equal(cancels, 0);
  await tick(); assert.equal(receiver.view('a').receiving, false);
});

test('pausing an active cloud request cancels once and cannot report a late success', async t => {
  const { receiver, workers } = fixture(t), result = deferred<ChatOutcome>(); let cancels = 0;
  receiver.register('a', { ready: () => true, deliver: () => result.promise, cancel() { cancels++; } });
  await receiver.request('a', 'receive'); const pending = workers[0].deliver(job());
  await receiver.request('a', 'pause'); workers[0].options.target.cancel?.();
  assert.equal(cancels, 1); assert.equal(receiver.view('a').busy, true);
  await assert.rejects(receiver.request('a', 'receive'), /Wait/);
  result.resolve(done); assert.equal((await pending).status, 'cancelled');
  await tick(); assert.equal(receiver.view('a').busy, false); assert.equal(receiver.view('a').lastReceipt?.status, 'cancelled');
});

test('release/disconnect retires the exact target; it never dispatches to another tab', async t => {
  const { receiver, workers } = fixture(t); let ready = true, calls = 0;
  const unregister = receiver.register('a', { ready: () => ready, deliver: async () => { calls++; return done; }, cancel() {} });
  receiver.register('b', { ready: () => true, deliver: async () => { calls++; return done; }, cancel() {} });
  await receiver.request('a', 'receive'); ready = false;
  const pending = workers[0].deliver(job()); unregister();
  assert.equal((await pending).status, 'cancelled'); await tick(); assert.equal(calls, 0);
  assert.equal(receiver.view('b').receiving, false); assert.equal(receiver.view('b').claimedElsewhere, false);
  receiver.register('a', { ready: () => true, deliver: async () => done, cancel() {} });
  unregister(); // A stale unsubscribe must not remove the replacement registration.
  assert.equal((await receiver.request('a', 'state')).receiving, false);
});

test('receive that crosses an asynchronous reload cannot bind the replacement window', async t => {
  const loaded = deferred<Awaited<ReturnType<CloudReceiverLoader>>>(), { load } = fixture(t);
  const receiver = createCloudReceiver(() => loaded.promise, '/private/test-data'); t.after(() => receiver.dispose());
  const target = () => ({ ready: () => true, deliver: async () => done, cancel() {} });
  const release = receiver.register('desktop', target()); const pending = receiver.request('desktop', 'receive');
  release(); receiver.register('desktop', target()); loaded.resolve(await load());
  await assert.rejects(pending, /disconnected/); assert.equal(receiver.view('desktop').ownsTarget, false);
});

test('expiry and wrong-device claims never invoke the local agent', async t => {
  const { receiver, workers } = fixture(t); let calls = 0;
  receiver.register('a', { ready: () => true, deliver: async () => { calls++; return done; }, cancel() {} });
  await receiver.request('a', 'receive');
  for (const value of [job({ targetId: 'another-room' }), job({ expiresAt: Date.now() - 1 })]) assert.equal((await workers[0].deliver(value)).status, 'failed');
  assert.equal(calls, 0);
});

test('manual-chat wait has a monotonic 30-second cap even with a long delivery TTL', async t => {
  const { receiver, workers } = fixture(t); let ready = true, calls = 0, clock = 0;
  t.mock.method(performance, 'now', () => clock);
  receiver.register('a', { ready: () => ready, deliver: async () => { calls++; return done; }, cancel() {} });
  await receiver.request('a', 'receive'); ready = false;
  const pending = workers[0].deliver(job({ expiresAt: Date.now() + 86400000 })); clock = 30001;
  const result = await pending;
  assert.equal(result.status, 'incomplete'); assert.match(result.text, /30 seconds/); assert.equal(calls, 0);
});

test('unconfirmed delivery is uncertain and setup/worker failures never expose their raw details', async t => {
  const { receiver, workers } = fixture(t);
  receiver.register('a', { ready: () => true, deliver: async () => { throw new Error('secret runtime details'); }, cancel() {} });
  await receiver.request('a', 'receive');
  assert.equal((await workers[0].deliver(job())).status, 'uncertain');
  workers[0].options.onStatus?.({ phase: 'error', message: config.token });
  assert.doesNotMatch(JSON.stringify(receiver.view('a')), /private-test|secret runtime/);
  for (const where of ['load', 'create', 'start']) {
    const broken = createCloudReceiver(async () => {
      if (where === 'load') throw new Error(config.token);
      return { config, createWorker() { if (where === 'create') throw new Error(config.token);
        return { start() { throw new Error(config.token); }, async stop() {}, async close() {}, async pollOnce() {} };
      } };
    }, '/private/test-data'); t.after(() => broken.dispose());
    broken.register('a', { ready: () => true, deliver: async () => done, cancel() {} });
    await assert.rejects(broken.request('a', 'receive'), error => !String(error).includes(config.token));
    assert.doesNotMatch(JSON.stringify(broken.view('a')), /private-test/); assert.equal(broken.view('a').receiving, false);
  }
});

test('real loopback inbox and worker deliver through the host chat and canonical scene exactly once on duplicate submission', async t => {
  const cleanups: (() => unknown | Promise<unknown>)[] = [];
  t.after(async () => { for (const cleanup of cleanups.reverse()) await cleanup(); });
  const dir = mkdtempSync(join(tmpdir(), 'projection-host-relay-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const inbox = createProjectionInbox({ path: join(dir, 'inbox.json'), targetId: config.deviceId }); cleanups.push(() => inbox.close());
  const submitToken = randomBytes(32).toString('hex'), deviceToken = randomBytes(32).toString('hex'), allowedHosts: string[] = ['localhost'];
  const server = createProjectionRelayServer({ inbox, submitToken, deviceToken, allowedHosts });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  cleanups.push(() => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }));
  const port = (server.address() as { port: number }).port, url = 'http://127.0.0.1:' + port; allowedHosts.push('127.0.0.1:' + port);
  let scene = initialScene(), calls = 0, constructions = 0;
  const chat = createChatController({ getSnapshot: async () => ({ scene } as never), dispatch: async command => { scene = reduceScene(scene, command); return { ok: true, scene }; } }, async canvas => {
    constructions++;
    return { busy: false, clear() {}, cancel() {}, async send() { calls++;
      await canvas.dispatch({ type: 'content.create', id: 'cloud-note', title: 'Cloud update', surfaceId: 'tabletop', spec: { kind: 'note', config: { text: 'The report is ready.', accent: '#88ccaa' } } });
      return done;
    } };
  }, () => {});
  cleanups.push(() => chat.dispose());
  await chat.getState();
  let worker!: ReturnType<typeof createProjectionRelayWorker>;
  const receiver = createCloudReceiver(async () => ({ config: { url, token: deviceToken, deviceId: config.deviceId }, createWorker: options => worker = createProjectionRelayWorker(options) }), join(dir, 'device'));
  cleanups.push(() => receiver.dispose());
  receiver.register('chosen', { ready: () => chat.currentState().ready && !chat.currentState().busy, deliver: prompt => chat.send(prompt, 'cloud'), cancel: () => chat.cancel() });
  const submission = { kind: 'task_update' as const, requestId: 'host-integration', targetId: config.deviceId, title: 'Finished', summary: 'The report is ready.' };
  const post = () => fetch(url + '/jobs', { method: 'POST', headers: { Authorization: 'Bearer ' + submitToken, 'Content-Type': 'application/json' }, body: JSON.stringify(submission) });
  const response = await post(); assert.equal(response.ok, true); const accepted = await response.json() as { id: string };
  assert.equal(inbox.get(accepted.id).state, 'queued'); assert.equal(calls, 0);
  await receiver.request('chosen', 'receive'); await worker.pollOnce();
  assert.equal(inbox.get(accepted.id).state, 'complete'); assert.equal(inbox.get(accepted.id).projectionVerified, false);
  const duplicate = await post(); await duplicate.body?.cancel(); await worker.pollOnce();
  assert.equal(calls, 1); assert.equal(constructions, 1); assert.equal(scene.contents.length, 1);
  assert.equal((await chat.getState()).messages[0].source, 'cloud'); assert.equal(receiver.view('chosen').lastReceipt?.status, 'complete');
});
