import { randomUUID } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import { copyFile, mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isAbsolute, join, resolve } from 'node:path';

const validId = (id: unknown): id is string => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(id);
const validMime = (mime: unknown): mime is string => typeof mime === 'string' && /^(image|video)\/[a-zA-Z0-9.+-]+$/.test(mime);
const maxBytes = 2 * 1024 ** 3;

/** Copies only files chosen by the operator. Scene JSON retains an opaque ID,
 * so desktop media survives the static server choosing a new port on restart. */
export class LocalAssets {
  readonly prefix = `/__media/${randomUUID()}/`;
  constructor(private readonly directory: string) {}
  private path(id: unknown, extension: string) {
    if (!validId(id)) throw new Error('Invalid local media ID.');
    return join(this.directory, `${id}.${extension}`);
  }
  async store(sourcePath: unknown, mimeType: unknown): Promise<string> {
    if (typeof sourcePath !== 'string' || !isAbsolute(sourcePath) || !validMime(mimeType)) throw new Error('Choose a video or image from this computer.');
    const source = await stat(sourcePath);
    if (!source.isFile() || !source.size || source.size > maxBytes) throw new Error('Choose a nonempty video or image no larger than 2 GB.');
    await mkdir(this.directory, { recursive: true });
    const id = randomUUID();
    try {
      await copyFile(sourcePath, this.path(id, 'bin'), constants.COPYFILE_EXCL);
      const copied = await stat(this.path(id, 'bin'));
      if (copied.size !== source.size) throw new Error('The file changed while importing. Please try again.');
      await writeFile(this.path(id, 'json'), JSON.stringify({ mimeType, size: copied.size }), { flag: 'wx' });
      return id;
    } catch (error) { await this.remove(id); throw error; }
  }
  async remove(id: unknown): Promise<void> {
    const binary = this.path(id, 'bin'), metadata = this.path(id, 'json');
    await Promise.all([rm(binary, { force: true }), rm(metadata, { force: true })]);
  }
  private async describe(id: unknown) {
    const path = this.path(id, 'bin');
    const [metadata, actual, info] = await Promise.all([readFile(this.path(id, 'json'), 'utf8'), realpath(path), stat(path)]);
    const value = JSON.parse(metadata);
    if (actual !== resolve(await realpath(this.directory), `${id}.bin`) || !info.isFile() || !info.size || info.size > maxBytes || value.size !== info.size || !validMime(value.mimeType)) throw new Error('Invalid stored media.');
    return { path, size: info.size, mimeType: value.mimeType as string };
  }
  async url(id: unknown): Promise<string> {
    try { await this.describe(id); return this.prefix + id; }
    catch { throw new Error('The local file is missing. Use Replace file to relink it.'); }
  }
  /** Same-origin, streamed byte ranges; never exposes the source file path. */
  async serve(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
    const path = (request.url ?? '').split('?')[0];
    if (!path.startsWith(this.prefix)) return false;
    const end = (code: number) => { response.writeHead(code); response.end(); return true; };
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    if (request.method !== 'GET' && request.method !== 'HEAD') { response.setHeader('Allow', 'GET, HEAD'); return end(405); }
    try {
      const asset = await this.describe(path.slice(this.prefix.length));
      let start = 0, finish = asset.size - 1;
      const range = request.headers.range;
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (!match || (!match[1] && !match[2])) { response.setHeader('Content-Range', `bytes */${asset.size}`); return end(416); }
        if (!match[1]) start = Math.max(0, asset.size - Number(match[2]));
        else { start = Number(match[1]); if (match[2]) finish = Math.min(finish, Number(match[2])); }
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(finish) || start < 0 || start >= asset.size || finish < start) { response.setHeader('Content-Range', `bytes */${asset.size}`); return end(416); }
        response.setHeader('Content-Range', `bytes ${start}-${finish}/${asset.size}`);
      }
      response.writeHead(range ? 206 : 200, { 'Accept-Ranges': 'bytes', 'Content-Type': asset.mimeType, 'Content-Length': finish - start + 1 });
      if (request.method === 'HEAD') response.end();
      else {
        const stream = createReadStream(asset.path, { start, end: finish });
        stream.on('error', () => response.destroy());
        response.on('close', () => stream.destroy());
        stream.pipe(response);
      }
      return true;
    } catch { return end(404); }
  }
}
