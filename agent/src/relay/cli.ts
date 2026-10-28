import { resolve } from 'node:path';
import { createProjectionInbox } from './inbox.js';
import { createProjectionRelayServer } from './server.js';

async function main() {
  const env = process.env;
  const targetId = env.PROJECTION_RELAY_DEVICE_ID || 'home-studio';
  const path = resolve(env.PROJECTION_RELAY_STORE || '.local-data/projection-inbox.json');
  const inbox = createProjectionInbox({ path, targetId });
  try {
    const port = Number(env.PROJECTION_RELAY_PORT || 8787), host = env.PROJECTION_RELAY_BIND || '127.0.0.1';
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('Invalid relay port.');
    const allowedHosts = (env.PROJECTION_RELAY_ALLOWED_HOSTS || `127.0.0.1:${port},localhost:${port}`).split(',').map(value => value.trim());
    if (host !== '127.0.0.1' && !env.PROJECTION_RELAY_ALLOWED_HOSTS) throw new Error('Set explicit allowed hosts for a relay behind an HTTPS proxy.');
    const server = createProjectionRelayServer({ inbox, submitToken: env.PROJECTION_RELAY_SUBMIT_TOKEN || '', deviceToken: env.PROJECTION_RELAY_DEVICE_TOKEN || '', allowedHosts });
    await new Promise<void>((accept, reject) => { server.once('error', reject); server.listen(port, host, () => accept()); });
    console.error(`Projection relay listening on port ${port}; target ${targetId}. Remote clients require an authenticated HTTPS endpoint.`);
    let closing = false;
    const close = () => { if (closing) return; closing = true; server.close(() => { inbox.close(); }); server.closeIdleConnections(); };
    process.once('SIGINT', close); process.once('SIGTERM', close);
  } catch (error) { inbox.close(); throw error; }
}
void main().catch(error => { console.error(error instanceof Error ? error.message : 'Relay could not start.'); process.exitCode = 1; });
