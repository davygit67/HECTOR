import type { Scene, Timer } from './domain.js';
import type { ContentInstance } from './content.js';

// Ordered alpha composition adapted from FREEkMapper's renderers.py.
// See THIRD_PARTY_NOTICES.md for the pinned upstream and MIT license.
export interface LayerSettings { order: number; visible: boolean; locked: boolean; opacity: number }
export type LayerItem = ContentInstance | Timer;
export type LayerDirection = 'up' | 'down' | 'front' | 'back';
export interface DisplaySettings { quality: 'fast' | 'balanced' | 'sharp'; brightness: number; blackout: boolean }
export const DISPLAY_DEFAULTS: DisplaySettings = { quality: 'balanced', brightness: 1, blackout: false };
export const layerVisible = (item: LayerItem) => item.layer?.visible !== false;
export const layerOpacity = (item: LayerItem) => item.layer?.opacity ?? 1;

/** Back to front, matching legacy art → panels → videos → timers until explicitly reordered. */
export function surfaceLayers(scene: Scene, surfaceId: string): LayerItem[] {
  const items: LayerItem[] = [
    ...scene.contents.filter(c => c.kind === 'art'),
    ...scene.contents.filter(c => c.kind !== 'art' && c.kind !== 'youtube'),
    ...scene.contents.filter(c => c.kind === 'youtube'), ...scene.timers,
  ].filter(item => item.surfaceId === surfaceId);
  return items.map((item, index) => ({ item, order: item.layer?.order ?? index, index }))
    .sort((a, b) => ('kind' in a.item && a.item.kind === 'art' ? -1 : 'kind' in b.item && b.item.kind === 'art' ? 1 : a.order - b.order || a.index - b.index)).map(({ item }) => item);
}
export function reorderLayer(scene: Scene, id: string, direction: LayerDirection) {
  if (!['up', 'down', 'front', 'back'].includes(direction)) throw new Error('Choose a layer direction.');
  const item = [...scene.contents, ...scene.timers].find(c => c.id === id);
  if (!item) throw new Error('That layer no longer exists.');
  if ('kind' in item && item.kind === 'art') throw new Error('Living art is the surface background. Reorder the foreground layers above it.');
  const items = surfaceLayers(scene, item.surfaceId), index = items.indexOf(item);
  const first = items.some(c => 'kind' in c && c.kind === 'art') ? 1 : 0;
  const target = direction === 'front' ? items.length - 1 : direction === 'back' ? first : Math.max(first, Math.min(items.length - 1, index + (direction === 'up' ? 1 : -1)));
  items.splice(index, 1); items.splice(target, 0, item);
  items.forEach((entry, order) => { entry.layer = { visible: true, locked: false, opacity: 1, ...entry.layer, order }; });
}
export function validateLayer(value: unknown, partial = false) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid layer settings.');
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some(k => !['order', 'visible', 'locked', 'opacity'].includes(k))) throw new Error('Unsupported layer setting.');
  if ((!partial || v.order !== undefined) && (!Number.isSafeInteger(v.order) || Math.abs(v.order as number) > 10000)) throw new Error('Invalid layer order.');
  for (const key of ['visible', 'locked']) if ((!partial || v[key] !== undefined) && typeof v[key] !== 'boolean') throw new Error('Invalid layer switch.');
  if ((!partial || v.opacity !== undefined) && (!Number.isFinite(v.opacity) || (v.opacity as number) < 0 || (v.opacity as number) > 1)) throw new Error('Opacity must be 0–100%.');
}
export function validateDisplay(value: unknown, partial = false): asserts value is DisplaySettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid display settings.');
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some(k => !['quality', 'brightness', 'blackout'].includes(k))) throw new Error('Unsupported display setting.');
  if ((!partial || v.quality !== undefined) && !['fast', 'balanced', 'sharp'].includes(v.quality as string)) throw new Error('Choose a render quality.');
  if ((!partial || v.brightness !== undefined) && (!Number.isFinite(v.brightness) || (v.brightness as number) < 0 || (v.brightness as number) > 2)) throw new Error('Output brightness must be 0–200%.');
  if ((!partial || v.blackout !== undefined) && typeof v.blackout !== 'boolean') throw new Error('Invalid blackout switch.');
}
export function renderWidth(scene: Scene, output = false) {
  const quality = scene.display?.quality ?? 'balanced';
  return quality === 'fast' ? (output ? 1280 : 640) : quality === 'sharp' ? 1920 : output ? 1920 : 960;
}
