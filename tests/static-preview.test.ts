import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { staticAssetHandler } from '../host/static-preview.ts';

test('desktop origin serves built assets but blocks traversal, symlinks, hidden files and mutations', async () => {
  const base = await mkdtemp(join(tmpdir(), 'projection-assets-')), root = join(base, 'dist');
  try {
    await mkdir(root); await mkdir(join(root, 'assets')); await writeFile(join(root, 'index.html'), '<h1>Studio</h1>'); await writeFile(join(root, 'assets/app.js'), 'void 0;'); await writeFile(join(root, 'assets/runtime.wasm'), new Uint8Array([0,97,115,109]));
    await writeFile(join(base, 'private.js'), 'private'); await writeFile(join(root, '.env'), 'private'); await symlink(join(base, 'private.js'), join(root, 'leak.js'));
    const handler = staticAssetHandler(root);
    async function request(url: string, method = 'GET') {
      const result = { code: 0, headers: {} as Record<string, string | number>, data: '' };
      const response = { setHeader: (key: string, value: string) => { result.headers[key] = value; }, writeHead: (code: number, headers = {}) => { result.code = code; Object.assign(result.headers, headers); }, end: (data?: Buffer) => { result.data = data?.toString() ?? ''; } };
      await handler({ url, method } as IncomingMessage, response as unknown as ServerResponse); return result;
    }
    const page = await request('/?view=output'); assert.equal(page.code, 200); assert.equal(page.headers['Referrer-Policy'], 'strict-origin-when-cross-origin'); assert.match(page.data, /Studio/);
    assert.equal((await request('/assets/app.js')).headers['Content-Type'], 'text/javascript; charset=utf-8');
    assert.equal((await request('/assets/runtime.wasm')).headers['Content-Type'], 'application/wasm');
    const head = await request('/', 'HEAD'); assert.equal(head.code, 200); assert.equal(head.data, '');
    assert.equal((await request('/', 'POST')).code, 405);
    for (const url of ['/../private.js', '/%2e%2e/private.js', '/%2eenv', '/leak.js', '/assets/', '/%00', '/%zz', '/assets\\..\\private.js', '//../private.js']) assert.equal((await request(url)).code, 404, url);
  } finally { await rm(base, { recursive: true, force: true }); }
});
