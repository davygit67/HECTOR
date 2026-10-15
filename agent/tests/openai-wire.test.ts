import assert from 'node:assert/strict';
import test from 'node:test';
import { createOpenAI } from '@ai-sdk/openai';
import { createProjectionAgent } from '../src/projection-agent.js';
import { canvasFixture } from './canvas-fixture.js';

test('direct OpenAI Responses adapter sends strict surface tools and receives canvas results (mock HTTP)', async () => {
  const requests: { url: string; body: Record<string, any> }[] = [];
  const provider = createOpenAI({ apiKey: 'offline-test-key', fetch: async (url, init) => {
    const body = JSON.parse(String(init?.body));
    requests.push({ url: String(url), body });
    const output = requests.length === 1
      ? [{ type: 'function_call', id: 'fc-1', call_id: 'call-1', name: 'create_timer',
          arguments: JSON.stringify({ surfaceId: 'tabletop', title: 'Pasta', durationSeconds: 300, start: true }) }]
      : [{ type: 'message', id: 'msg-2', role: 'assistant', content: [{ type: 'output_text', text: 'Started.', annotations: [] }] }];
    return new Response(JSON.stringify({ id: `resp-${requests.length}`, model: 'gpt-5.4-mini', output,
      usage: { input_tokens: 30, output_tokens: 10, total_tokens: 40 } }), { headers: { 'content-type': 'application/json' } });
  } });
  const fixture = canvasFixture();
  const result = await createProjectionAgent({ canvas: fixture.port, model: provider.responses('gpt-5.4-mini') }).send('Start pasta timer.');
  assert.equal(result.text, 'Timer "Pasta" on Tabletop: running; set for 300 seconds.');
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, 'https://api.openai.com/v1/responses');
  assert.equal(requests[0].body.store, false);
  assert.equal(requests[0].body.parallel_tool_calls, false);
  const timer = requests[0].body.tools.find((item: { name: string }) => item.name === 'create_timer');
  assert.equal(timer.strict, true);
  assert.deepEqual(timer.parameters.properties.surfaceId.enum, ['tabletop', 'wall']);
  assert.equal(requests[0].body.tools.length, 17);
  assert.equal(requests[0].body.tools.some((item: { name: string }) => item.name === 'set_effect'), false);
  function assertStrictObjects(schema: Record<string, any>) {
    assert.equal('oneOf' in schema, false);
    if (schema.type === 'object') {
      assert.equal(schema.additionalProperties, false);
      assert.deepEqual([...(schema.required ?? [])].sort(), Object.keys(schema.properties).sort());
      Object.values(schema.properties).forEach(value => assertStrictObjects(value as Record<string, any>));
    }
    if (schema.items) assertStrictObjects(schema.items);
    for (const option of schema.anyOf ?? []) assertStrictObjects(option);
  }
  for (const item of requests[0].body.tools) {
    assert.equal(item.parameters.type, 'object');
    assert.equal(item.strict, true);
    assertStrictObjects(item.parameters);
  }
  const update = requests[0].body.tools.find((item: { name: string }) => item.name === 'update_content');
  assert.match(JSON.stringify(update.parameters), /"recipe"/);
  assert.match(JSON.stringify(update.parameters), /"youtube"/);
  assert.match(JSON.stringify(update.parameters), /"null"/);
  const receipt = requests[1].body.input.find((item: { type: string }) => item.type === 'function_call_output');
  assert.equal(JSON.parse(receipt.output).timer.status, 'running');
  assert.equal(fixture.scene().timers[0].deadline, 301000);
});
