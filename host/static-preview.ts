import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { LocalAssets } from './local-assets.js';

const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
function within(root: string, path: string) { const part = relative(root, path); return part !== '..' && !part.startsWith('..' + sep) && !isAbsolute(part); }
/** Static built assets only: no scene API, credentials, arbitrary filesystem access, or network proxy. */
export function staticAssetHandler(root: string) {
  return async (request: IncomingMessage, response: ServerResponse) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    const fail = (code: number) => { response.writeHead(code); response.end(); };
    if (request.method !== 'GET' && request.method !== 'HEAD') { response.setHeader('Allow', 'GET, HEAD'); fail(405); return; }
    try {
      const raw = (request.url ?? '/').split('?')[0];
      const path = decodeURIComponent(raw);
      if (!path.startsWith('/') || path.includes('\\') || path.includes('\0') || path.split('/').some(part => part.startsWith('.'))) { fail(404); return; }
      const base = await realpath(root), candidate = resolve(base, '.' + (path === '/' ? '/index.html' : path));
      if (!within(base, candidate)) { fail(404); return; }
      const actual = await realpath(candidate);
      if (!within(base, actual) || !mime[extname(actual)] || !(await stat(actual)).isFile()) { fail(404); return; }
      const data = await readFile(actual);
      response.writeHead(200, { 'Content-Type': mime[extname(actual)], 'Content-Length': data.length, 'Cache-Control': 'no-store' });
      response.end(request.method === 'HEAD' ? undefined : data);
    } catch { fail(404); }
  };
}
export async function startStaticPreview(root: string, media?: LocalAssets) {
  const staticHandler = staticAssetHandler(root);
  const server = createServer(async (request, response) => {
    if (media && await media.serve(request, response)) return;
    await staticHandler(request, response);
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); }); });
  const address = server.address();
  if (!address || typeof address === 'string') { server.close(); throw new Error('Could not start the desktop asset server.'); }
  return { origin: 'http://127.0.0.1:' + address.port, close: () => server.close() };
}
