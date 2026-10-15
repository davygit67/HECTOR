import { createOpenAIModel, readAgentConfig } from './config.js';
import { createAgentSession } from './session.js';

// Explicit connectivity check only. No canvas is attached and no room data is sent.
try {
  const config = readAgentConfig();
  const session = createAgentSession({
    ...config,
    model: createOpenAIModel(config),
    maxSteps: 1,
    maxOutputTokens: 256,
    bindTurn: async () => ({ tools: {}, instructions: async () => 'This is a connection check. Reply exactly: Connection verified.' }),
  });
  process.once('SIGINT', () => session.cancel());
  const result = await session.send('Verify the model connection.');
  console.log(JSON.stringify({ model: config.model, text: result.text, status: result.status, usage: result.usage }, null, 2));
  if (result.status !== 'complete') process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : 'The connection check failed.');
  process.exitCode = 1;
}
