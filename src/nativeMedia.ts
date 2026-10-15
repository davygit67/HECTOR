import { FULL_PICTURE, validPicture, type ActivePicture } from './shared/activePicture';
import type { MediaBridge, MediaEvent, MediaFrame, MediaState } from './shared/media';
import { clearBacklight, updateBacklight } from './backlightField';
import type { Scene } from './shared/domain';

declare global { interface Window { projectionMedia?: MediaBridge } }
const states = new Map<string, MediaState>();
const images = new Map<string, { generation: number; sequence: number; bitmap: ImageBitmap; picture: ActivePicture; revision: number }>();
const pending = new Map<string, MediaFrame>();
const decoding = new Set<string>();
const receivedAt = new Map<string, number>();
const samples = new Map<string, MediaFrame['sample']>();
const settings = new Map<string, { enabled: boolean; smoothing: number }>();
const listeners = new Set<() => void>();
let revision = 0, connectionError = '';
export const mediaError = () => connectionError;
export function reportMediaError(message: string) { connectionError = message; changed(); }
function changed(notifyControls = true) { revision++; if (notifyControls) listeners.forEach(fn => fn()); }
export const mediaRevision = (id?: string) => id === undefined ? revision : images.get(id)?.revision ?? 0;
export const readMediaState = (id: string) => states.get(id);
export const subscribeMedia = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export function readMediaImage(id: string) { return images.get(id)?.bitmap; }
export function readMediaPicture(id: string): ActivePicture { return images.get(id)?.picture ?? FULL_PICTURE; }
function clear(id: string) {
  images.get(id)?.bitmap.close(); images.delete(id); pending.delete(id); samples.delete(id); receivedAt.delete(id); clearBacklight(id);
}
async function decode(id: string) {
  if (decoding.has(id)) return;
  decoding.add(id);
  try {
    while (pending.has(id)) {
      const frame = pending.get(id)!; pending.delete(id);
      const bitmap = await createImageBitmap(new Blob([new Uint8Array(frame.jpeg)], { type: 'image/jpeg' }));
      const state = states.get(id), previous = images.get(id);
      if (!state || (state.source === 'youtube-watch' && !state.ready) || state.generation !== frame.generation || (previous && previous.sequence >= frame.sequence)) { bitmap.close(); continue; }
      previous?.bitmap.close(); images.set(id, { bitmap, sequence: frame.sequence, generation: frame.generation, picture: validPicture(frame.sample.picture), revision: revision + 1 });
      const previousSample = samples.get(id);
      samples.set(id, frame.sample);
      // Publish geometry and edge colors in the same turn as the decoded image.
      const config = settings.get(id);
      if (state.ready && state.hasPlayed && config?.enabled && frame.sample.sampledAt !== previousSample?.sampledAt) updateBacklight(id, frame.sample, config.smoothing);
      changed(false);
    }
  } finally { decoding.delete(id); }
}
function receive(event: MediaEvent) {
  connectionError = '';
  if (event.type === 'removed') { clear(event.contentId); states.delete(event.contentId); changed(); }
  else if (event.type === 'state') {
    const previous = states.get(event.state.contentId);
    if (previous && previous.generation > event.state.generation) return;
    if (previous?.generation !== event.state.generation || (event.state.source === 'youtube-watch' && !event.state.ready)) clear(event.state.contentId);
    states.set(event.state.contentId, event.state); receivedAt.set(event.state.contentId, Date.now()); changed();
  } else {
    const state = states.get(event.frame.contentId);
    if (!state || state.generation !== event.frame.generation) return;
    pending.set(event.frame.contentId, event.frame);
    void decode(event.frame.contentId).catch(() => { samples.delete(event.frame.contentId); clearBacklight(event.frame.contentId); });
  }
}
export function configureMedia(scene: Scene) {
  settings.clear();
  for (const c of scene.contents) if (c.kind === 'youtube') settings.set(c.id, { enabled: c.config.backlight && c.layer?.visible !== false && c.layer?.opacity !== 0, smoothing: c.config.backlightSettings?.smoothingMs ?? 180 });
}
export function startNativeMedia() {
  const bridge = window.projectionMedia; if (!bridge) return () => {};
  let warming = true, disposed = false;
  const queued: MediaEvent[] = [];
  const stop = bridge.subscribe(event => { if (warming) queued.push(event); else receive(event); });
  void bridge.snapshot().then(events => {
    if (disposed) return;
    events.forEach(receive); queued.forEach(receive); queued.length = 0; warming = false;
  }).catch(error => { if (!disposed) { queued.forEach(receive); queued.length = 0; warming = false; reportMediaError(error instanceof Error ? error.message : 'Video renderer could not connect. Try Restart video renderer.'); } });
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [id, sample] of samples) {
      const state = states.get(id), config = settings.get(id);
      // Offscreen sources emit only changed pixels. A live source heartbeat keeps
      // an unchanged/paused frame valid; a stalled renderer loses its light.
      if (!state?.ready || !state.hasPlayed || !config?.enabled || now - (receivedAt.get(id) ?? 0) > 3500) { clearBacklight(id); continue; }
      updateBacklight(id, { ...sample, sampledAt: now }, config.smoothing);
    }
  }, 33);
  return () => { disposed = true; clearInterval(timer); stop(); for (const id of states.keys()) clear(id); states.clear(); };
}
