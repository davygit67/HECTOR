import type { Bounds } from './geometry.js';
import { WIDTH, HEIGHT } from './geometry.js';
import type { ClockState } from './content.js';

export interface MediaConfig {
  assetId: string; mediaType: 'video' | 'image'; fileName: string; mimeType: string;
  width: number; height: number; duration: number;
  fit: 'contain' | 'cover' | 'stretch'; loop: boolean; playbackRate: number; volume: number; muted: boolean;
  rotation: 0 | 90 | 180 | 270; flipX: boolean; flipY: boolean; brightness: number; contrast: number; saturation: number;
}
export const MEDIA_DEFAULTS = { fit: 'contain', loop: true, playbackRate: 1, volume: 1, muted: true, rotation: 0, flipX: false, flipY: false, brightness: 1, contrast: 1, saturation: 1 } as const;
export function validateMediaConfig(value: Record<string, unknown>) {
  const keys = ['assetId', 'mediaType', 'fileName', 'mimeType', 'width', 'height', 'duration', ...Object.keys(MEDIA_DEFAULTS)];
  if (Object.keys(value).some(k => !keys.includes(k))) throw new Error('Unsupported media setting.');
  if (typeof value.assetId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value.assetId)) throw new Error('Import a local media file first.');
  if (!['video', 'image'].includes(value.mediaType as string)) throw new Error('Choose an image or video.');
  for (const key of ['fileName', 'mimeType']) if (typeof value[key] !== 'string' || !(value[key] as string).length || (value[key] as string).length > 255) throw new Error('Invalid media metadata.');
  for (const key of ['width', 'height']) if (!Number.isSafeInteger(value[key]) || (value[key] as number) < 1 || (value[key] as number) > 32768) throw new Error('Invalid media dimensions.');
  if (!Number.isFinite(value.duration) || (value.duration as number) < 0 || (value.duration as number) > 604800) throw new Error('Invalid media duration.');
  if (value.mediaType === 'video' ? (value.duration as number) <= 0 : value.duration !== 0) throw new Error('Video needs a duration; still images use zero.');
  if (!['contain', 'cover', 'stretch'].includes(value.fit as string) || ![0, 90, 180, 270].includes(value.rotation as number)) throw new Error('Invalid media fit or rotation.');
  for (const key of ['loop', 'muted', 'flipX', 'flipY']) if (typeof value[key] !== 'boolean') throw new Error('Invalid media switch.');
  for (const [key, min, max] of [['playbackRate', .25, 4], ['volume', 0, 1], ['brightness', 0, 2], ['contrast', 0, 2], ['saturation', 0, 3]] as const) {
    if (!Number.isFinite(value[key]) || (value[key] as number) < min || (value[key] as number) > max) throw new Error(`${key} must be ${min}–${max}.`);
  }
}
/** A single saved media-time clock feeds every preview. Speed edits rebase it before changing rate. */
export function mediaTime(config: MediaConfig, clock: ClockState, now: number) {
  const seconds = Math.max(0, (clock.elapsedMs + (clock.running ? Math.max(0, now - clock.startedAt) * config.playbackRate : 0)) / 1000);
  return config.duration > 0 ? config.loop ? seconds % config.duration : Math.min(seconds, config.duration) : 0;
}
export function mediaBounds(bounds: Bounds, config: MediaConfig): Bounds {
  if (config.fit !== 'contain') return bounds;
  const rotated = config.rotation === 90 || config.rotation === 270;
  const width = rotated ? config.height : config.width, height = rotated ? config.width : config.height;
  const scale = Math.min(bounds.w * WIDTH / width, bounds.h * HEIGHT / height);
  const w = width * scale / WIDTH, h = height * scale / HEIGHT;
  return { x: bounds.x + (bounds.w - w) / 2, y: bounds.y + (bounds.h - h) / 2, w, h };
}
