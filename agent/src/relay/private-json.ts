import { mkdirSync, openSync, closeSync, writeFileSync, readFileSync, renameSync, unlinkSync, existsSync, fsyncSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

/** A single-process store with atomic replacement; never silently resets corrupt data. */
export function privateJson<T>(path: string, initial: T, validate: (data: unknown) => T) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const lock = path + '.lock';
  let lockFd: number;
  try { lockFd = openSync(lock, 'wx', 0o600); writeFileSync(lockFd, String(process.pid)); }
  catch { throw new Error('The private relay store is locked. Stop its other process before opening it. After a crash, remove the lock only after verifying that process has stopped.'); }
  let closed = false;
  const close = () => { if (!closed) { closed = true; closeSync(lockFd); unlinkSync(lock); } };
  let data: T;
  try { data = existsSync(path) ? validate(JSON.parse(readFileSync(path, 'utf8'))) : initial; }
  catch { close(); throw new Error('The private relay store could not be read. Preserve it for recovery; it was not reset.'); }
  const save = (next: T) => {
    if (closed) throw new Error('The private relay store is closed.');
    const tmp = path + '.' + randomUUID() + '.tmp';
    let fd: number | undefined;
    try {
      fd = openSync(tmp, 'wx', 0o600); writeFileSync(fd, JSON.stringify(next)); fsyncSync(fd); closeSync(fd); fd = undefined;
      renameSync(tmp, path); chmodSync(path, 0o600);
      // Flush the directory entry where supported. Windows may reject directory handles.
      if (process.platform !== 'win32') { const directory = openSync(dirname(path), 'r'); try { fsyncSync(directory); } finally { closeSync(directory); } }
      data = next;
    } finally { if (fd !== undefined) closeSync(fd); if (existsSync(tmp)) unlinkSync(tmp); }
  };
  return { get: () => structuredClone(data), save, close };
}
