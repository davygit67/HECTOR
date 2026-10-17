import { BrowserWindow, type NativeImage, type WebContents } from 'electron';
import { dirname, join } from 'node:path';
import type { Scene } from '../src/shared/domain.js';
import type { YouTubeContent } from '../src/shared/content.js';
import { bitmapFrameRate, MediaFrameProcessor, type FrameProcessingTiming } from './media-frame-processor.js';
import { validateMediaInput, validateMediaCommand, sourceStartupProblem, type MediaCommand, type MediaEvent, type MediaFrame, type MediaState } from '../src/shared/media.js';
import { allowedWatchNavigation, readPlayerRegion, watchVideoId, youtubeWatchUrl, type PlayerRegion } from './youtube-watch-policy.js';

interface Source { playbackAllowed: boolean; pendingNextUntil: number; resumeAfterNavigation: boolean; openedAt: number; lastReport: number; readyAt: number; failed: boolean; analysisPending: boolean; watchdog?: ReturnType<typeof setInterval>; captureTimer?: ReturnType<typeof setTimeout>; region?: PlayerRegion; win: BrowserWindow; content: YouTubeContent; key: string; state: MediaState; frame?: MediaFrame; sequence: number; lastPaint: number; processor: MediaFrameProcessor }
interface MediaSourceOptions { targetFps?: 30 | 60; canProcessFrame?: () => boolean; onFrameTiming?: (contentId: string, timing: FrameProcessingTiming) => void;
  /** Retained only for the local iframe/canvas integration fixtures. */
  sourceMode?: 'embedded-fixture' | 'youtube-watch';
}
export const sourceKey = (c: YouTubeContent) => c.config.videoId + ':' + c.config.startSeconds;
const lightEnabled = (c: YouTubeContent) => c.config.backlight && c.layer?.visible !== false && c.layer?.opacity !== 0;
/** One isolated, silent source per asset, shared by every view/output. No OS capture. */
export class MediaSources {
  private sources = new Map<string, Source>();
  private generation = Date.now();
  private get watch() { return this.options.sourceMode !== 'embedded-fixture'; }
  constructor(private origin: string, private preload: string, private emit: (event: MediaEvent) => void, private options: MediaSourceOptions = {}) {}
  sync(scene: Scene) {
    const contents = scene.contents.filter((c): c is YouTubeContent => c.kind === 'youtube');
    for (const [id, source] of this.sources) if (!contents.some(c => c.id === id)) this.remove(id, source);
    for (const c of contents) {
      const source = this.sources.get(c.id);
      if (source && source.key === sourceKey(c)) {
        const changed = lightEnabled(source.content) !== lightEnabled(c);
        source.content = c;
        if (changed) { source.analysisPending = true; if (!this.watch) source.win.webContents.invalidate(); }
        continue;
      }
      if (source) this.remove(c.id, source);
      this.open(c);
    }
  }
  private open(content: YouTubeContent, currentVideoId = content.config.videoId, autoplayNext = false) {
    const win = new BrowserWindow({ width: 1920, height: 1080, useContentSize: true, show: false, backgroundColor: '#000000',
      title: 'YouTube · Projection Mapper', autoHideMenuBar: true,
      webPreferences: { preload: this.watch ? join(dirname(this.preload), 'youtube-watch-preload.cjs') : this.preload, sandbox: true, contextIsolation: true, nodeIntegration: false,
        additionalArguments: [`--projection-video=${currentVideoId}`, `--projection-start=${currentVideoId === content.config.videoId ? content.config.startSeconds : 0}`],
        offscreen: !this.watch, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required', partition: 'persist:projection-media', zoomFactor: 1 } });
    win.webContents.setAudioMuted(true); // Set before navigation: ads/errors/early frames cannot emit sound.
    if (!this.watch) win.webContents.setFrameRate(this.options.targetFps ?? bitmapFrameRate());
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    const navigation = (event: Electron.Event, url: string) => { if (!this.watch || !allowedWatchNavigation(url)) event.preventDefault(); };
    win.webContents.on('will-navigate', navigation);
    win.webContents.on('will-redirect', navigation);
    win.webContents.on('will-attach-webview', event => event.preventDefault());
    win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    win.webContents.session.setPermissionCheckHandler(() => false);
    const source: Source = { playbackAllowed: false, pendingNextUntil: 0, resumeAfterNavigation: false, openedAt: Date.now(), lastReport: 0, readyAt: 0, failed: false, analysisPending: false, win, content, key: sourceKey(content), sequence: 0, lastPaint: 0, processor: new MediaFrameProcessor(),
      state: { contentId: content.id, generation: ++this.generation, ready: false, playing: false, hasPlayed: false, muted: true, status: this.watch ? 'Loading YouTube watch page…' : 'Loading YouTube…', currentTime: 0, duration: 0,
        ...(this.watch ? { source: 'youtube-watch' as const, sourceBrowserOpen: false, currentVideoId, autoplayNext, canGoNext: false, canSkipAd: false, adPlaying: false } : {}) } };
    this.sources.set(content.id, source); this.emit({ type: 'state', state: source.state });
    source.watchdog = setInterval(() => {
      const problem = sourceStartupProblem({ ...source, ready: source.state.ready, hasFrame: !!source.frame }, Date.now());
      if (problem && !source.failed) this.reportError(source, problem);
      // A paused frame still needs a second observation to settle a new matte.
      if (!this.watch && !source.failed && source.state.ready && (source.analysisPending || source.processor.settling()) && Date.now() - source.lastPaint > 300) source.win.webContents.invalidate();
    }, 1000);
    win.webContents.on('preload-error', () => this.reportError(source, 'Video player could not initialize. Try Restart video renderer.'));
    if (!this.watch) win.webContents.on('paint', (_event, _dirty, image) => this.frame(source, image));
    else {
      // A normal browser window can be opened for account/consent/player controls.
      // Capture only its player, never an account page or the user's desktop.
      win.on('close', event => { if (this.sources.get(content.id) === source) { event.preventDefault(); this.showBrowser(source, false); } });
      win.webContents.on('did-start-navigation', (_event, url, inPlace, mainFrame) => {
        if (mainFrame && !inPlace) {
          source.resumeAfterNavigation = !!watchVideoId(url) && (source.pendingNextUntil > Date.now() || (source.playbackAllowed && !!source.state.autoplayNext));
          source.pendingNextUntil = 0;
          source.region = undefined; source.frame = undefined; source.failed = false;
          source.openedAt = Date.now(); source.lastReport = 0; source.readyAt = 0; source.processor = new MediaFrameProcessor();
          if (!source.resumeAfterNavigation) win.webContents.setAudioMuted(true);
          source.state = { ...source.state, generation: ++this.generation, ready: false, playing: false, hasPlayed: false, muted: source.resumeAfterNavigation ? source.state.muted : true, canGoNext: false, canSkipAd: false, adPlaying: false, controlNotice: '', status: 'Loading YouTube watch page…' };
          this.emit({ type: 'state', state: source.state });
        }
      });
      win.webContents.on('did-finish-load', () => {
        win.webContents.send('media:source-command', { action: 'session', autoplayNext: !!source.state.autoplayNext, muted: source.state.muted, allowPlay: source.resumeAfterNavigation });
        win.webContents.send('media:source-command', { action: 'source-view', open: !!source.state.sourceBrowserOpen });
        source.resumeAfterNavigation = false;
      });
      this.capture(source);
    }
    win.webContents.on('render-process-gone', () => this.reportError(source, 'Video source stopped. Reload video to retry.'));
    win.webContents.on('did-fail-load', (_event, _code, description, _url, main) => { if (main) this.reportError(source, 'Video source failed to load: ' + description); });
    void win.loadURL(this.watch ? youtubeWatchUrl(currentVideoId, currentVideoId === content.config.videoId ? content.config.startSeconds : 0) : this.origin + '/?view=source&video=' + encodeURIComponent(content.config.videoId) + '&start=' + content.config.startSeconds).catch(() => {});
  }
  private frame(source: Source, image: NativeImage) {
    if (this.sources.get(source.content.id) !== source || source.failed || image.isEmpty() || this.options.canProcessFrame?.() === false) return;
    const now = Date.now(); source.lastPaint = now;
    try {
      const { jpeg, sample, timing } = source.processor.process(image, lightEnabled(source.content), now);
      source.analysisPending = false;
      source.frame = { contentId: source.content.id, generation: source.state.generation, sequence: ++source.sequence, width: 1920, height: 1080, jpeg, sample };
      this.options.onFrameTiming?.(source.content.id, timing);
      this.emit({ type: 'frame', frame: source.frame });
    } catch { this.reportError(source, 'Video frame rendering failed. Reload video to retry.'); }
  }
  private capture(source: Source) {
    const run = async () => {
      if (this.sources.get(source.content.id) !== source || source.win.isDestroyed()) return;
      const began = Date.now(), region = source.region, generation = source.state.generation;
      try {
        const [width, height] = source.win.getContentSize();
        if (!source.failed && source.state.ready && region && width === region.viewportWidth && height === region.viewportHeight && this.options.canProcessFrame?.() !== false) {
          const image = await source.win.webContents.capturePage({ x: region.x, y: region.y, width: region.width, height: region.height }, { stayHidden: true, stayAwake: true });
          if (source.state.ready && source.state.generation === generation && JSON.stringify(region) === JSON.stringify(source.region)) this.frame(source, image);
        }
      } catch {
        // Navigation may dispose the frame while a capture is in flight. Its
        // failure belongs to the old document, not the newly loading player.
        if (!source.win.isDestroyed() && source.state.ready && source.state.generation === generation && JSON.stringify(region) === JSON.stringify(source.region)) this.reportError(source, 'YouTube picture capture stopped. Reload video to retry.');
      }
      // One capture in flight, bounded cadence, and no CPU encoding while the
      // receiver is congested. Paused sources need only occasional observations.
      if (this.sources.get(source.content.id) === source) {
        const interval = source.state.playing ? 1000 / (this.options.targetFps ?? bitmapFrameRate()) : 250;
        source.captureTimer = setTimeout(run, Math.max(1, interval - (Date.now() - began)));
      }
    };
    source.captureTimer = setTimeout(run, 0);
  }
  private showBrowser(source: Source, open: boolean) {
    source.region = undefined;
    source.state = { ...source.state, sourceBrowserOpen: open };
    source.win.webContents.send('media:source-command', { action: 'source-view', open });
    if (open) { source.win.show(); source.win.focus(); }
    else {
      source.win.hide(); source.win.setContentSize(1920, 1080);
      if (!watchVideoId(source.win.webContents.getURL())) {
        const id = source.state.currentVideoId || source.content.config.videoId;
        void source.win.loadURL(youtubeWatchUrl(id, id === source.content.config.videoId ? source.content.config.startSeconds : 0)).catch(() => {});
      }
    }
    this.emit({ type: 'state', state: source.state });
  }
  private reportError(source: Source, status: string) {
    if (this.watch && !source.win.isDestroyed()) console.error('YouTube source diagnostic', JSON.stringify({ status, viewport: source.win.getContentSize(), region: source.region, lastFrameAt: source.lastPaint, receiverBusy: this.options.canProcessFrame?.() === false }));
    source.failed = true;
    source.state = { ...source.state, ready: false, playing: false, status }; source.frame = undefined;
    this.emit({ type: 'state', state: source.state });
  }
  report(sender: WebContents, mainFrame: boolean, value: unknown) {
    const source = [...this.sources.values()].find(s => s.win.webContents === sender);
    if (!source || source.failed || !mainFrame || !value || typeof value !== 'object') return;
    const r = value as Record<string, unknown>;
    if (typeof r.ready !== 'boolean' || typeof r.playing !== 'boolean' || typeof r.hasPlayed !== 'boolean' || typeof r.status !== 'string' || r.status.length > 300) return;
    if (typeof r.currentTime !== 'number' || !Number.isFinite(r.currentTime) || r.currentTime < 0 || typeof r.duration !== 'number' || !Number.isFinite(r.duration) || r.duration < 0) return;
    if (this.watch) {
      if (!allowedWatchNavigation(sender.getURL())) return;
      source.region = r.ready ? readPlayerRegion(r.region) : undefined;
      if (r.ready && !source.region) return;
      if (!r.ready) source.frame = undefined;
      const id = watchVideoId(sender.getURL());
      if (id && id !== source.state.currentVideoId) {
        source.frame = undefined; source.processor = new MediaFrameProcessor(); source.readyAt = 0; source.openedAt = Date.now();
        source.state = { ...source.state, generation: ++this.generation, currentVideoId: id };
        source.pendingNextUntil = 0;
        if (r.muted === true && r.allowPlay === false && !source.state.muted) { sender.setAudioMuted(true); source.state = { ...source.state, muted: true }; }
      }
      source.playbackAllowed = r.allowPlay === true;
      source.state = { ...source.state,
        currentTitle: typeof r.currentTitle === 'string' ? r.currentTitle.slice(0, 200) : undefined,
        canGoNext: r.canGoNext === true, adPlaying: r.adPlaying === true, canSkipAd: r.adPlaying === true && r.canSkipAd === true,
        controlNotice: typeof r.controlNotice === 'string' ? r.controlNotice.slice(0, 250) : undefined };

    }
    source.lastReport = Date.now(); if (!r.ready) source.readyAt = 0; if (r.ready && !source.readyAt) source.readyAt = source.lastReport;
    source.state = { ...source.state, ready: r.ready, playing: r.playing, hasPlayed: r.hasPlayed, status: r.status, currentTime: r.currentTime, duration: r.duration };
    this.emit({ type: 'state', state: source.state });
  }
  command(value: unknown) {
    validateMediaCommand(value); const command: MediaCommand = value;
    const source = this.sources.get(command.contentId); if (!source) throw new Error('That video is no longer in the room.');
    if (command.action === 'retry' || command.action === 'restart-renderer') { const content = source.content, id = source.state.currentVideoId, autoplay = source.state.autoplayNext; this.remove(content.id, source); this.open(content, id, autoplay); return; }
    if (command.action === 'open-source' || command.action === 'close-source') {
      if (!this.watch) throw new Error('Restart video renderer to use normal YouTube playback.');
      this.showBrowser(source, command.action === 'open-source'); return;
    }
    if (['next', 'skip-ad', 'autoplay-next'].includes(command.action) && !this.watch) throw new Error('Restart video renderer to use normal YouTube playback.');
    if (command.action === 'autoplay-next') {
      source.state = { ...source.state, autoplayNext: command.enabled }; this.emit({ type: 'state', state: source.state });
      source.win.webContents.send('media:source-command', command); return;
    }
    if (!source.state.ready) throw new Error('Wait for the video to load or reload it.');
    if (command.action === 'pause') { source.pendingNextUntil = 0; source.resumeAfterNavigation = false; source.playbackAllowed = false; }
    if (command.action === 'next') {
      if (!source.state.canGoNext) throw new Error('YouTube has no next video available. Open YouTube window to choose one.');
      source.pendingNextUntil = Date.now() + 12000;
    }
    if (command.action === 'skip-ad' && !source.state.canSkipAd) throw new Error('YouTube has not made this ad skippable yet.');
    if (command.action === 'seek' && source.state.adPlaying) throw new Error('Seeking is available after the ad finishes.');
    if (command.action === 'play' || command.action === 'mute' || command.action === 'unmute') {
      const muted = command.action !== 'unmute'; source.win.webContents.setAudioMuted(muted);
      source.state = { ...source.state, muted }; this.emit({ type: 'state', state: source.state });
    }
    source.win.webContents.send('media:source-command', command);
  }
  input(value: unknown) {
    validateMediaInput(value);
    const source = this.sources.get(value.contentId);
    if (!source?.state.ready) return;
    source.win.webContents.focus();
    const region = source.region;
    source.win.webContents.sendInputEvent({ type: value.type,
      x: this.watch && region ? Math.floor(region.x + value.x / 1920 * region.width) : value.x,
      y: this.watch && region ? Math.floor(region.y + value.y / 1080 * region.height) : value.y,
      button: 'left', clickCount: value.type === 'mouseMove' ? 0 : 1 });
  }
  snapshot(): MediaEvent[] {
    return [...this.sources.values()].flatMap(s => [{ type: 'state', state: s.state } as MediaEvent, ...(s.frame ? [{ type: 'frame', frame: s.frame } as MediaEvent] : [])]);
  }
  private remove(id: string, source: Source) { clearInterval(source.watchdog); clearTimeout(source.captureTimer); this.sources.delete(id); if (!source.win.isDestroyed()) source.win.destroy(); this.emit({ type: 'removed', contentId: id }); }
  dispose() { for (const [id, source] of this.sources) this.remove(id, source); }
}
