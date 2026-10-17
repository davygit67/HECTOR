import type { BacklightSample } from './backlight.js';
import { homography, type Point, type Quad } from './geometry.js';

/** Transient host-owned pixels. Never persisted in the scene or sent wholesale to the agent; bounded composited observations use a separate on-demand port. */
export interface MediaState {
  contentId: string; generation: number; ready: boolean; playing: boolean; hasPlayed: boolean; muted: boolean;
  status: string; currentTime: number; duration: number;
  source?: 'youtube-watch'; sourceBrowserOpen?: boolean;
}
export interface MediaFrame {
  contentId: string; generation: number; sequence: number; width: number; height: number;
  jpeg: Uint8Array; sample: BacklightSample;
}
export type MediaEvent = { type: 'state'; state: MediaState } | { type: 'frame'; frame: MediaFrame } | { type: 'removed'; contentId: string };
export type MediaCommand = { contentId: string; action: 'play' | 'pause' | 'mute' | 'unmute' | 'retry' | 'restart-renderer' | 'open-source' | 'close-source' } | { contentId: string; action: 'seek'; seconds: number };
export interface MediaInput { contentId: string; type: 'mouseMove' | 'mouseDown' | 'mouseUp'; x: number; y: number }
export interface MediaBridge {
  subscribe(listener: (event: MediaEvent) => void): () => void;
  snapshot(): Promise<MediaEvent[]>;
  command(command: MediaCommand): Promise<void>;
  input(input: MediaInput): Promise<void>;
}
export function validateMediaCommand(value: unknown): asserts value is MediaCommand {
  if (!value || typeof value !== 'object') throw new Error('Invalid player command.');
  const c = value as Record<string, unknown>;
  if (typeof c.contentId !== 'string' || c.contentId.length > 100 || !['play', 'pause', 'mute', 'unmute', 'retry', 'restart-renderer', 'seek', 'open-source', 'close-source'].includes(String(c.action))) throw new Error('Invalid player command.');
  if (Object.keys(c).some(k => !['contentId', 'action', ...(c.action === 'seek' ? ['seconds'] : [])].includes(k))) throw new Error('Unexpected player command field.');
  if (c.action === 'seek' && (typeof c.seconds !== 'number' || !Number.isFinite(c.seconds) || c.seconds < 0 || c.seconds > 86400)) throw new Error('Invalid playback time.');
}

export function validateMediaInput(value: unknown): asserts value is MediaInput {
  if (!value || typeof value !== 'object') throw new Error('Invalid video input.');
  const p = value as Record<string, unknown>;
  if (typeof p.contentId !== 'string' || p.contentId.length > 100 || !['mouseMove', 'mouseDown', 'mouseUp'].includes(String(p.type)) || Object.keys(p).some(k => !['contentId', 'type', 'x', 'y'].includes(k))) throw new Error('Invalid video input.');
  if (typeof p.x !== 'number' || typeof p.y !== 'number' || !Number.isInteger(p.x) || !Number.isInteger(p.y) || p.x < 0 || p.x >= 1920 || p.y < 0 || p.y >= 1080) throw new Error('Input is outside the source frame.');
}
/** Invert the displayed plane, including perspective, before forwarding native input. */
export function videoInputPoint(corners: Quad, point: Point): Point | null {
  const x = Math.min(...corners.map(p => p.x)), y = Math.min(...corners.map(p => p.y));
  const w = Math.max(...corners.map(p => p.x)) - x, h = Math.max(...corners.map(p => p.y)) - y;
  if (w <= 0 || h <= 0) return null;
  try {
    const m = homography(corners.map(p => ({ x: (p.x - x) / w, y: (p.y - y) / h })) as Quad);
    const px = (point.x - x) / w, py = (point.y - y) / h;
    const a = m[0] - px * m[6], b = m[1] - px * m[7], c = px - m[2];
    const d = m[3] - py * m[6], e = m[4] - py * m[7], f = py - m[5], det = a * e - b * d;
    if (Math.abs(det) < 1e-10) return null;
    const u = (c * e - b * f) / det, v = (a * f - c * d) / det;
    if (u < 0 || v < 0 || u > 1 || v > 1) return null;
    return { x: Math.min(1919, Math.floor(u * 1920)), y: Math.min(1079, Math.floor(v * 1080)) };
  } catch { return null; }
}

/** A host watchdog covers failures that happen before the YouTube wrapper can report. */
export function sourceStartupProblem(source: { openedAt: number; lastReport: number; readyAt: number; ready: boolean; hasFrame: boolean }, now: number): string | null {
  if (!source.lastReport && now - source.openedAt > 35000) return 'The video player did not start. Try Restart video renderer.';
  if (source.ready && now - source.lastReport > 8000) return 'The video player stopped responding. Try Restart video renderer.';
  if (source.ready && !source.hasFrame && now - source.readyAt > 12000) return 'The video loaded but no image arrived. Try Restart video renderer.';
  return null;
}
