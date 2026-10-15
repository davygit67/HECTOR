import test from 'node:test';
import assert from 'node:assert/strict';
import { recoverBrowserChat, LOCAL_HOST_STOPPED } from '../src/chatRecovery';
import type { ChatState } from '../src/shared/chat';
const ready: ChatState = { ready: true, busy: false, configurationError: null, progress: null, messages: [] };

test('reconnect obtains a fresh page/socket when the host is back instead of retrying a dead connection', async () => {
  let reloads = 0, requests = 0;
  const result = await recoverBrowserChat(false, { probe: async () => true, resume: async () => { requests++; return ready; }, reload: () => reloads++ });
  assert.equal(result, null); assert.equal(reloads, 1); assert.equal(requests, 0);
});
test('reconnect to a stopped host preserves the loaded canvas and gives launch instructions', async () => {
  let reloads = 0;
  for (const probe of [async () => false, async () => { throw new Error('Network failure'); }]) {
    await assert.rejects(recoverBrowserChat(false, { probe, resume: async () => { assert.fail('No socket requests while disconnected'); }, reload: () => reloads++ }), { message: LOCAL_HOST_STOPPED });
  }
  assert.equal(reloads, 0);
});
test('reconnect re-establishes the studio handshake on a live connection without discarding the conversation', async () => {
  const state = { ...ready, messages: [{ id: '1', role: 'assistant' as const, text: 'Previous reply' }] };
  const result = await recoverBrowserChat(true, {
    probe: async () => { assert.fail('Live connections do not need a reload probe'); },
    resume: async () => state, reload: () => assert.fail('Do not discard a live conversation'),
  });
  assert.deepEqual(result, state);
});
