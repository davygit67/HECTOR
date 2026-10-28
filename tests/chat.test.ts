import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createChatController, type AgentSession, type AgentCanvas } from '../host/chat-controller';
import { createCanvasRpc } from '../host/canvas-rpc';
import { AGENT_COMMAND_TYPES } from '../agent/src/commands';
import { CHAT_COMMAND_TYPES, isChatCommand, type CanvasRpc, type ChatState } from '../src/shared/chat';
import { initialScene, reduceScene } from '../src/shared/domain';
import type { Bridge } from '../src/shared/bridge';

function room() {
  let scene = initialScene();
  const port: Pick<Bridge, 'getSnapshot' | 'dispatch'> = {
    getSnapshot: async () => ({ scene: structuredClone(scene), saveStatus: 'saved', saveError: null, storage: 'browser', displays: [], output: { open: false, fullscreen: false, displayId: null } }),
    dispatch: async command => {
      try { scene = reduceScene(scene, command, 1000); return { ok: true, scene: structuredClone(scene) }; }
      catch (error) { return { ok: false, error: String(error) }; }
    },
  };
  return { port, scene: () => scene };
}
test('chat transport allowlist matches the SDK and excludes gameplay injection and retired effects', () => {
  assert.deepEqual([...CHAT_COMMAND_TYPES].sort(), [...AGENT_COMMAND_TYPES].sort());
  assert.equal(isChatCommand({ type: 'game.hit' }), false);
  assert.equal(isChatCommand({ type: 'surface.move' }), true);
  assert.equal(isChatCommand({ type: 'effect.set' }), false);
  assert.equal(isChatCommand(null), false);
  assert.equal(isChatCommand({ type: 'content.create' }), true); // Payload still requires the reducer.
});
test('setup failure is visible, redacted, and does not alter the room', async () => {
  const r = room(), before = r.scene();
  const chat = createChatController(r.port, async () => { throw new Error('provider secret value'); }, () => {});
  const state = await chat.getState();
  assert.equal(state.ready, false); assert.match(state.configurationError!, /local AI host/);
  assert.doesNotMatch(JSON.stringify(state), /secret value/); assert.equal(r.scene(), before);
});
test('conversation reuses its agent and reducer; clear preserves applied content', async () => {
  const r = room(); let creations = 0, cleared = 0; const events: ChatState[] = [];
  const chat = createChatController(r.port, async port => {
    creations++;
    return { busy: false, cancel() {}, clear() { cleared++; },
      async send(prompt, options) {
        options?.onEvent?.({ type: 'tool-start', toolName: 'create_note' });
        const before = await port.getSnapshot();
        const receipt = await port.dispatch(before.scene.contents.length
          ? { type: 'content.update', id: 'chat-note', spec: { kind: 'note', config: { text: prompt, accent: '#556677' } } }
          : { type: 'content.create', id: 'chat-note', title: 'Chat note', surfaceId: 'tabletop', spec: { kind: 'note', config: { text: prompt, accent: '#556677' } } });
        assert.equal(receipt.ok, true); return { text: 'Updated.', status: 'complete' };
      },
    };
  }, state => events.push(state));
  await chat.getState(); await chat.send('First'); await chat.send('Second');
  assert.equal(creations, 1); assert.equal(r.scene().contents.length, 1);
  const note = r.scene().contents[0]; assert.equal(note.kind === 'note' && note.config.text, 'Second');
  assert.equal((await chat.getState()).messages.length, 4); assert.ok(events.some(s => s.progress?.includes('create note')));
  chat.clear(); assert.equal(cleared, 1); assert.equal((await chat.getState()).messages.length, 0); assert.equal(r.scene().contents.length, 1);
});
test('cancel stops a turn, refuses overlap, retains applied edits, and suppresses a late success', async () => {
  const r = room(); let finish!: (result: { text: string; status: 'complete' }) => void;
  let started!: () => void; const running = new Promise<void>(resolve => started = resolve); let cancels = 0;
  const chat = createChatController(r.port, async port => ({
    busy: false, cancel() { cancels++; }, clear() {},
    async send() {
      await port.dispatch({ type: 'timer.create', id: 'started', surfaceId: 'tabletop', title: 'Started', durationMs: 300000 });
      started(); return new Promise(resolve => finish = resolve);
    },
  }), () => {});
  const turn = chat.send('Create a timer'); await running;
  await assert.rejects(chat.send('Concurrent request'), /already running/);
  assert.throws(() => chat.clear(), /Stop/);
  chat.cancel(); finish({ text: 'Late success', status: 'complete' }); await turn;
  const state = await chat.getState(); assert.equal(cancels, 1); assert.equal(state.busy, false);
  assert.equal(state.messages.at(-1)?.status, 'cancelled'); assert.equal(r.scene().timers.length, 1);
  assert.equal(state.messages.some(m => m.text === 'Late success'), false);
});
test('chat rejects empty/oversize input and a disposed controller emits nothing', async () => {
  let emissions = 0;
  const chat = createChatController(room().port, async () => ({ busy: false, cancel() {}, clear() {}, send: async () => ({ text: 'OK', status: 'complete' }) } satisfies AgentSession), () => emissions++);
  await assert.rejects(chat.send('  '), /between/); await assert.rejects(chat.send('a'.repeat(8001)), /between/);
  chat.dispose(); await assert.rejects(chat.send('hello'), /disconnected/); assert.equal(emissions, 0);
});
test('RPC receipts bind to the connection and ID; duplicate or unknown replies have no effect', async () => {
  const requests: CanvasRpc[] = [], a = createCanvasRpc(r => requests.push(r)), b = createCanvasRpc(() => {});
  const result = a.request({ operation: 'snapshot' }); const id = requests[0].id;
  b.receive({ id, value: 'other-client' }); a.receive({ id: 'wrong', value: 'wrong-id' });
  a.receive({ id, value: 'correct' }); a.receive({ id, value: 'duplicate' });
  assert.equal(await result, 'correct'); a.close(); b.close();
});
test('RPC times out without replaying and disconnect rejects pending requests', async () => {
  let sends = 0; const timed = createCanvasRpc(() => sends++, 5);
  await assert.rejects(timed.request({ operation: 'snapshot' }), /may already be applied/); assert.equal(sends, 1); timed.close();
  const closed = createCanvasRpc(() => sends++);
  const request = closed.request({ operation: 'snapshot' }); closed.close();
  await assert.rejects(request, /disconnected/); await assert.rejects(closed.request({ operation: 'snapshot' }), /disconnected/);
  assert.equal(sends, 2);
});
test('a lost dispatch receipt cancels the turn and prevents SDK error recovery from issuing another edit', async () => {
  let chat: ReturnType<typeof createChatController>, dispatches = 0, cancels = 0;
  const rpc = createCanvasRpc(() => { dispatches++; }, 5, () => chat.cancel());
  chat = createChatController({ getSnapshot: room().port.getSnapshot, dispatch: command => rpc.request({ operation: 'dispatch', command }) }, async port => ({
    busy: false, clear() {}, cancel() { cancels++; },
    async send() {
      const command = { type: 'timer.create' as const, id: 'first', title: 'First', surfaceId: 'tabletop', durationMs: 300000 };
      await assert.rejects(port.dispatch(command), /may already be applied/);
      // Simulate a model/SDK attempting to recover after seeing its tool error.
      await assert.rejects(port.dispatch({ ...command, id: 'retry' }), /Request stopped/);
      return { text: 'Late completion', status: 'complete' };
    },
  }), () => {});
  await chat.send('Make a timer'); assert.equal(dispatches, 1); assert.equal(cancels, 1);
  assert.equal((await chat.getState()).messages.at(-1)?.status, 'cancelled');
  rpc.close(); chat.dispose();
});
test('chat exposes synchronous readiness/busy and exact safe outcomes for cloud delivery', async () => {
  const r = room(); let calls = 0;
  const chat = createChatController(r.port, async () => ({ busy: false, clear() {}, cancel() {}, async send() {
    if (++calls === 2) throw new Error('provider credential details');
    return { status: 'incomplete', text: 'A note was added; the requested movie remains unsupported.' };
  } }), () => {});
  assert.deepEqual(chat.currentState(), { ready: false, busy: false });
  await chat.getState(); assert.deepEqual(chat.currentState(), { ready: true, busy: false });
  const first = chat.send('Cloud request', 'cloud'); assert.equal(chat.currentState().busy, true);
  assert.deepEqual(await first, { status: 'incomplete', text: 'A note was added; the requested movie remains unsupported.' });
  const failure = await chat.send('Another request', 'cloud');
  assert.equal(failure.status, 'incomplete'); assert.doesNotMatch(failure.text, /credential/);
  chat.dispose(); assert.equal(chat.currentState().ready, false);
});
test('mapping observation forwards through the guarded agent port only during an active uncancelled turn', async () => {
  const r = room(); let bound!: AgentCanvas, observed = 0;
  const request = { surfaceId: 'tabletop' }, observation = { marker: 'paired camera and depth' };
  const chat = createChatController({ ...r.port, studio: {
    inspect: async () => ({} as never), observe: async () => ({} as never), execute: async () => ({} as never),
    observeMapping: async value => { assert.deepEqual(value, request); observed++; return observation as never; },
  } }, async port => {
    bound = port;
    return { busy: false, clear() {}, cancel() {}, async send() {
      assert.equal(await port.studio!.observeMapping!(request as never), observation);
      chat.cancel(); assert.throws(() => port.studio!.observeMapping!(request as never), /stopped/);
      return { status: 'complete', text: 'Late success' };
    } };
  }, () => {});
  await chat.getState(); assert.throws(() => bound.studio!.observeMapping!(request as never), /stopped/);
  assert.equal((await chat.send('Inspect object')).status, 'cancelled'); assert.equal(observed, 1);
  chat.dispose(); assert.throws(() => bound.studio!.observeMapping!(request as never), /stopped/);
});
