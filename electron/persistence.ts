import { readFile, writeFile, rename, mkdir, unlink, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { idSchema, sceneSchema } from '../src/core/model';
export const documentSchema = z.object({ format: z.literal('hector'), version: z.literal(1), scene: sceneSchema, assets: z.record(idSchema, z.string().min(1).max(4096)) }).strict();
export async function atomicWrite(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(temp, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600, flag: 'wx' }); await rename(temp, path); }
  catch (error) { await unlink(temp).catch(() => {}); throw error; }
}
export async function readProject(path: string) {
  // Check size before reading so a huge or malformed file is never loaded into memory.
  if ((await stat(path)).size > 4_000_000) throw new Error('Project exceeds the 4 MB limit.');
  const raw = await readFile(path, 'utf8');
  return documentSchema.parse(JSON.parse(raw));
}
