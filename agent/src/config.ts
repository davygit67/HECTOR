import { createOpenAI } from '@ai-sdk/openai';

export const DEFAULT_MODEL = 'gpt-5.4-mini';

export interface AgentConfig {
  apiKey: string;
  model: string;
  maxSteps: number;
  maxOutputTokens: number;
  timeoutMs: number;
  historyTurns: number;
}

function integer(env: NodeJS.ProcessEnv, key: string, fallback: number, min: number, max: number): number {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${key} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

/** Call in Electron main or a trusted Node process, never in a browser bundle. */
export function readAgentConfig(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey || apiKey === 'replace-me') {
    throw new Error('Set OPENAI_API_KEY in agent/.env or the host process environment. Do not paste it into chat.');
  }
  return {
    apiKey,
    model: env.OPENAI_MODEL?.trim() || DEFAULT_MODEL,
    maxSteps: integer(env, 'AGENT_MAX_STEPS', 6, 1, 20),
    maxOutputTokens: integer(env, 'AGENT_MAX_OUTPUT_TOKENS', 1500, 128, 16000),
    timeoutMs: integer(env, 'AGENT_TIMEOUT_MS', 45000, 1000, 120000),
    historyTurns: integer(env, 'AGENT_HISTORY_TURNS', 10, 1, 30),
  };
}

export function createOpenAIModel(config: Pick<AgentConfig, 'apiKey' | 'model'>) {
  return createOpenAI({ apiKey: config.apiKey }).responses(config.model);
}
