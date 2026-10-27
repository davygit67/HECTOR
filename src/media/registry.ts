import type { Source } from '../core/model';
import type { MediaProbe, Snapshot, Transport } from '../core/bridge';
export interface MediaEntry {
  key: string; element: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement;
  dirty: boolean; error: string; lastSecond: number; disposed: boolean; revision: number;
  /** Creation counter: a changed value means the decoder/element was rebuilt. */
  generation: number;
  /** Latest configuration, read by delayed media events so they never apply stale settings. */
  source: Source; transport: Transport;
}
export function mediaIdentity(source: Source, url: string) { return `${source.kind}:${source.assetId ?? source.id}:${url}`; }
let generations = 0;
export class MediaRegistry {
  entries = new Map<string, MediaEntry>();
  constructor(private muted: boolean) {}
  reconcile(sources: Source[], assets: Snapshot['assets'], transport: Transport) {
    const wanted = new Set(sources.map(s => s.id));
    for (const [id, entry] of this.entries) if (!wanted.has(id)) { this.release(entry); this.entries.delete(id); }
    for (const source of sources) {
      if (!['video', 'image', 'clock'].includes(source.kind)) continue;
      const asset = source.assetId ? assets[source.assetId] : undefined;
      const key = mediaIdentity(source, asset?.url ?? '');
      let entry = this.entries.get(source.id);
      if (entry?.key !== key) {
        if (entry) this.release(entry);
        const element = source.kind === 'video' ? document.createElement('video') : source.kind === 'image' ? new Image() : document.createElement('canvas');
        entry = { key, element, dirty: true, error: asset?.missing ? 'Missing file — relink in Media' : '', lastSecond: -1, disposed: false, revision: -1, generation: ++generations, source, transport };
        this.entries.set(source.id, entry);
        const current = entry;
        if (element instanceof HTMLVideoElement) {
          // CORS mode keeps hector-media frames untainted so WebGL may upload them.
          element.crossOrigin = 'anonymous'; element.preload = 'auto'; element.playsInline = true;
          element.addEventListener('loadedmetadata', () => { current.revision = -1; this.configure(current); });
          element.addEventListener('error', () => { if (!current.disposed) current.error = 'Video unavailable or codec unsupported'; });
          const frame = () => { if (current.disposed) return; current.dirty = true; element.requestVideoFrameCallback(frame); };
          element.requestVideoFrameCallback(frame);
          if (asset && !asset.missing) element.src = asset.url;
        } else if (element instanceof HTMLImageElement) {
          element.crossOrigin = 'anonymous'; element.onload = () => { current.dirty = true; }; element.onerror = () => { if (!current.disposed) current.error = 'Image unavailable — relink in Media'; };
          if (asset && !asset.missing) element.src = asset.url;
        } else { element.width = 1024; element.height = 512; }
      }
      entry.source = source; entry.transport = transport;
      this.configure(entry);
    }
  }
  private configure(entry: MediaEntry) {
    const video = entry.element, { source, transport } = entry;
    if (!(video instanceof HTMLVideoElement) || entry.disposed) return;
    video.muted = this.muted || source.volume === 0; video.volume = source.volume; video.loop = source.loop;
    if (video.playbackRate !== source.speed) video.playbackRate = source.speed;
    if (entry.revision === transport.revision || video.readyState < 1) return;
    entry.revision = transport.revision;
    const time = Math.max(0, transport.position + (transport.playing ? (Date.now() - transport.anchor) / 1000 : 0)) * source.speed;
    if (Number.isFinite(video.duration) && video.duration > 0) video.currentTime = source.loop ? time % video.duration : Math.min(time, video.duration);
    if (transport.playing) void video.play().catch(() => { if (!entry.disposed) entry.error = 'Playback blocked — press Play again'; }); else video.pause();
  }
  updateClock(entry: MediaEntry, source: Source, time: number) {
    if (!(entry.element instanceof HTMLCanvasElement) || Math.floor(time) === entry.lastSecond) return;
    entry.lastSecond = Math.floor(time); const ctx = entry.element.getContext('2d')!;
    ctx.fillStyle = '#090a12'; ctx.fillRect(0, 0, 1024, 512);
    ctx.fillStyle = source.color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '600 148px monospace';
    const seconds = Math.floor(time); ctx.fillText(`${String(Math.floor(seconds / 60)).padStart(2,'0')}:${String(seconds % 60).padStart(2,'0')}`, 512, 256); entry.dirty = true;
  }
  probe(): MediaProbe[] {
    return [...this.entries].map(([sourceId, e]) => {
      const video = e.element instanceof HTMLVideoElement ? e.element : null;
      return { sourceId, kind: e.source.kind, generation: e.generation, error: e.error, currentTime: video?.currentTime ?? null, paused: video?.paused ?? null,
        readyState: video?.readyState ?? null, droppedFrames: video ? video.getVideoPlaybackQuality().droppedVideoFrames : null };
    });
  }
  private release(entry: MediaEntry) {
    entry.disposed = true;
    if (entry.element instanceof HTMLVideoElement) { entry.element.pause(); entry.element.removeAttribute('src'); entry.element.load(); }
    if (entry.element instanceof HTMLImageElement) entry.element.src = '';
  }
  dispose() { for (const entry of this.entries.values()) this.release(entry); this.entries.clear(); }
}
