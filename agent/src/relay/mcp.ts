import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { creativePromptSchema, taskUpdateSchema } from './types.js';
import { RelayError, type ProjectionInbox } from './inbox.js';

export function createProjectionMcpServer(inbox: ProjectionInbox) {
  const server = new McpServer({ name: 'projection-mapper', version: '1.0.0' }, { maxToolInputElements: 100 });
  const result = (operation: () => unknown) => {
    try { const value = operation(); return { content: [{ type: 'text' as const, text: JSON.stringify(value) }], structuredContent: value as Record<string, unknown> }; }
    catch (error) { return { isError: true, content: [{ type: 'text' as const, text: error instanceof RelayError ? error.message : 'Request could not be recorded. Check the input and private relay storage.' }] }; }
  };
  const write = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true };
  const read = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  server.registerTool('publish_task_update', {
    description: 'Queue a readable visual task update for the local canvas agent. Use after an authorized cloud task completes. Reuse requestId on retries. Queued does not mean displayed. Use get_projection_request to inspect the result.',
    inputSchema: taskUpdateSchema.omit({ kind: true }), annotations: write,
  }, input => result(() => inbox.submit({ ...input, kind: 'task_update' })));
  server.registerTool('request_projection', {
    description: 'Queue a natural-language visual experience for the existing spatial canvas agent. Supports composition, supported media, generated 2D programs and follow-up adjustments. Send intent, not raw coordinates or code. The local agent may report unsupported parts. Accepted is not physical-output verification.',
    inputSchema: creativePromptSchema.omit({ kind: true }), annotations: { ...write, destructiveHint: true },
  }, input => result(() => inbox.submit({ ...input, kind: 'creative_prompt' })));
  server.registerTool('get_projection_request', { description: 'Read queued/running/complete/incomplete/failed/expired/uncertain status and the local agent result. No camera data is returned.', inputSchema: { id: z.string().uuid() }, annotations: read },
    input => result(() => inbox.get(input.id)));
  server.registerTool('get_projector_status', { description: 'Get this installation ID, receiver online status and inbox counts. Online means a selected studio recently polled; physical output is not verified.', inputSchema: {}, annotations: read },
    () => result(() => inbox.status()));
  server.registerTool('cancel_projection_request', { description: 'Cancel a queued request before local execution begins. For a running request use Stop in the studio; already accepted edits are preserved.', inputSchema: { id: z.string().uuid() }, annotations: { ...write, destructiveHint: true } },
    input => result(() => inbox.cancel(input.id)));
  return server;
}
