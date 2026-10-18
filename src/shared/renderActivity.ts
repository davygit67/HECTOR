import { remaining, type Scene } from './domain.js';
import { layerVisible, layerOpacity } from './layers.js';

interface Revisions {
  program?(id: string): number;
  media(id: string): number;
  local(id: string): number;
  light(id: string): { revision: number; alpha: number };
}
/** Per-surface frame dependencies. A changed video must not repaint every other
 * surface, and an idle timer/backlight must not trigger texture uploads. */
export function surfaceFrameKey(scene: Scene, surfaceId: string, now: number, withTimers: boolean, backgroundOnly: boolean, revisions: Revisions) {
  const visible = scene.contents.filter(c => c.surfaceId === surfaceId && layerVisible(c) && layerOpacity(c) > 0);
  const art = scene.contents.find(c => c.surfaceId === surfaceId && c.kind === 'art' && layerVisible(c));
  const animated = art?.kind === 'art' && layerOpacity(art) > 0 && art.state.clock.running;
  const timerRunning = !backgroundOnly && withTimers && scene.timers.some(t => t.surfaceId === surfaceId && layerVisible(t) && layerOpacity(t) > 0 && t.status === 'running' && remaining(t, now) > 0);
  const foreground = backgroundOnly ? '' : visible.map(c => c.kind === 'program' ? `${c.id}:${revisions.program?.(c.id) ?? 0}` : c.kind === 'youtube' ? `${c.id}:${revisions.media(c.id)}` : c.kind === 'media' ? `${c.id}:${revisions.local(c.id)}` : '').join('|');
  const lights = scene.contents.filter(c => c.kind === 'youtube' && c.config.backlight && layerVisible(c) && layerOpacity(c) > 0 && (c.surfaceId === surfaceId || (c.config.backlightSettings?.roomFill ?? 0) > 0))
    .map(c => { const light = revisions.light(c.id); return `${c.id}:${light.revision}:${Math.round(light.alpha * 1000)}`; }).join('|');
  return `${foreground}/${lights}/${animated ? Math.floor(now / 50) : timerRunning ? Math.floor(now / 200) : 0}`;
}
