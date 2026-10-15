import type { Scene } from './domain.js';

const keys = new WeakMap<Scene, { plain: string; timers: string }>();
/** Alignment, selection and output routing do not change the pixels painted on a surface. */
export function artworkSceneKey(scene: Scene, withTimers: boolean): string {
  let cached = keys.get(scene);
  if (!cached) {
    const plain = JSON.stringify([scene.geometryRevision, scene.contents]);
    cached = { plain, timers: plain + JSON.stringify(scene.timers) }; keys.set(scene, cached);
  }
  return withTimers ? cached.timers : cached.plain;
}
/** Sync identity and whether analysis is needed, never corner movement. Updating
 * analysis demand retains the existing player/clock in MediaSources.sync. */
export function mediaSourceKey(scene: Scene): string {
  return JSON.stringify(scene.contents.filter(c => c.kind === 'youtube').map(c => [c.id, c.config.videoId, c.config.startSeconds, c.config.backlight && c.layer?.visible !== false && c.layer?.opacity !== 0]));
}
