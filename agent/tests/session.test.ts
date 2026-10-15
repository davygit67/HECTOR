import assert from 'node:assert/strict';
import test from 'node:test';
import { tool } from 'ai';
import { z } from 'zod';
import { AgentTurnError, createAgentSession } from '../src/session.js';
import { MockLanguageModelV4, textReply, toolReply } from './model.js';

test('SDK loop executes a tool, refreshes context, and returns usage and receipts', async () => {
  let value = 0;
  const model = new MockLanguageModelV4({ doGenerate: [toolReply('set_value', { value: 7 }), textReply('Changed.')] });
  const events: string[] = [];
  const session = createAgentSession({ model, bindTurn: async () => ({
    tools: { set_value: tool({ inputSchema: z.object({ value: z.number() }), execute: async input => { value = input.value; return { value }; } }) },
    instructions: async () => `Current value: ${value}`,
  }) });
  const result = await session.send('Set seven', { onEvent: event => { events.push(event.type); } });
  assert.equal(value, 7);
  assert.equal(result.text, 'Changed.');
  assert.equal(result.steps, 2);
  assert.equal(result.usage.totalTokens, 30);
  assert.deepEqual(result.tools[0]?.output, { value: 7 });
  assert.deepEqual(events, ['tool-start', 'tool-end']);
  assert.match(JSON.stringify(model.doGenerateCalls[1].prompt), /Current value: 7/);
  assert.deepEqual(model.doGenerateCalls[0].providerOptions, { openai: { store: false, parallelToolCalls: false } });
});

test('history retains follow-up context and trims complete turns', async () => {
  const model = new MockLanguageModelV4({ doGenerate: [textReply('First.'), textReply('Second.'), textReply('Third.')] });
  const session = createAgentSession({ model, historyTurns: 1, bindTurn: async () => ({ tools: {}, instructions: async () => 'Context' }) });
  await session.send('alpha');
  await session.send('beta');
  assert.match(JSON.stringify(model.doGenerateCalls[1].prompt), /alpha/);
  await session.send('gamma');
  assert.doesNotMatch(JSON.stringify(model.doGenerateCalls[2].prompt), /alpha/);
  assert.match(JSON.stringify(model.doGenerateCalls[2].prompt), /beta/);
});

test('loop limit stops a model that continually calls tools', async () => {
  let count = 0;
  const model = new MockLanguageModelV4({ doGenerate: async () => toolReply('count', {}, `call-${count}`) });
  const session = createAgentSession({ model, maxSteps: 2, bindTurn: async () => ({
    tools: { count: tool({ inputSchema: z.object({}), execute: async () => ({ count: ++count }) }) },
    instructions: async () => 'Count',
  }) });
  const result = await session.send('Count');
  assert.equal(result.steps, 2);
  assert.equal(count, 2);
  assert.equal(result.finishReason, 'tool-calls');
  assert.equal(result.status, 'incomplete');
  assert.ok(result.text.length > 0);
});

test('cancellation releases the session, and concurrent requests cannot race', async () => {
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const model = new MockLanguageModelV4({ doGenerate: async options => {
    started();
    await new Promise<void>((_resolve, reject) => options.abortSignal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    return textReply('unreachable');
  } });
  const session = createAgentSession({ model, bindTurn: async () => ({ tools: {}, instructions: async () => 'Context' }) });
  const pending = session.send('wait');
  await ready;
  assert.equal(session.busy, true);
  await assert.rejects(session.send('second'), /already running/);
  assert.throws(() => session.clear(), /current request/);
  session.cancel();
  await assert.rejects(pending, error => error instanceof AgentTurnError && error.code === 'cancelled');
  assert.equal(session.busy, false);
  session.clear();
});

test('a failed later model step keeps completed tool history without replaying actions', async () => {
  let calls = 0;
  let edits = 0;
  const model = new MockLanguageModelV4({ doGenerate: async () => {
    calls++;
    if (calls === 1) return toolReply('edit', {});
    if (calls === 2) throw new Error('Provider unavailable with sensitive diagnostics');
    return textReply('There was one edit.');
  } });
  const session = createAgentSession({ model, bindTurn: async () => ({
    tools: { edit: tool({ inputSchema: z.object({}), execute: async () => ({ edits: ++edits }) }) },
    instructions: async () => `edits=${edits}`,
  }) });
  await assert.rejects(session.send('edit'), error => error instanceof AgentTurnError && !error.message.includes('sensitive'));
  assert.equal(edits, 1);
  await session.send('What happened?');
  const prompt = JSON.stringify(model.doGenerateCalls.at(-1)?.prompt);
  assert.match(prompt, /tool-result/);
  assert.match(prompt, /interrupted/);
  assert.equal(edits, 1);
});

test('an already-cancelled request and invalid input make no model calls', async () => {
  const model = new MockLanguageModelV4();
  const session = createAgentSession({ model, bindTurn: async () => ({ tools: {}, instructions: async () => '' }) });
  await assert.rejects(session.send(''), /8000/);
  await assert.rejects(session.send('cancelled', { signal: AbortSignal.abort() }), AgentTurnError);
  assert.equal(model.doGenerateCalls.length, 0);
});

test('cancellation also interrupts a stalled host snapshot before model execution', async () => {
  const model = new MockLanguageModelV4();
  const session = createAgentSession({ model, bindTurn: () => new Promise(() => {}) });
  const pending = session.send('inspect');
  session.cancel();
  await assert.rejects(pending, AgentTurnError);
  assert.equal(session.busy, false);
  assert.equal(model.doGenerateCalls.length, 0);
});
