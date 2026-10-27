// Deterministic media fixtures generated at test time, so the repository ships no media.
import type { ElectronApplication, Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Rgb } from './harness';

export const fixtureDir = resolve('artifacts', 'e2e-fixtures');
export const fixtures = {
  clip: join(fixtureDir, 'clip-30fps-10s.webm'),
  shortClip: join(fixtureDir, 'clip-30fps-3s.webm'),
  quadrants: join(fixtureDir, 'quadrants.png'),
  magenta: join(fixtureDir, 'magenta.png')
};
export interface VideoSpec { width: number; height: number; fps: number; seconds: number }
interface Chunk { key: boolean; ts: number; data: Buffer }

// ---- Minimal WebM (Matroska) writer: EBML header, Info with Duration, one VP8 track, clusters per keyframe, Cues.
const size8 = (n: number) => { const b = Buffer.alloc(8); b.writeUInt32BE(Math.floor(n / 2 ** 32), 0); b.writeUInt32BE(n >>> 0, 4); b[0] = 0x01; return b; };
const element = (id: number[], ...payload: Buffer[]) => { const body = Buffer.concat(payload); return Buffer.concat([Buffer.from(id), size8(body.length), body]); };
const uint = (n: number) => { let hex = Math.round(n).toString(16); if (hex.length % 2) hex = '0' + hex; return Buffer.from(hex, 'hex'); };
const uint8 = (n: number) => { const b = Buffer.alloc(8); b.writeUInt32BE(Math.floor(n / 2 ** 32), 0); b.writeUInt32BE(n >>> 0, 4); return b; };
const float = (n: number) => { const b = Buffer.alloc(8); b.writeDoubleBE(n); return b; };
const text = (s: string) => Buffer.from(s, 'ascii');
export function muxWebm(chunks: Chunk[], spec: VideoSpec, options: { cues?: boolean } = {}) {
  const header = element([0x1a, 0x45, 0xdf, 0xa3], element([0x42, 0x86], uint(1)), element([0x42, 0xf7], uint(1)), element([0x42, 0xf2], uint(4)),
    element([0x42, 0xf3], uint(8)), element([0x42, 0x82], text('webm')), element([0x42, 0x87], uint(2)), element([0x42, 0x85], uint(2)));
  const durationMs = (chunks.length * 1000) / spec.fps;
  const info = element([0x15, 0x49, 0xa9, 0x66], element([0x2a, 0xd7, 0xb1], uint(1_000_000)), element([0x44, 0x89], float(durationMs)),
    element([0x4d, 0x80], text('hector-e2e')), element([0x57, 0x41], text('hector-e2e')));
  const tracks = element([0x16, 0x54, 0xae, 0x6b], element([0xae], element([0xd7], uint(1)), element([0x73, 0xc5], uint(1)), element([0x83], uint(1)),
    element([0x86], text('V_VP8')), element([0x23, 0xe3, 0x83], uint(1e9 / spec.fps)), element([0xe0], element([0xb0], uint(spec.width)), element([0xba], uint(spec.height)))));
  const groups: Chunk[][] = [];
  for (const chunk of chunks) { if (chunk.key || !groups.length) groups.push([]); groups[groups.length - 1].push(chunk); }
  const clusters = groups.map(group => {
    const base = Math.round(group[0].ts / 1000);
    const blocks = group.map(chunk => { const head = Buffer.alloc(4); head[0] = 0x81; head.writeInt16BE(Math.round(chunk.ts / 1000) - base, 1); head[3] = chunk.key ? 0x80 : 0; return element([0xa3], head, chunk.data); });
    return { time: base, bytes: element([0x1f, 0x43, 0xb6, 0x75], element([0xe7], uint(base)), ...blocks) };
  });
  // Cue positions are fixed-width, so the Cues size is known before cluster offsets are computed.
  const cueSize = element([0x1c, 0x53, 0xbb, 0x6b], ...clusters.map(() => element([0xbb], element([0xb3], uint8(0)), element([0xb7], element([0xf7], uint(1)), element([0xf1], uint8(0)))))).length;
  let offset = info.length + tracks.length + cueSize;
  const cues = element([0x1c, 0x53, 0xbb, 0x6b], ...clusters.map(cluster => {
    const point = element([0xbb], element([0xb3], uint8(cluster.time)), element([0xb7], element([0xf7], uint(1)), element([0xf1], uint8(offset))));
    offset += cluster.bytes.length; return point;
  }));
  return Buffer.concat([header, element([0x18, 0x53, 0x80, 0x67], info, tracks, ...(options.cues === false ? [] : [cues]), ...clusters.map(c => c.bytes))]);
}

/** Encode a constant-frame-rate VP8 clip with WebCodecs inside a HECTOR window. Each frame shows its index on a hue that cycles once per clip. */
export async function encodeClip(page: Page, spec: VideoSpec) {
  const chunks = await page.evaluate(async ({ width, height, fps, seconds }) => {
    const out: { key: boolean; ts: number; data: string }[] = []; let failure: unknown = null;
    const encoder = new VideoEncoder({
      output: chunk => { const bytes = new Uint8Array(chunk.byteLength); chunk.copyTo(bytes); let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); out.push({ key: chunk.type === 'key', ts: chunk.timestamp, data: btoa(s) }); },
      error: e => { failure = e; } });
    encoder.configure({ codec: 'vp8', width, height, bitrate: Math.round(width * height * fps * 0.12), framerate: fps });
    const canvas = new OffscreenCanvas(width, height), ctx = canvas.getContext('2d')!, total = Math.round(fps * seconds);
    for (let i = 0; i < total; i++) {
      ctx.fillStyle = `hsl(${Math.round(i * 360 / total)} 80% 45%)`; ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#fff'; ctx.font = `${Math.round(height / 3)}px monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(i), width / 2, height / 2);
      const frame = new VideoFrame(canvas, { timestamp: Math.round(i * 1e6 / fps), duration: Math.round(1e6 / fps) });
      encoder.encode(frame, { keyFrame: i % fps === 0 }); frame.close();
      while (encoder.encodeQueueSize > 8) await new Promise(r => setTimeout(r, 1));
      if (failure) throw failure;
    }
    await encoder.flush(); encoder.close(); if (failure) throw failure;
    return out;
  }, spec);
  return muxWebm(chunks.map(c => ({ key: c.key, ts: c.ts, data: Buffer.from(c.data, 'base64') })), spec);
}

/** PNG with four colored quadrants (top-left, top-right, bottom-left, bottom-right), made with Electron's nativeImage. */
export async function quadrantPng(app: ElectronApplication, width: number, height: number, quadrants: [Rgb, Rgb, Rgb, Rgb]) {
  const base64 = await app.evaluate(({ nativeImage }, { width, height, quadrants }) => {
    const bitmap = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const [r, g, b] = quadrants[(y < height / 2 ? 0 : 2) + (x < width / 2 ? 0 : 1)], i = (y * width + x) * 4;
      bitmap[i] = b; bitmap[i + 1] = g; bitmap[i + 2] = r; bitmap[i + 3] = 255;
    }
    return nativeImage.createFromBitmap(bitmap, { width, height }).toPNG().toString('base64');
  }, { width, height, quadrants });
  return Buffer.from(base64, 'base64');
}

export async function ensureFixtures(app: ElectronApplication, page: Page) {
  await mkdir(fixtureDir, { recursive: true });
  if (!existsSync(fixtures.clip)) await writeFile(fixtures.clip, await encodeClip(page, { width: 320, height: 180, fps: 30, seconds: 10 }));
  if (!existsSync(fixtures.shortClip)) await writeFile(fixtures.shortClip, await encodeClip(page, { width: 320, height: 180, fps: 30, seconds: 3 }));
  if (!existsSync(fixtures.quadrants)) await writeFile(fixtures.quadrants, await quadrantPng(app, 640, 360, [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 255]]));
  if (!existsSync(fixtures.magenta)) await writeFile(fixtures.magenta, await quadrantPng(app, 64, 36, [[255, 0, 255], [255, 0, 255], [255, 0, 255], [255, 0, 255]]));
}
