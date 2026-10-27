import { mkdtemp, readFile, rm, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { atomicWrite, readProject } from '../electron/persistence';
import { parseRange, serveFile } from '../electron/media-protocol';
import { initialScene } from '../src/core/model';
const directories: string[] = [];
afterEach(async () => { for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }); });
it('round-trips a validated project and atomically replaces its previous value', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hector-persistence-')); directories.push(dir);
  const path = join(dir, 'project.json'), doc = { format: 'hector', version: 1, scene: initialScene(), assets: {} };
  await atomicWrite(path, doc); expect(await readProject(path)).toEqual(doc);
  doc.scene.name = 'Saved again'; await atomicWrite(path, doc); expect((await readProject(path)).scene.name).toBe('Saved again');
  expect(await readdir(dir)).toEqual(['project.json']);
});
it('preserves malformed files for recovery instead of overwriting them', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hector-persistence-')); directories.push(dir);
  const path = join(dir, 'bad.json'); await writeFile(path, '{broken');
  await expect(readProject(path)).rejects.toThrow(); expect(await readFile(path,'utf8')).toBe('{broken');
});
it('rejects oversized project files by size before parsing them', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hector-persistence-')); directories.push(dir);
  const path = join(dir, 'huge.json'); await writeFile(path, Buffer.alloc(4_000_001, 0x20));
  await expect(readProject(path)).rejects.toThrow(/4 MB/);
});
describe('media byte ranges', () => {
  it('parses the range forms Chromium sends and rejects unsatisfiable ones', () => {
    expect(parseRange(null, 100)).toBeNull();
    expect(parseRange('bytes=0-', 100)).toEqual({ start: 0, end: 99 });
    expect(parseRange('bytes=10-19', 100)).toEqual({ start: 10, end: 19 });
    expect(parseRange('bytes=90-500', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=-30', 100)).toEqual({ start: 70, end: 99 });
    expect(parseRange('bytes=100-', 100)).toBe('unsatisfiable');
    expect(parseRange('bytes=20-10', 100)).toBe('unsatisfiable');
    expect(parseRange('bytes=0-1,5-9', 100)).toBeNull();
  });
  it('answers range requests with 206 and the exact bytes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hector-range-')); directories.push(dir);
    const path = join(dir, 'clip.webm'); await writeFile(path, Buffer.from(Array.from({ length: 256 }, (_, i) => i)));
    const partial = await serveFile(path, new Request('hector-media://asset/x', { headers: { Range: 'bytes=16-31' } }));
    expect(partial.status).toBe(206);
    expect(partial.headers.get('content-range')).toBe('bytes 16-31/256');
    expect([...new Uint8Array(await partial.arrayBuffer())]).toEqual(Array.from({ length: 16 }, (_, i) => i + 16));
    const whole = await serveFile(path, new Request('hector-media://asset/x'));
    expect(whole.status).toBe(200); expect(whole.headers.get('accept-ranges')).toBe('bytes'); expect((await whole.arrayBuffer()).byteLength).toBe(256);
    expect((await serveFile(path, new Request('hector-media://asset/x', { headers: { Range: 'bytes=300-' } }))).status).toBe(416);
  });
});
