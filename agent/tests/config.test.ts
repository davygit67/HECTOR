import assert from 'node:assert/strict';
import test from 'node:test';
import { createOpenAIModel, DEFAULT_MODEL, readAgentConfig } from '../src/config.js';

test('OpenAI configuration requires a local key and never echoes it in validation errors', () => {
  assert.throws(() => readAgentConfig({}), /Set OPENAI_API_KEY/);
  assert.throws(() => readAgentConfig({ OPENAI_API_KEY: 'replace-me' }), /Set OPENAI_API_KEY/);
  const config = readAgentConfig({ OPENAI_API_KEY: 'test-secret' });
  assert.equal(config.model, DEFAULT_MODEL);
  assert.equal(config.programMaxOutputTokens, 6000);
  assert.equal(config.programReasoningEffort, 'medium');
  assert.throws(() => readAgentConfig({ OPENAI_API_KEY: 'test-secret', AGENT_PROGRAM_REASONING_EFFORT: 'unlimited' }), /AGENT_PROGRAM_REASONING_EFFORT/);
  const model = createOpenAIModel(config);
  assert.equal(model.provider, 'openai.responses');
  assert.equal(model.modelId, DEFAULT_MODEL);
  assert.throws(() => readAgentConfig({ OPENAI_API_KEY: 'test-secret', AGENT_MAX_STEPS: 'unbounded' }), error => {
    assert.equal(String(error).includes('test-secret'), false);
    return /AGENT_MAX_STEPS/.test(String(error));
  });
});

test('model and request limits can be configured without source changes', () => {
  const config = readAgentConfig({ OPENAI_API_KEY: 'test', OPENAI_MODEL: 'selected-model',
    AGENT_MAX_STEPS: '3', AGENT_MAX_OUTPUT_TOKENS: '600', AGENT_PROGRAM_MAX_OUTPUT_TOKENS: '2400', AGENT_PROGRAM_REASONING_EFFORT: 'low', AGENT_TIMEOUT_MS: '3000', AGENT_HISTORY_TURNS: '2' });
  assert.equal(config.model, 'selected-model');
  assert.equal(config.maxSteps, 3);
  assert.equal(config.maxOutputTokens, 600);
  assert.equal(config.programMaxOutputTokens, 2400);
  assert.equal(config.programReasoningEffort, 'low');
  assert.equal(config.timeoutMs, 3000);
  assert.equal(config.historyTurns, 2);
});
