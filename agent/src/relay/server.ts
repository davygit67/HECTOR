import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { createProjectionMcpServer } from './mcp.js';
import { RelayError, type ProjectionInbox } from './inbox.js';
import { receiptSchema, relayId } from './types.js';

export interface RelayServerOptions {
  inbox: ProjectionInbox; submitToken: string; deviceToken: string;
  /** Exact external Host headers accepted behind TLS proxy, including port when non-default. */
  allowedHosts: string[];
}
function matches(actual: string | undefined, expected: string): boolean {
  return !!actual && timingSafeEqual(createHash('sha256').update(actual).digest(), createHash('sha256').update('Bearer ' + expected).digest());
}
async function body(req: IncomingMessage): Promise<unknown> {
  if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) throw new RelayError('content_type', 'Use application/json.');
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 32768) throw new RelayError('too_large', 'Request is too large.'); chunks.push(Buffer.from(chunk)); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new RelayError('invalid_json', 'Invalid JSON.'); }
}
function json(res: ServerResponse, code: number, value: unknown) { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); }
const deviceBase = z.object({ deviceId: relayId }).strict();
const leaseInput = deviceBase.extend({ id: z.string().uuid(), leaseToken: z.string().uuid() });

export function createProjectionRelayServer(options: RelayServerOptions) {
  if (options.submitToken.length < 32 || options.deviceToken.length < 32 || options.submitToken === options.deviceToken) throw new Error('Use separate submit and device tokens of at least 32 characters.');
  if (!options.allowedHosts.length || options.allowedHosts.some(host => !host || /[\s/@?#]/.test(host))) throw new Error('Configure exact allowed relay hosts.');
  let windowStart = Date.now(), calls = 0;
  const server = createServer(async (req, res) => {
    try {
      if (!options.allowedHosts.includes(req.headers.host ?? '')) { json(res, 403, { error: 'Unrecognized relay host.' }); return; }
      // This machine-to-machine endpoint has no browser/CORS authority.
      if (req.headers.origin !== undefined) { json(res, 403, { error: 'Browser origins are not enabled for this relay.' }); return; }
      const path = new URL(req.url ?? '/', 'http://relay.invalid').pathname;
      const devicePath = path.startsWith('/device/');
      if (!matches(req.headers.authorization, devicePath ? options.deviceToken : options.submitToken)) {
        res.setHeader('WWW-Authenticate', 'Bearer realm="projection-mapper"'); json(res, 401, { error: 'Authentication required.' }); return;
      }
      if (Date.now() - windowStart >= 60000) { windowStart = Date.now(); calls = 0; }
      if (++calls > 600) { json(res, 429, { error: 'Relay request limit reached.' }); return; }
      if (path === '/health' && req.method === 'GET') { json(res, 200, { service: 'projection-mapper-relay' }); return; }
      if (path === '/status' && req.method === 'GET') { json(res, 200, options.inbox.status()); return; }
      if (req.method !== 'POST') { json(res, 405, { error: 'Use POST.' }); return; }
      const input = await body(req);
      if (path === '/mcp') {
        const mcp = createProjectionMcpServer(options.inbox);
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
        res.once('close', () => { void mcp.close().catch(() => {}); });
        await mcp.connect(transport); await transport.handleRequest(req, res, input); return;
      }
      if (path === '/jobs') { json(res, 200, options.inbox.submit(input)); return; }
      if (path === '/jobs/status') { const parsed = z.object({ id: z.string().uuid() }).strict().parse(input); json(res, 200, options.inbox.get(parsed.id)); return; }
      if (path === '/jobs/cancel') { const parsed = z.object({ id: z.string().uuid() }).strict().parse(input); json(res, 200, options.inbox.cancel(parsed.id)); return; }
      if (devicePath) {
        const parsed = (path === '/device/claim' ? deviceBase : path === '/device/status' ? deviceBase.extend({ id: z.string().uuid() }) : path === '/device/finish' ? leaseInput.extend({ receipt: receiptSchema }) : leaseInput).parse(input);
        if (parsed.deviceId !== options.inbox.targetId) throw new RelayError('wrong_target', 'Unknown projector installation.');
        if (path === '/device/claim') { json(res, 200, options.inbox.claim()); return; }
        if (path === '/device/status') { json(res, 200, options.inbox.get(deviceBase.extend({ id: z.string().uuid() }).parse(input).id)); return; }
        const lease = leaseInput.passthrough().parse(parsed);
        if (path === '/device/start') { json(res, 200, options.inbox.start(lease.id, lease.leaseToken)); return; }
        if (path === '/device/finish') { json(res, 200, options.inbox.finish(lease.id, lease.leaseToken, receiptSchema.parse((parsed as { receipt?: unknown }).receipt))); return; }
      }
      json(res, 404, { error: 'Unknown relay endpoint.' });
    } catch (error) {
      if (!res.headersSent) json(res, error instanceof RelayError ? 409 : error instanceof z.ZodError ? 400 : 500,
        { error: error instanceof RelayError ? error.message : error instanceof z.ZodError ? 'Invalid request fields.' : 'Relay request failed. Check private storage and configuration.' });
      else res.end();
    }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000; server.maxHeadersCount = 40;
  return server;
}
