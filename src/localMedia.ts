import type { MediaContent } from './shared/content';
import type { Scene } from './shared/domain';
import { MEDIA_DEFAULTS, mediaTime, type MediaConfig } from './shared/mediaContent';

declare global {
  interface Window {
    projectionAssets?: {
      store(file: File, mimeType: string): Promise<string>;
      resolve(id: string): Promise<string>;
      remove(id: string): Promise<void>;
    };
  }
}

// FREEkMapper video_source.py separates decoding from rendering and keeps the latest
// frame. Here the browser decoder provides that frame directly, without JPEG/readback.
let database: Promise<IDBDatabase> | undefined;
function db() {
  return database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('projection-mapper-media-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('assets');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = undefined; reject(new Error('Local media storage is unavailable.')); };
  });
}
async function assetTransaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('assets', mode), request = action(transaction.objectStore('assets'));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = transaction.onabort = () => reject(new Error('Could not save or read this file. Check available storage.'));
  });
}
export const removeMediaAsset = (id: string) => window.projectionAssets?.remove(id) ?? assetTransaction('readwrite', store => store.delete(id));
export async function importMedia(file: File): Promise<MediaConfig> {
  if (!file.size || file.size > 2 * 1024 ** 3) throw new Error('Choose a nonempty video or image smaller than 2 GB.');
  const mediaType = file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name) ? 'image' : 'video';
  if (mediaType === 'video' && !file.type.startsWith('video/') && !/\.(mp4|webm|mov|m4v|ogv|mkv)$/i.test(file.name)) throw new Error('Choose a video or image file.');
  const url = URL.createObjectURL(file);
  const element = mediaType === 'video' ? document.createElement('video') : new Image();
  let dimensions: { width: number; height: number; duration: number };
  try {
    dimensions = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('The file did not load. Try an MP4/H.264 or WebM video, or PNG/JPEG image.')), 15000);
      const fail = () => { clearTimeout(timeout); reject(new Error('This file or codec cannot be decoded here. Try MP4/H.264, WebM, PNG or JPEG.')); };
      element.onerror = fail;
      if (element instanceof HTMLVideoElement) {
        element.muted = true; element.preload = 'auto'; element.playsInline = true;
        element.onloadeddata = () => {
          clearTimeout(timeout);
          if (!element.videoWidth || !Number.isFinite(element.duration) || element.duration <= 0 || element.duration > 604800) { fail(); return; }
          resolve({ width: element.videoWidth, height: element.videoHeight, duration: element.duration });
        };
      } else element.onload = () => { clearTimeout(timeout); resolve({ width: element.naturalWidth, height: element.naturalHeight, duration: 0 }); };
      element.src = url;
    });
  } finally {
    if (element instanceof HTMLVideoElement) { element.pause(); element.removeAttribute('src'); element.load(); }
    URL.revokeObjectURL(url);
  }
  if (dimensions.width > 32768 || dimensions.height > 32768) throw new Error('This media exceeds the supported dimensions.');
  const fallbackMime: Record<string, string> = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', ogv: 'video/ogg', mkv: 'video/x-matroska', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp' };
  const mimeType = file.type.startsWith(mediaType + '/') ? file.type : fallbackMime[file.name.split('.').pop()?.toLowerCase() ?? ''] || `${mediaType}/unknown`;
  const assetId = window.projectionAssets ? await window.projectionAssets.store(file, mimeType) : crypto.randomUUID();
  if (!window.projectionAssets) await assetTransaction('readwrite', store => store.put(file, assetId));
  return { ...MEDIA_DEFAULTS, ...dimensions, assetId, mediaType, fileName: file.name.slice(0, 255), mimeType };
}

interface Source {
  content: MediaContent; element: HTMLVideoElement | HTMLImageElement; url?: string;
  ready: boolean; error: string; revision: number; frame?: number; clockKey: string;
  audioEnabled: boolean; playPending: boolean;
}
const sources = new Map<string, Source>();
let revision = 0;
const listeners = new Set<() => void>();
const changed = (source: Source, controls = false) => { source.revision++; revision++; if (controls) listeners.forEach(fn => fn()); };
export const localMediaRevision = () => revision;
export const localMediaSource = (id: string) => sources.get(id);
export const subscribeLocalMedia = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export function enableMediaAudio(id: string) { const source = sources.get(id); if (source) source.audioEnabled = true; }
function dispose(source: Source) {
  source.element.onerror = null;
  if (source.element instanceof HTMLVideoElement) {
    source.element.onloadeddata = null; source.element.onseeked = null; source.element.onended = null; source.element.ontimeupdate = null;
    source.element.pause();
    if (source.frame !== undefined) source.element.cancelVideoFrameCallback?.(source.frame);
    source.element.removeAttribute('src'); source.element.load();
  } else source.element.onload = null;
  if (source.url?.startsWith('blob:')) URL.revokeObjectURL(source.url);
}
function sync(source: Source) {
  const video = source.element;
  if (!(video instanceof HTMLVideoElement) || !source.ready) return;
  const content = source.content, config = content.config;
  video.loop = config.loop; video.playbackRate = config.playbackRate; video.volume = config.volume;
  video.muted = config.muted || !source.audioEnabled || new URLSearchParams(location.search).get('view') === 'output';
  const desired = mediaTime(config, content.state.clock, Date.now());
  const clockKey = JSON.stringify([content.state.clock, config.playbackRate, config.loop]);
  if (clockKey !== source.clockKey || Math.abs(video.currentTime - desired) > .5) {
    if (!video.seeking && Math.abs(video.currentTime - desired) > .04) video.currentTime = desired;
    source.clockKey = clockKey;
  }
  const playing = content.state.clock.running && (config.loop || desired < config.duration);
  if (!playing) { video.pause(); source.error = ''; }
  else if (video.paused && !source.playPending && !source.error) {
    source.playPending = true;
    void video.play().catch(() => { source.error = 'Playback was blocked. Click Play again; keep sound muted if your browser requires it.'; changed(source, true); }).finally(() => { source.playPending = false; });
  }
}
function createSource(content: MediaContent) {
  const element = content.config.mediaType === 'video' ? document.createElement('video') : new Image();
  const source: Source = { content, element, ready: false, error: '', revision: 0, clockKey: '', audioEnabled: false, playPending: false };
  sources.set(content.id, source);
  element.onerror = () => { source.ready = false; source.error = 'The stored file cannot be decoded. Replace it with a supported video or image.'; changed(source, true); };
  const ready = () => { if (sources.get(content.id) !== source) return; source.ready = true; changed(source, true); sync(source); };
  if (element instanceof HTMLVideoElement) {
    element.muted = true; element.playsInline = true; element.preload = 'auto';
    element.onloadeddata = ready; element.onseeked = () => changed(source);
    element.onended = () => changed(source, true);
    if (element.requestVideoFrameCallback) {
      const frame = () => { if (sources.get(content.id) !== source) return; changed(source); source.frame = element.requestVideoFrameCallback(frame); };
      source.frame = element.requestVideoFrameCallback(frame);
    } else element.ontimeupdate = () => changed(source);
  } else element.onload = ready;
  const load = window.projectionAssets
    ? window.projectionAssets.resolve(content.config.assetId)
    : assetTransaction<Blob | undefined>('readonly', store => store.get(content.config.assetId)).then(blob => {
      if (!blob) throw new Error('The local file is missing in this browser. Use Replace file to relink it.');
      return blob;
    });
  void load.then(asset => {
    if (sources.get(content.id) !== source) return;
    source.url = typeof asset === 'string' ? asset : URL.createObjectURL(asset); element.src = source.url;
  }).catch(error => { if (sources.get(content.id) === source) { source.error = String(error.message); changed(source, true); } });
}
/** One decoder per content in each window; entering fullscreen does not replace it. */
export function configureLocalMedia(scene: Scene) {
  const media = scene.contents.filter((c): c is MediaContent => c.kind === 'media');
  for (const [id, source] of sources) if (!media.some(c => c.id === id && c.config.assetId === source.content.config.assetId)) { sources.delete(id); dispose(source); revision++; }
  for (const content of media) {
    const source = sources.get(content.id);
    if (!source) createSource(content);
    else { if (source.content.state.clock.startedAt !== content.state.clock.startedAt) source.error = ''; source.content = content; sync(source); }
  }
}
