import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { relayUrl, taskUpdateSchema, creativePromptSchema } from './types.js';

/** Local MCP clients use stdio while the durable inbox stays in one HTTP process. */
async function main() {
  const url = relayUrl(process.env.PROJECTION_RELAY_URL ?? 'http://127.0.0.1:8787');
  const token = process.env.PROJECTION_RELAY_SUBMIT_TOKEN;
  if (!token || token.length < 32) throw new Error('Set a submit token locally for the MCP stdio proxy.');
  const call = async (path: string, body?: unknown) => {
    try {
      const response = await fetch(new URL(path, url), { method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const reader = response.body?.getReader(); if (!reader) throw new Error('Empty response.');
      let length = 0; const parts: Uint8Array[] = [];
      try { for (;;) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > 65536) throw new Error('Response too large.'); parts.push(value); } }
      finally { await reader.cancel(); }
      return { isError: !response.ok, content: [{ type: 'text' as const, text: Buffer.concat(parts).toString('utf8') }] };
    } catch { return { isError: true, content: [{ type: 'text' as const, text: 'Relay unavailable. Verify its URL, credentials and running service.' }] }; }
  };
  const server = new McpServer({ name: 'projection-mapper', version: '1.0.0' });
  const write = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true };
  const read = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  server.registerTool('publish_task_update', { description: 'Queue a task update for your canvas agent. Reuse requestId on retries; queued is not displayed.', inputSchema: taskUpdateSchema.omit({ kind: true }), annotations: write }, input => call('/jobs', { ...input, kind: 'task_update' }));
  server.registerTool('request_projection', { description: 'Queue a natural-language visual request for your existing spatial agent. Reuse requestId on retries. Check the returned job status later.', inputSchema: creativePromptSchema.omit({ kind: true }), annotations: { ...write, destructiveHint: true } }, input => call('/jobs', { ...input, kind: 'creative_prompt' }));
  server.registerTool('get_projection_request', { description: 'Read delivery status and the local agent result; physical output is not verified.', inputSchema: { id: z.string().uuid() }, annotations: read }, input => call('/jobs/status', input));
  server.registerTool('get_projector_status', { description: 'Read configured installation ID and receiver connectivity, not physical projection.', inputSchema: {}, annotations: read }, () => call('/status'));
  server.registerTool('cancel_projection_request', { description: 'Cancel only requests that have not started. Use studio Stop for an active request.', inputSchema: { id: z.string().uuid() }, annotations: { ...write, destructiveHint: true } }, input => call('/jobs/cancel', input));
  await server.connect(new StdioServerTransport());
}
void main().catch(() => { console.error('MCP proxy could not start. Check its local URL and submit token.'); process.exitCode = 1; });
