import type { Source } from '../core/model';
import type { FrameTrace, MediaProbe, Snapshot, Transport } from '../core/bridge';
import { playerKey } from '../core/youtube';
interface FrameMeta { mediaTime: number; presentationTime: number; expectedDisplayTime: number; presentedFrames: number }
export interface MediaEntry {
  key: string; element: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement;
  dirty: boolean; error: string; lastSecond: number; disposed: boolean; revision: number;
  /** Creation counter: a changed value means the decoder/element was rebuilt. */
  generation: number;
  /** Latest configuration, read by delayed media events so they never apply stale settings. */
  source: Source; transport: Transport;
  /** Metadata of the newest decoded frame, from requestVideoFrameCallback. */
  meta: FrameMeta | null;
  /** Live capture stream owned by this entry (capture and YouTube sources). */
  stream: MediaStream | null;
  /** The YouTube player's own problem, kept apart from capture errors so a recovered player clears only its own. */
  playerProblem: string;
}
/** Why a YouTube player cannot feed this source, if it cannot. Loading and paused players are not errors. */
export function playerProblem(status: Snapshot['players'][string] | undefined) {
  if (status?.state === 'error') return status.error;
  if (status?.state === 'closed') return 'YouTube player closed. Reopen it in Media.';
  return '';
}
export function mediaIdentity(source: Source, url: string) { return `${source.kind}:${source.assetId ?? source.captureId ?? source.id}:${url}`; }
export const captureMessages = {
  missing: 'Capture not connected. Choose the screen or window again in Media.',
  ended: 'Capture ended: the window closed or sharing stopped. Choose the source again in Media.',
  denied: 'Screen capture was denied. On macOS, allow HECTOR under System Settings › Privacy & Security › Screen Recording, then restart HECTOR.',
  unavailable: 'The captured screen or window is no longer available. Choose a source again in Media.'
};
function captureError(error: unknown) {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return captureMessages.denied;
  if (['NotFoundError', 'NotReadableError', 'AbortError', 'OverconstrainedError'].includes(name)) return captureMessages.unavailable;
  return `Capture failed: ${error instanceof Error ? error.message : String(error)}`;
}
let generations = 0;
const traced = ['loadstart', 'emptied', 'abort', 'durationchange', 'loadedmetadata', 'seeking', 'seeked', 'waiting', 'playing', 'pause', 'play', 'ended'];
export class MediaRegistry {
  entries = new Map<string, MediaEntry>();
  /** Set by the renderer while a timing trace is recording. */
  trace: FrameTrace | null = null;
  /** arm + getDisplayMedia pairs must not interleave within one window. */
  private captureQueue: Promise<void> = Promise.resolve();
  constructor(private preview: boolean) {}
  reconcile(sources: Source[], assets: Snapshot['assets'], captures: Snapshot['captures'], transport: Transport, players: Snapshot['players'] = {}) {
    const wanted = new Set(sources.map(s => s.id));
    for (const [id, entry] of this.entries) if (!wanted.has(id)) { this.release(entry); this.entries.delete(id); }
    for (const source of sources) {
      if (!['video', 'image', 'clock', 'capture', 'youtube'].includes(source.kind)) continue;
      const asset = source.assetId ? assets[source.assetId] : undefined, player = source.kind === 'youtube' ? players[playerKey(source)] : undefined;
      // A YouTube entry is rebuilt whenever its player window (and so its capture) is replaced.
      const key = mediaIdentity(source, source.kind === 'youtube' ? `${playerKey(source)}#${player?.captureId ?? ''}` : asset?.url ?? '');
      let entry = this.entries.get(source.id);
      if (entry?.key !== key) {
        if (entry) this.release(entry);
        const element = source.kind === 'video' || source.kind === 'capture' || source.kind === 'youtube' ? document.createElement('video') : source.kind === 'image' ? new Image() : document.createElement('canvas');
        entry = { key, element, dirty: true, error: asset?.missing ? 'Missing file — relink in Media' : '', lastSecond: -1, disposed: false, revision: -1,
          generation: ++generations, source, transport, meta: null, stream: null, playerProblem: '' };
        this.entries.set(source.id, entry);
        const current = entry;
        if (element instanceof HTMLVideoElement) {
          // CORS mode keeps hector-media frames untainted so WebGL may upload them.
          element.crossOrigin = 'anonymous'; element.preload = 'auto'; element.playsInline = true;
          element.addEventListener('loadedmetadata', () => { current.revision = -1; this.configure(current); });
          element.addEventListener('error', () => { if (!current.disposed && !current.stream) current.error = 'Video unavailable or codec unsupported'; });
          for (const type of traced) element.addEventListener(type, () => this.trace?.events.push({ source: current.source.id, now: performance.now(), type }));
          const frame = (now: number, meta: VideoFrameCallbackMetadata) => {
            if (current.disposed) return;
            current.dirty = true;
            current.meta = { mediaTime: meta.mediaTime, presentationTime: meta.presentationTime, expectedDisplayTime: meta.expectedDisplayTime, presentedFrames: meta.presentedFrames };
            if (this.trace && this.trace.frames.length < 50000) this.trace.frames.push({ source: current.source.id, now, mediaTime: meta.mediaTime, presented: meta.presentedFrames,
              presentationTime: meta.presentationTime, expectedDisplayTime: meta.expectedDisplayTime });
            element.requestVideoFrameCallback(frame);
          };
          element.requestVideoFrameCallback(frame);
          if (source.kind === 'capture') {
            element.muted = true;
            if (!source.captureId || !captures[source.captureId]) current.error = captureMessages.missing;
            else { const captureId = source.captureId; this.captureQueue = this.captureQueue.then(() => this.startCapture(current, captureId)); }
          } else if (source.kind === 'youtube') {
            // The player window plays (and is heard) on its own; this element only shows its captured frames.
            element.muted = true;
            if (player?.captureId) { const captureId = player.captureId; this.captureQueue = this.captureQueue.then(() => this.startCapture(current, captureId)); }
          } else if (asset && !asset.missing) element.src = asset.url;
        } else if (element instanceof HTMLImageElement) {
          element.crossOrigin = 'anonymous'; element.onload = () => { current.dirty = true; };
          element.onerror = () => { if (!current.disposed) current.error = 'Image unavailable — relink in Media'; };
          if (asset && !asset.missing) element.src = asset.url;
        } else { element.width = 1024; element.height = 512; }
      }
      entry.source = source; entry.transport = transport;
      if (source.kind === 'youtube') {
        const problem = playerProblem(player);
        if (problem) entry.error = problem; else if (entry.error && entry.error === entry.playerProblem) entry.error = '';
        entry.playerProblem = problem;
      }
      this.configure(entry);
    }
  }
  private async startCapture(entry: MediaEntry, captureId: string) {
    if (entry.disposed || !window.hector) return;
    const video = entry.element as HTMLVideoElement;
    try {
      const armed = await window.hector.armCapture(captureId);
      if (!armed.ok) throw new Error(armed.error ?? captureMessages.unavailable);
      // The studio preview needs fewer frames than the projector output.
      const stream = await navigator.mediaDevices.getDisplayMedia({ audio: false, video: { frameRate: { ideal: this.preview ? 30 : 60, max: this.preview ? 30 : 60 } } });
      if (entry.disposed) { stream.getTracks().forEach(track => track.stop()); return; }
      entry.stream = stream;
      const track = stream.getVideoTracks()[0];
      if (!track || track.readyState === 'ended') throw new DOMException('Capture track ended', 'NotReadableError');
      track.addEventListener('ended', () => { if (!entry.disposed) { entry.error = captureMessages.ended; this.trace?.events.push({ source: entry.source.id, now: performance.now(), type: 'capture-ended' }); } });
      video.srcObject = stream; await video.play();
    } catch (error) {
      if (!entry.disposed) entry.error = error instanceof DOMException || !(error instanceof Error) ? captureError(error) : error.message;
    }
  }
  private configure(entry: MediaEntry) {
    const video = entry.element, { source, transport } = entry;
    if (!(video instanceof HTMLVideoElement) || entry.disposed || source.kind === 'capture' || source.kind === 'youtube') return;
    // Read before touching loop: enabling loop clears `ended`.
    const finished = video.ended;
    video.muted = this.preview || source.volume === 0; video.volume = source.volume; video.loop = source.loop;
    if (video.playbackRate !== source.speed) video.playbackRate = source.speed;
    // Re-enabling loop on a clip that already ended rejoins the shared transport clock.
    if (finished && source.loop && transport.playing) entry.revision = -1;
    if (entry.revision === transport.revision || video.readyState < 1) return;
    entry.revision = transport.revision;
    const time = Math.max(0, transport.position + (transport.playing ? (Date.now() - transport.anchor) / 1000 : 0)) * source.speed;
    if (Number.isFinite(video.duration) && video.duration > 0) {
      const target = source.loop ? time % video.duration : Math.min(time, video.duration);
      this.trace?.events.push({ source: source.id, now: performance.now(), type: `seek-to:${target.toFixed(3)}` });
      video.currentTime = target;
    }
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
      const video = e.element instanceof HTMLVideoElement ? e.element : null, quality = video?.getVideoPlaybackQuality();
      const track = e.stream?.getVideoTracks()[0];
      return { sourceId, kind: e.source.kind, generation: e.generation, error: e.error,
        currentTime: video?.currentTime ?? null, duration: video && Number.isFinite(video.duration) ? video.duration : null, paused: video?.paused ?? null, ended: video?.ended ?? null,
        readyState: video?.readyState ?? null, playbackRate: video?.playbackRate ?? null, loop: video?.loop ?? null, muted: video?.muted ?? null, volume: video?.volume ?? null,
        droppedFrames: quality?.droppedVideoFrames ?? null, totalFrames: quality?.totalVideoFrames ?? null,
        width: video?.videoWidth ?? (e.element instanceof HTMLImageElement ? e.element.naturalWidth : e.element.width),
        height: video?.videoHeight ?? (e.element instanceof HTMLImageElement ? e.element.naturalHeight : e.element.height),
        live: track ? track.readyState === 'live' : null };
    });
  }
  private release(entry: MediaEntry) {
    entry.disposed = true;
    entry.stream?.getTracks().forEach(track => track.stop()); entry.stream = null;
    if (entry.element instanceof HTMLVideoElement) { entry.element.pause(); entry.element.srcObject = null; entry.element.removeAttribute('src'); entry.element.load(); }
    if (entry.element instanceof HTMLImageElement) entry.element.src = '';
  }
  dispose() { for (const entry of this.entries.values()) this.release(entry); this.entries.clear(); }
}
