import { mkdtemp, readFile, rm, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { atomicWrite, readProject } from '../electron/persistence';
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
