import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalAssets } from '../host/local-assets.ts';
import { startStaticPreview } from '../host/static-preview.ts';

test('desktop imports survive new server origins; byte ranges support seeking without exposing source files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mapper-media-'));
  const servers: Awaited<ReturnType<typeof startStaticPreview>>[] = [];
  try {
    const source = join(root, 'chosen.mp4'), directory = join(root, 'stored'), built = join(root, 'dist');
    const bytes = Buffer.from('0123456789abcdefghij');
    await mkdir(built); await writeFile(join(built, 'index.html'), 'Studio'); await writeFile(source, bytes);
    const first = new LocalAssets(directory), id = await first.store(source, 'video/mp4');
    const server1 = await startStaticPreview(built, first); servers.push(server1);
    const firstUrl = server1.origin + await first.url(id);
    assert.deepEqual(Buffer.from(await (await fetch(firstUrl)).arrayBuffer()), bytes);
    // A new manager and origin can resolve the saved opaque ID. Tokens rotate per run.
    const next = new LocalAssets(directory), server2 = await startStaticPreview(built, next); servers.push(server2);
    const url = server2.origin + await next.url(id);
    assert.notEqual(server1.origin, server2.origin); assert.notEqual(first.prefix, next.prefix);
    assert.equal((await fetch(server2.origin + await first.url(id))).status, 404);
    const head = await fetch(url, { method: 'HEAD' });
    assert.equal(head.status, 200); assert.equal(head.headers.get('content-length'), '20'); assert.equal(await head.text(), '');
    assert.equal(head.headers.get('content-type'), 'video/mp4'); assert.equal(head.headers.get('accept-ranges'), 'bytes');
    assert.equal(head.headers.get('cross-origin-resource-policy'), 'same-origin');
    for (const [range, expected, contentRange] of [['bytes=3-7', '34567', 'bytes 3-7/20'], ['bytes=17-', 'hij', 'bytes 17-19/20'], ['bytes=-4', 'ghij', 'bytes 16-19/20'], ['bytes=18-999', 'ij', 'bytes 18-19/20']]) {
      const response = await fetch(url, { headers: { Range: range } });
      assert.equal(response.status, 206); assert.equal(response.headers.get('content-range'), contentRange); assert.equal(await response.text(), expected);
    }
    for (const range of ['bytes=21-', 'bytes=8-2', 'bytes=-0', 'bytes=-', 'bytes=0-1,4-5', 'garbage']) {
      const response = await fetch(url, { headers: { Range: range } });
      assert.equal(response.status, 416, range); assert.equal(response.headers.get('content-range'), 'bytes */20');
    }
    assert.equal((await fetch(url, { method: 'POST' })).status, 405);
    assert.equal((await fetch(server2.origin + next.prefix + 'missing')).status, 404);
    assert.equal((await fetch(server2.origin + next.prefix + '%2e%2e%2fchosen.mp4')).status, 404);
    assert.equal((await fetch(server2.origin + '/chosen.mp4')).status, 404);
    await next.remove(id); await assert.rejects(next.url(id), /Replace file/);
    assert.deepEqual(await readFile(source), bytes, 'Removing an imported copy never deletes the original');
  } finally { for (const server of servers) server.close(); await rm(root, { recursive: true, force: true }); }
});

test('desktop media rejects invalid imports and escaped asset paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mapper-media-validation-'));
  try {
    const directory = join(root, 'stored'), source = join(root, 'chosen.png');
    await writeFile(source, 'image bytes'); const assets = new LocalAssets(directory);
    await assert.rejects(assets.store('relative.png', 'image/png'));
    await assert.rejects(assets.store(source, 'text/html'));
    await assert.rejects(assets.store(root, 'image/png'));
    await assert.rejects(assets.remove('../chosen'));
    const id = await assets.store(source, 'image/png');
    await rm(join(directory, id + '.bin')); await symlink(source, join(directory, id + '.bin'));
    await assert.rejects(assets.url(id), /Replace file/);
    await assets.remove(id); assert.equal(await readFile(source, 'utf8'), 'image bytes');
  } finally { await rm(root, { recursive: true, force: true }); }
});
