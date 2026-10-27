// Serves granted local media to HECTOR's renderers with HTTP byte-range semantics.
// Chromium's media stack seeks by issuing Range requests; it needs 206 + Content-Range to place the bytes correctly.
// (net.fetch on file:// returns the requested bytes with status 200 and no Content-Range, which breaks backward seeks.)
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { Readable } from 'node:stream';

const contentTypes: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm'
};
export type ByteRange = { start: number; end: number };
/** Parse a single `bytes=` range. `null` means serve the whole file (no range, or a form we don't support such as multiple ranges). */
export function parseRange(header: string | null, size: number): ByteRange | null | 'unsatisfiable' {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === '' && match[2] === '')) return null;
  let start: number, end: number;
  if (match[1] === '') {
    const suffix = Number(match[2]); if (suffix === 0) return 'unsatisfiable';
    start = Math.max(0, size - suffix); end = size - 1;
  } else {
    start = Number(match[1]); end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || start > end) return 'unsatisfiable';
  return { start, end };
}
export async function serveFile(path: string, request: Request): Promise<Response> {
  const { size } = await stat(path);
  // no-store keeps copies of private media out of Chromium's HTTP disk cache; the media buffer still works in memory.
  const headers = new Headers({ 'Accept-Ranges': 'bytes', 'Content-Type': contentTypes[extname(path).toLowerCase()] ?? 'application/octet-stream',
    'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
  const range = parseRange(request.headers.get('range'), size);
  if (range === 'unsatisfiable') { headers.set('Content-Range', `bytes */${size}`); return new Response(null, { status: 416, headers }); }
  const start = range?.start ?? 0, end = range?.end ?? size - 1, length = Math.max(0, end - start + 1);
  headers.set('Content-Length', String(length));
  if (range) headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
  const body = request.method === 'HEAD' || length === 0 ? null : Readable.toWeb(createReadStream(path, { start, end })) as unknown as ReadableStream<Uint8Array>;
  return new Response(body, { status: range ? 206 : 200, headers });
}
