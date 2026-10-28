// YouTube sources play in YouTube's official embedded player, one visible window per source. Studio and Output mirror
// that window through the same armed window capture used for screen/window sources. Nothing is downloaded, no player
// UI is removed, and restricted videos fail with YouTube's own error. The window has no Node, no HECTOR bridge and an
// isolated in-memory session that denies every permission.
import { BrowserWindow, screen, session as electronSession, shell, type Rectangle, type Session, type WebContents } from 'electron';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import type { Scene, Source } from '../src/core/model';
import { playerError, playerKey, type PlayerStatus } from '../src/core/youtube';

export const playerScheme = 'hector-player';
/** YouTube requires embedded players to identify their client; native apps without a web origin send an https identity. */
const clientReferrer = 'https://app.hector.studio/';
const youtubeHosts = ['https://*.youtube.com/*', 'https://*.youtube-nocookie.com/*', 'https://*.ytimg.com/*', 'https://*.googlevideo.com/*'];
const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>YouTube</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' https://www.youtube.com https://s.ytimg.com; frame-src https://www.youtube-nocookie.com https://www.youtube.com; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}#player{display:block;width:100vw;height:100vh;border:0}</style></head>
<body><div id="player"></div><script src="player.js"></script></body></html>`;
// Runs in the page's main world. It only talks to the official IFrame API and to the two-function preload bridge.
const script = `(() => {
  const q = new URLSearchParams(location.search), videoId = q.get('v') || '', start = Number(q.get('start')) || 0, bridge = window.hectorPlayer;
  let player = null, ready = false, desired = null, loop = false, playing = true;
  const send = status => bridge.report(status);
  const apply = c => {
    desired = c; if (!player || !ready) return;
    loop = c.loop; playing = c.playing;
    const rates = player.getAvailablePlaybackRates() || [1], rate = rates.reduce((a, b) => Math.abs(b - c.rate) < Math.abs(a - c.rate) ? b : a, 1);
    if (player.getPlaybackRate() !== rate) player.setPlaybackRate(rate);
    if (c.muted) player.mute(); else { player.unMute(); player.setVolume(Math.round(c.volume * 100)); }
    if (typeof c.seek === 'number') { const duration = player.getDuration() || 0, at = start + c.seek; player.seekTo(loop && duration ? at % duration : duration ? Math.min(at, duration) : at, true); }
    if (c.playing) player.playVideo(); else player.pauseVideo();
  };
  bridge.onCommand(apply);
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) { send({ event: 'error', code: 2 }); return; }
  window.onYouTubeIframeAPIReady = () => {
    player = new YT.Player('player', { host: 'https://www.youtube-nocookie.com', videoId,
      playerVars: { autoplay: 1, mute: 1, controls: 0, playsinline: 1, rel: 0, iv_load_policy: 3, start, origin: location.origin },
      events: {
        onReady: () => { ready = true; send({ event: 'ready', title: (player.getVideoData() || {}).title || '', duration: player.getDuration() || 0 }); if (desired) apply({ ...desired, seek: undefined }); },
        onStateChange: e => {
          send({ event: 'state', state: e.data, duration: player.getDuration() || 0 });
          if (e.data === 0 && loop) { player.seekTo(start, true); if (playing) player.playVideo(); }
        },
        onError: e => send({ event: 'error', code: e.data })
      } });
  };
  const api = document.createElement('script');
  api.src = 'https://www.youtube.com/iframe_api'; api.onerror = () => send({ event: 'error', code: 'network' });
  document.head.append(api);
})();`;
const reportSchema = z.discriminatedUnion('event', [
  z.object({ event: z.literal('ready'), title: z.string().max(500), duration: z.number().finite().min(0) }).strict(),
  z.object({ event: z.literal('state'), state: z.number().int().min(-1).max(5), duration: z.number().finite().min(0) }).strict(),
  z.object({ event: z.literal('error'), code: z.union([z.number().int(), z.literal('network')]) }).strict()
]);
const states: Record<number, PlayerStatus['state']> = { [-1]: 'ready', 0: 'ended', 1: 'playing', 2: 'paused', 3: 'buffering', 5: 'ready' };
const startupTimeout = 25_000;
export interface PlayerDemand { scene: Scene; audible: boolean; playing: boolean }
interface Player { key: string; source: Source; win: BrowserWindow | null; status: PlayerStatus; timer?: ReturnType<typeof setTimeout>; sent: string; seek?: number }
export class YouTubePlayers {
  private players = new Map<string, Player>(); private session: Session | null = null; private disposed = false;
  constructor(private preload: string, private changed: () => void, private anchor: () => Rectangle | null) {}
  /** The player session: local player page only, an honest client identity for YouTube, and no permissions at all. */
  private ensureSession() {
    if (this.session) return this.session;
    const ses = this.session = electronSession.fromPartition('hector-youtube', { cache: true });
    ses.protocol.handle(playerScheme, request => {
      const url = new URL(request.url);
      if (request.method !== 'GET' || url.hostname !== 'player') return new Response(null, { status: 403 });
      if (url.pathname === '/') return new Response(page, { headers: { 'content-type': 'text/html; charset=utf-8' } });
      if (url.pathname === '/player.js') return new Response(script, { headers: { 'content-type': 'text/javascript; charset=utf-8' } });
      return new Response(null, { status: 404 });
    });
    ses.webRequest.onBeforeSendHeaders({ urls: youtubeHosts }, (details, callback) => {
      const headers = details.requestHeaders, referrer = headers.Referer ?? headers.referer;
      if (!referrer || referrer.startsWith(playerScheme + ':')) { delete headers.referer; headers.Referer = clientReferrer; }
      callback({ requestHeaders: headers });
    });
    ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    ses.setPermissionCheckHandler(() => false);
    ses.on('will-download', event => event.preventDefault());
    return ses;
  }
  status(): Record<string, PlayerStatus> { return Object.fromEntries([...this.players].map(([key, p]) => [key, { ...p.status }])); }
  /** Media source IDs of player windows, so the screen/window picker never offers them. */
  mediaSourceIds() { return [...this.players.values()].flatMap(p => p.win && !p.win.isDestroyed() ? [p.win.getMediaSourceId()] : []); }
  owns(contents: WebContents) { return [...this.players.values()].some(p => p.win?.webContents === contents); }
  /** The capture behind `captureId`, if `scene` (the requesting window's scene) plays that player. */
  capture(captureId: string, scene: Scene) {
    const player = [...this.players.values()].find(p => p.status.captureId === captureId);
    if (!player?.win || player.win.isDestroyed() || !scene.sources.some(s => s.kind === 'youtube' && playerKey(s) === player.key)) return null;
    return { desktopId: player.win.getMediaSourceId(), name: player.status.title || 'YouTube' };
  }
  /** Keep exactly the players the draft or applied scene uses; push each one its desired playback when it changes. */
  sync(draft: PlayerDemand, applied: PlayerDemand) {
    if (this.disposed) return;
    const wanted = new Map<string, { source: Source; demand: PlayerDemand; audible: boolean }>();
    for (const demand of [draft, applied]) for (const source of demand.scene.sources) if (source.kind === 'youtube') {
      // Applied settings win: the projected scene decides speed, loop and sound. A draft-only source stays silent.
      wanted.set(playerKey(source), { source, demand, audible: demand.audible && source.volume > 0 });
    }
    for (const [key, player] of this.players) if (!wanted.has(key)) this.close(player);
    for (const [key, want] of wanted) {
      const player = this.players.get(key) ?? this.open(key, want.source);
      player.source = want.source;
      this.command(player, { playing: want.demand.playing, rate: want.source.speed, volume: want.source.volume, muted: !want.audible, loop: want.source.loop });
    }
  }
  /** Transport seek: every player jumps to its start offset plus the transport position. */
  seek(position: number) { for (const player of this.players.values()) { player.seek = position * player.source.speed; player.sent = ''; } }
  reload(key: string) { const player = this.players.get(key); if (!player) throw new Error('That YouTube source is not loaded.'); const source = player.source; this.close(player); this.open(key, source); this.changed(); }
  show(key: string) {
    const player = this.players.get(key); if (!player) throw new Error('That YouTube source is not loaded.');
    if (!player.win || player.win.isDestroyed()) { this.reload(key); return; }
    if (player.win.isMinimized()) player.win.restore(); player.win.show();
  }
  private command(player: Player, desired: { playing: boolean; rate: number; volume: number; muted: boolean; loop: boolean }) {
    const command = { ...desired, seek: player.seek }, key = JSON.stringify(command);
    if (key === player.sent || !player.win || player.win.isDestroyed()) return;
    player.sent = key; player.seek = undefined; player.win.webContents.send('hector:player-command', command);
  }
  private set(player: Player, patch: Partial<PlayerStatus>) {
    const next = { ...player.status, ...patch };
    if (JSON.stringify(next) === JSON.stringify(player.status)) return;
    player.status = next; this.changed();
  }
  private open(key: string, source: Source) {
    const area = this.anchor() ?? screen.getPrimaryDisplay().workArea, index = this.players.size;
    const win = new BrowserWindow({ title: 'YouTube · HECTOR', width: 960, height: 540, useContentSize: true, minWidth: 320, minHeight: 180,
      x: Math.max(area.x, area.x + area.width - 980 - index * 32), y: Math.max(area.y, area.y + area.height - 600 - index * 32),
      show: false, backgroundColor: '#000000', autoHideMenuBar: true, fullscreenable: false,
      webPreferences: { session: this.ensureSession(), preload: this.preload, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true,
        backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required', spellcheck: false } });
    // No menu bar: the window's content is what gets projected.
    win.setMenu(null);
    const player: Player = { key, source, win, sent: '', status: { state: 'loading', title: '', duration: 0, error: '', captureId: randomUUID() } };
    this.players.set(key, player);
    const contents = win.webContents;
    win.on('page-title-updated', event => event.preventDefault());
    contents.setWindowOpenHandler(({ url }) => {
      // YouTube's own links (logo, title) open in the system browser, never inside HECTOR.
      try { const host = new URL(url).hostname.replace(/^www\./, ''); if (url.startsWith('https://') && ['youtube.com', 'youtu.be'].includes(host)) void shell.openExternal(url); } catch { /* ignored */ }
      return { action: 'deny' };
    });
    contents.on('will-navigate', event => event.preventDefault());
    contents.on('will-redirect', (event, url) => { if (!url.startsWith(playerScheme + '://')) event.preventDefault(); });
    contents.on('will-attach-webview', event => event.preventDefault());
    contents.on('render-process-gone', () => this.set(player, { state: 'error', error: playerError('crashed') }));
    contents.on('did-fail-load', (_event, code, _description, _url, mainFrame) => { if (mainFrame && code !== -3) this.set(player, { state: 'error', error: playerError('network') }); });
    win.on('minimize', () => this.set(player, { state: 'minimized' }));
    win.on('restore', () => { if (player.status.state === 'minimized') this.set(player, { state: 'ready' }); });
    win.on('closed', () => {
      clearTimeout(player.timer);
      if (this.players.get(key) === player) { player.win = null; this.set(player, { state: 'closed', captureId: null }); }
    });
    player.timer = setTimeout(() => { if (player.status.state === 'loading') this.set(player, { state: 'error', error: playerError('timeout') }); }, startupTimeout);
    void win.loadURL(`${playerScheme}://player/?v=${encodeURIComponent(source.videoId!)}&start=${source.start ?? 0}`).catch(() => {});
    win.showInactive();
    this.changed();
    return player;
  }
  report(contents: WebContents, frameIsMain: boolean, raw: unknown) {
    const player = [...this.players.values()].find(p => p.win?.webContents === contents);
    if (!player || !frameIsMain) return;
    const report = reportSchema.parse(raw);
    if (report.event === 'error') { clearTimeout(player.timer); this.set(player, { state: 'error', error: playerError(report.code) }); return; }
    if (player.status.state === 'error') return;
    if (report.event === 'ready') {
      clearTimeout(player.timer); player.sent = '';
      if (report.title) player.win?.setTitle(`YouTube · ${report.title.slice(0, 120)} · HECTOR`);
      this.set(player, { state: player.status.state === 'minimized' ? 'minimized' : 'ready', title: report.title, duration: report.duration });
    } else if (player.status.state !== 'minimized') this.set(player, { state: states[report.state] ?? player.status.state, duration: report.duration || player.status.duration });
  }
  private close(player: Player) {
    clearTimeout(player.timer); this.players.delete(player.key);
    if (player.win && !player.win.isDestroyed()) player.win.destroy();
    this.changed();
  }
  dispose() { this.disposed = true; for (const player of [...this.players.values()]) this.close(player); }
}
export const playerPreload = (directory: string) => join(directory, 'youtube-preload.cjs');
