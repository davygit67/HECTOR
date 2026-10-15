import { readAgentConfig } from './config.js';

try {
  const { model, maxSteps, maxOutputTokens, timeoutMs, historyTurns } = readAgentConfig();
  console.log(JSON.stringify({ provider: 'OpenAI direct', model, maxSteps, maxOutputTokens, timeoutMs, historyTurns,
    apiKey: 'configured (not displayed)', liveRequestMade: false }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Agent configuration is invalid.');
  process.exitCode = 1;
}
