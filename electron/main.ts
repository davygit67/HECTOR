import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, protocol, screen, session as electronSession, systemPreferences, webContents, Menu, type IpcMainInvokeEvent, type IpcMainEvent } from 'electron';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, realpath, rm } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { SceneSession } from '../src/core/session';
import { commandSchema, idSchema, type Scene, type Source } from '../src/core/model';
import type { CaptureAccess, CaptureChoice, CaptureGrant, RequestResult, Snapshot, Transport } from '../src/core/bridge';
import { atomicWrite, readProject } from './persistence';
import { outputAction } from './output-policy';
import { serveFile } from './media-protocol';
import { playerPreload, playerScheme, YouTubePlayers } from './youtube';
import { parseYouTubeLink, playerKey } from '../src/core/youtube';

protocol.registerSchemesAsPrivileged([{ scheme: 'hector-media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
  // The YouTube player page: a secure origin of its own, served only inside the isolated player session.
  { scheme: playerScheme, privileges: { standard: true, secure: true } }]);
app.setName('HECTOR');
if (process.env.HECTOR_TEST_DATA) app.setPath('userData', resolve(process.env.HECTOR_TEST_DATA));
let studio: BrowserWindow | null = null, output: BrowserWindow | null = null;
let selectedDisplay: number | null = null, disconnected = false, blackout = false, operation = false;
const assets = new Map<string, string>();
/** Session-only screen/window grants, keyed by capture ID. The OS source ID never leaves main. */
const captures = new Map<string, CaptureGrant & { desktopId: string }>();
/** The most recent picker listing; capture.add only accepts IDs from it. */
let captureChoices = new Map<string, CaptureGrant>();
/** One armed capture per window, consumed by its next getDisplayMedia call. */
const pendingCaptures = new Map<number, { desktopId: string; name: string; expires: number }>();
let outputErrors: string[] = [];
let setupNames: string[] = [];
let startupError = '';
let transport: Transport = { playing: true, position: 0, anchor: Date.now(), revision: 0 };
/** Official YouTube player windows, one per YouTube source in the draft or applied scene. */
const players = new YouTubePlayers(playerPreload(__dirname), () => broadcast(), () => studio && !studio.isDestroyed() ? screen.getDisplayMatching(studio.getBounds()).workArea : null);
const dataPath = () => join(app.getPath('userData'), 'projects');
const assetEntries = (scene: Scene) => Object.fromEntries(scene.sources.filter(s => s.assetId && assets.has(s.assetId)).map(s => [s.assetId!, assets.get(s.assetId!)!]));
const document = (scene: Scene) => ({ format: 'hector', version: 1, scene, assets: assetEntries(scene) });
const controller = new SceneSession(undefined, async scene => atomicWrite(join(dataPath(), 'current.json'), document(scene)));
const simple = z.enum(['undo', 'redo', 'discard', 'save', 'apply', 'import', 'open', 'export', 'capture.sources']);
const setupName = z.string().min(1, 'Enter a setup name.').max(80, 'Setup names are limited to 80 characters.')
  .regex(/^[\p{L}\p{N} _-]+$/u, 'Setup names may contain letters, numbers, spaces, underscores and hyphens.');
const requestSchema = z.union([
  z.object({ type: simple }).strict(),
  z.object({ type: z.literal('command'), command: commandSchema }).strict(),
  z.object({ type: z.literal('mode'), mode: z.enum(['preview', 'live']), resolution: z.enum(['apply', 'discard', 'cancel']).optional() }).strict(),
  z.object({ type: z.literal('output'), displayId: z.number().int(), fullscreen: z.boolean() }).strict(),
  z.object({ type: z.literal('blackout'), value: z.boolean() }).strict(),
  z.object({ type: z.literal('transport'), playing: z.boolean(), position: z.number().finite().min(0).max(86400).optional() }).strict(),
  z.object({ type: z.literal('relink'), assetId: idSchema }).strict(),
  z.object({ type: z.literal('capture.add'), sourceId: z.string().min(1).max(200), replace: idSchema.optional() }).strict(),
  z.object({ type: z.literal('youtube.add'), link: z.string().max(4096) }).strict(),
  z.object({ type: z.enum(['youtube.reload', 'youtube.show']), sourceId: idSchema }).strict(),
  z.object({ type: z.enum(['setup.save', 'setup.load']), name: setupName }).strict()
]);
const reportSchema = z.object({ errors: z.array(z.string().max(300)).max(16) }).strict();
const mediaFilters = [{ name: 'Images and videos', extensions: ['png', 'jpg', 'jpeg', 'webp', 'mp4', 'webm', 'mov', 'm4v'] }];
function kind(path: string): 'image' | 'video' {
  const extension = extname(path).toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.webp'].includes(extension)) return 'image';
  if (['.mp4', '.webm', '.mov', '.m4v'].includes(extension)) return 'video';
  throw new Error('Unsupported media extension. Use PNG, JPEG, WebP, MP4, WebM, MOV or M4V. Codec support depends on Chromium.');
}
function message(error: unknown) {
  if (error instanceof z.ZodError) return error.issues.map(issue => issue.message).join(' ');
  return error instanceof Error ? error.message : String(error);
}
function captureAccess(): CaptureAccess {
  if (process.platform === 'darwin') return systemPreferences.getMediaAccessStatus('screen');
  return process.platform === 'win32' ? 'not-required' : 'unknown';
}
function snapshot(): Snapshot {
  const primary = screen.getPrimaryDisplay().id;
  return { session: controller.snapshot(),
    displays: screen.getAllDisplays().map(d => ({ id: d.id, label: d.label || `Display ${d.id}`, width: d.size.width, height: d.size.height, primary: d.id === primary })),
    output: { open: !!output, fullscreen: output?.isFullScreen() ?? false, displayId: selectedDisplay, blackout, disconnected, errors: outputErrors }, transport,
    assets: Object.fromEntries([...assets].map(([id, path]) => [id, { url: `hector-media://asset/${id}`, missing: !existsSync(path) }])),
    captures: Object.fromEntries([...captures].map(([id, grant]) => [id, { name: grant.name, kind: grant.kind }])),
    players: players.status(), setups: setupNames, platform: process.platform, captureAccess: captureAccess() };
}
/** Players follow the scenes: draft sources are previewed silently, applied sources are heard while output is open. */
function syncPlayers() {
  const audible = !!output && !output.isDestroyed() && output.isVisible() && !disconnected;
  players.sync({ scene: controller.draft, audible: false, playing: transport.playing }, { scene: controller.applied, audible, playing: transport.playing });
}
function broadcast() { syncPlayers(); const state = snapshot(); for (const window of [studio, output]) if (window && !window.isDestroyed()) window.webContents.send('hector:state', state); }
function authorize(event: IpcMainInvokeEvent | IpcMainEvent, write = false) {
  if (event.sender !== studio?.webContents && (write || event.sender !== output?.webContents)) throw new Error('Unknown or unauthorized window.');
  if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame) throw new Error('Subframes cannot access desktop APIs.');
}
function createWindow(isOutput: boolean) {
  const window = new BrowserWindow({ title: isOutput ? 'HECTOR Output' : 'HECTOR Studio', width: isOutput ? 960 : 1440, height: isOutput ? 540 : 900,
    minWidth: isOutput ? 320 : 1024, minHeight: isOutput ? 240 : 650, show: false, backgroundColor: '#090a0e', autoHideMenuBar: true,
    webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, webSecurity: true,
      autoplayPolicy: 'no-user-gesture-required' } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  // Keep native titles stable so the document title cannot rename the studio/output windows.
  window.on('page-title-updated', event => event.preventDefault());
  const dev = process.env.HECTOR_DEV_URL;
  if (dev && !app.isPackaged && dev === 'http://127.0.0.1:5173') void window.loadURL(dev + (isOutput ? '/?output=1' : '/'));
  else void window.loadFile(join(__dirname, '../dist/index.html'), { query: isOutput ? { output: '1' } : {} });
  window.once('ready-to-show', () => {
    if (!isOutput) { window.show(); return; }
    // A display may disconnect while output loads; never let a late ready event reveal it on a fallback display.
    if (window === output && !disconnected && outputAction(true, selectedDisplay, screen.getAllDisplays().map(d => d.id)) === 'keep') window.showInactive();
  });
  return window;
}
function openOutput(displayId: number, fullscreen: boolean) {
  const display = screen.getAllDisplays().find(d => d.id === displayId);
  if (!display) throw new Error('Display is no longer connected. Select a connected display.');
  const changed = selectedDisplay !== displayId;
  if (!output) {
    const window = output = createWindow(true), id = window.webContents.id;
    window.on('closed', () => { if (output === window) output = null; outputErrors = []; pendingCaptures.delete(id); broadcast(); });
    window.on('enter-full-screen', broadcast); window.on('leave-full-screen', broadcast);
    window.webContents.on('before-input-event', (event, input) => { if (input.type === 'keyDown' && input.key === 'Escape') { event.preventDefault(); window.setFullScreen(false); studio?.focus(); } });
  }
  if (changed || disconnected || !output.isVisible()) {
    output.setFullScreen(false);
    output.setBounds({ x: display.bounds.x + 30, y: display.bounds.y + 30, width: Math.min(960, display.workArea.width - 60), height: Math.min(540, display.workArea.height - 60) });
  }
  selectedDisplay = displayId; disconnected = false;
  // Native macOS fullscreen uses a separate Space; the studio remains independently focusable.
  output.setFullScreen(fullscreen); output.showInactive();
}
function displayChanged() {
  if (outputAction(!!output, selectedDisplay, screen.getAllDisplays().map(d => d.id)) === 'hide') {
    disconnected = true; blackout = true; output?.setFullScreen(false); output?.hide();
  }
  broadcast();
}
async function stageFile(path: string) {
  const doc = await readProject(path);
  // Remap imported asset IDs: an imported project cannot retarget a still-applied source.
  const remap = new Map<string, string>();
  for (const [id, mediaPath] of Object.entries(doc.assets)) {
    const target = isAbsolute(mediaPath) ? mediaPath : resolve(dirname(path), mediaPath);
    kind(target);
    if (!isAbsolute(mediaPath) && relative(dirname(path), target).startsWith('..')) throw new Error('Portable media must stay inside its project folder.');
    remap.set(id, randomUUID());
  }
  const imported = structuredClone(doc.scene);
  for (const source of imported.sources) if (source.assetId) {
    const replacement = remap.get(source.assetId); if (!replacement) throw new Error('Project is missing an asset entry.');
    source.assetId = replacement;
  }
  controller.stage(imported);
  for (const [id, mediaPath] of Object.entries(doc.assets)) assets.set(remap.get(id)!, isAbsolute(mediaPath) ? mediaPath : resolve(dirname(path), mediaPath));
}
/** Drop file and capture grants that no reachable scene (draft, applied, saved, undo/redo) references. */
function pruneGrants() {
  const scenes = controller.reachableScenes();
  const assetIds = new Set(scenes.flatMap(scene => scene.sources.map(s => s.assetId).filter(Boolean)));
  const captureIds = new Set(scenes.flatMap(scene => scene.sources.map(s => s.captureId).filter(Boolean)));
  for (const id of assets.keys()) if (!assetIds.has(id)) assets.delete(id);
  for (const id of captures.keys()) if (!captureIds.has(id)) captures.delete(id);
}
/** A renderer may keep using grants already in the draft, but new references must come from main's own pickers. */
function checkGrants(source: Source) {
  const known = (field: 'assetId' | 'captureId') => controller.draft.sources.some(s => s[field] === source[field]);
  if (source.assetId && !assets.has(source.assetId) && !known('assetId')) throw new Error('Media has not been granted through a file picker.');
  if (source.captureId && !captures.has(source.captureId) && !known('captureId')) throw new Error('Capture has not been granted through the capture picker.');
}
async function listCaptureSources(): Promise<CaptureChoice[]> {
  // HECTOR's own windows are excluded: capturing them would only create feedback loops.
  const own = new Set([...[studio, output].filter((w): w is BrowserWindow => !!w && !w.isDestroyed()).map(w => w.getMediaSourceId()), ...players.mediaSourceIds()]);
  const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: false });
  captureChoices = new Map();
  return sources.filter(s => !own.has(s.id)).map(s => {
    const kind = s.id.startsWith('screen:') ? 'screen' as const : 'window' as const;
    const name = (s.name || (kind === 'screen' ? 'Screen' : 'Window')).slice(0, 160);
    captureChoices.set(s.id, { name, kind });
    return { id: s.id, name, kind, thumbnail: s.thumbnail.isEmpty() ? '' : s.thumbnail.toDataURL(),
      outputDisplay: kind === 'screen' && selectedDisplay !== null && s.display_id === String(selectedDisplay) };
  });
}
async function handle(raw: unknown): Promise<RequestResult> {
  const request = requestSchema.parse(raw);
  // Emergency/transport controls remain available during disk operations.
  if (request.type === 'blackout') { blackout = request.value; broadcast(); return { ok: true }; }
  if (request.type === 'transport') {
    const current = transport.position + (transport.playing ? (Date.now() - transport.anchor) / 1000 : 0);
    transport = { playing: request.playing, position: request.position ?? current, anchor: Date.now(), revision: transport.revision + 1 };
    if (request.position !== undefined) players.seek(request.position);
    broadcast(); return { ok: true };
  }
  // Player window controls are operational: they never change the scene.
  if (request.type === 'youtube.reload' || request.type === 'youtube.show') {
    const source = [...controller.draft.sources, ...controller.applied.sources].find(s => s.id === request.sourceId && s.kind === 'youtube');
    if (!source) throw new Error('That YouTube source is no longer in the project.');
    if (request.type === 'youtube.reload') players.reload(playerKey(source)); else players.show(playerKey(source));
    return { ok: true };
  }
  // Listing does not change state, but it may take a moment (thumbnails), so keep it outside the edit lock.
  if (request.type === 'capture.sources') return { ok: true, choices: await listCaptureSources() };
  if (operation) throw new Error('Wait for the current file operation to finish.');
  operation = true;
  try {
    switch (request.type) {
      case 'command': {
        if (request.command.type === 'source.put') checkGrants(request.command.source);
        controller.command(request.command); break;
      }
      case 'undo': controller.undo(); break;
      case 'redo': controller.redo(); break;
      case 'discard': controller.discard(); break;
      case 'save': await controller.save(); break;
      case 'apply': await controller.save(true); break;
      case 'mode':
        // Without a resolution, pending Preview changes block the switch; say so instead of silently staying put.
        if (!(await controller.switchMode(request.mode, request.resolution)) && request.resolution !== 'cancel') throw new Error('Apply or discard the pending changes before switching to Live Edit.');
        break;
      case 'output': openOutput(request.displayId, request.fullscreen); break;
      case 'import': {
        const result = await dialog.showOpenDialog(studio!, { properties: ['openFile', 'multiSelections'], filters: mediaFilters });
        if (result.canceled) break;
        if (result.filePaths.length + controller.draft.sources.length > 64) throw new Error('Maximum 64 sources per project.');
        for (const file of result.filePaths) {
          const path = await realpath(file), mediaKind = kind(path), assetId = randomUUID(); assets.set(assetId, path);
          const source: Source = { id: randomUUID(), assetId, kind: mediaKind, name: basename(path), color: '#8f72ff', loop: true, speed: 1, volume: 0 };
          controller.command({ type: 'source.put', source });
        }
        break;
      }
      case 'relink': {
        if (!assets.has(request.assetId)) throw new Error('Unknown asset.');
        const result = await dialog.showOpenDialog(studio!, { properties: ['openFile'], filters: mediaFilters }); if (result.canceled) break;
        const path = await realpath(result.filePaths[0]), mediaKind = kind(path), newId = randomUUID();
        const next = structuredClone(controller.draft); let replaced = false;
        for (const source of next.sources) if (source.assetId === request.assetId) { if (source.kind !== mediaKind) throw new Error('Relink requires the same media type.'); source.assetId = newId; replaced = true; }
        if (!replaced) throw new Error('Asset is not in the draft.');
        assets.set(newId, path); controller.stage(next); break;
      }
      case 'youtube.add': {
        const link = parseYouTubeLink(request.link); if (!link.ok) throw new Error(link.error);
        if (controller.draft.sources.length >= 64) throw new Error('Maximum 64 sources per project.');
        controller.command({ type: 'source.put', source: { id: randomUUID(), kind: 'youtube', name: `YouTube · ${link.videoId}`, videoId: link.videoId, start: link.start, color: '#8f72ff', loop: false, speed: 1, volume: 0 } });
        break;
      }
      case 'capture.add': {
        const choice = captureChoices.get(request.sourceId);
        if (!choice) throw new Error('That screen or window is no longer listed. Refresh the capture sources.');
        // Every selection gets a fresh grant, so a reconnect is a staged change like a relink.
        const captureId = randomUUID(), next = structuredClone(controller.draft);
        if (request.replace) {
          const existing = next.sources.find(s => s.id === request.replace && s.kind === 'capture');
          if (!existing) throw new Error('That capture source is no longer in the draft.');
          existing.captureId = captureId; existing.name = choice.name;
        } else {
          if (next.sources.length >= 64) throw new Error('Maximum 64 sources per project.');
          next.sources.push({ id: randomUUID(), kind: 'capture', captureId, name: choice.name, color: '#8f72ff', loop: true, speed: 1, volume: 0 });
        }
        captures.set(captureId, { ...choice, desktopId: request.sourceId }); controller.stage(next); break;
      }
      case 'open': {
        const result = await dialog.showOpenDialog(studio!, { properties: ['openFile'], filters: [{ name: 'HECTOR project', extensions: ['json'] }] });
        if (!result.canceled) await stageFile(result.filePaths[0]); break;
      }
      case 'export': {
        const result = await dialog.showSaveDialog(studio!, { defaultPath: `${controller.draft.name}.hector.json`, filters: [{ name: 'HECTOR project', extensions: ['json'] }] });
        if (result.canceled || !result.filePath) break;
        const scene = structuredClone(controller.draft), doc = document(scene);
        const mediaDirectory = `${basename(result.filePath)}-${randomUUID().slice(0, 8)}.hector-media`;
        const mediaPath = join(dirname(result.filePath), mediaDirectory);
        await mkdir(mediaPath, { recursive: true });
        try {
          for (const [id, path] of Object.entries(doc.assets)) {
            const filename = id + extname(path).toLowerCase();
            await copyFile(path, join(mediaPath, filename)); doc.assets[id] = `${mediaDirectory}/${filename}`;
          }
          await atomicWrite(result.filePath, doc);
        } catch (error) {
          // The media folder name is unique to this export, so removing it cannot touch an earlier export.
          await rm(mediaPath, { recursive: true, force: true }).catch(() => {});
          throw new Error(`Portable export failed; nothing was written. ${message(error)}`);
        }
        break;
      }
      case 'setup.save': {
        await atomicWrite(join(dataPath(), 'setups', request.name + '.json'), document(controller.draft));
        setupNames = (await readdir(join(dataPath(), 'setups'))).filter(n => n.endsWith('.json')).map(n => n.slice(0, -5)); break;
      }
      case 'setup.load': await stageFile(join(dataPath(), 'setups', request.name + '.json')); break;
    }
    return { ok: true };
  } finally { operation = false; pruneGrants(); broadcast(); }
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { studio?.show(); studio?.focus(); });
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]) : null);
    electronSession.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
      // The only permission HECTOR grants: video-only display capture for a window that armed a granted capture moments before.
      const armed = pendingCaptures.get(contents.id), trusted = contents === studio?.webContents || contents === output?.webContents;
      const mediaTypes = (details as { mediaTypes?: string[] }).mediaTypes ?? [];
      callback(permission === 'display-capture' && trusted && details.isMainFrame && mediaTypes.length > 0 && mediaTypes.every(t => t === 'video') && !!armed && armed.expires > Date.now());
    });
    electronSession.defaultSession.setPermissionCheckHandler(() => false);
    // Screen capture is only ever handed out for a capture the same window armed moments before.
    electronSession.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
      const contents = request.frame ? webContents.fromFrame(request.frame) : undefined;
      const pending = contents ? pendingCaptures.get(contents.id) : undefined;
      if (contents) pendingCaptures.delete(contents.id);
      const trusted = !!contents && (contents === studio?.webContents || contents === output?.webContents) && request.frame === contents.mainFrame;
      if (!pending || !trusted || pending.expires < Date.now() || request.audioRequested || !request.videoRequested) { callback(null); return; }
      callback({ video: { id: pending.desktopId, name: pending.name } });
    });
    protocol.handle('hector-media', async request => {
      try {
        const url = new URL(request.url); if (url.hostname !== 'asset' || !['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 403 });
        const path = assets.get(url.pathname.slice(1)); if (!path) return new Response(null, { status: 404 });
        const resolved = await realpath(path); kind(resolved);
        // Granted media is readable by HECTOR's own pages only (CSP media-src/img-src); CORS lets WebGL sample it.
        return await serveFile(resolved, request);
      } catch { return new Response(null, { status: 404 }); }
    });
    const current = join(dataPath(), 'current.json');
    if (existsSync(current)) {
      try { await stageFile(current); controller.applied = structuredClone(controller.draft); controller.saved = structuredClone(controller.draft); controller.discard(); }
      catch (error) { startupError = `Saved project could not be restored. The file was preserved. ${message(error)}`; }
    }
    const setupsDir = join(dataPath(), 'setups'); await mkdir(setupsDir, { recursive: true });
    setupNames = (await readdir(setupsDir)).filter(n => n.endsWith('.json')).map(n => n.slice(0, -5));
    ipcMain.handle('hector:snapshot', event => { authorize(event); return snapshot(); });
    ipcMain.handle('hector:request', async (event, raw) => {
      try { authorize(event, true); return await handle(raw); }
      catch (error) { return { ok: false, error: message(error) }; }
    });
    ipcMain.handle('hector:arm-capture', (event, raw) => {
      try {
        authorize(event);
        const captureId = idSchema.parse(raw);
        // Each window may only start captures that the scene it renders uses: studio → draft, output → applied.
        const scene = event.sender === output?.webContents ? controller.applied : controller.draft;
        // A YouTube player window is captured like any granted window, but only by a window whose scene plays it.
        const player = players.capture(captureId, scene);
        if (player) { pendingCaptures.set(event.sender.id, { ...player, expires: Date.now() + 10_000 }); return { ok: true }; }
        if (!scene.sources.some(s => s.kind === 'capture' && s.captureId === captureId)) throw new Error('That capture is not part of this window’s scene.');
        const grant = captures.get(captureId); if (!grant) throw new Error('Capture not connected. Choose the screen or window again in Media.');
        pendingCaptures.set(event.sender.id, { desktopId: grant.desktopId, name: grant.name, expires: Date.now() + 10_000 });
        return { ok: true };
      } catch (error) { return { ok: false, error: message(error) }; }
    });
    // Player windows only report their own status; they cannot reach any other HECTOR channel.
    ipcMain.on('hector:player-report', (event, raw) => {
      try { players.report(event.sender, !!event.senderFrame && event.senderFrame === event.sender.mainFrame, raw); }
      catch { /* Malformed reports are ignored. */ }
    });
    ipcMain.on('hector:report', (event, raw) => {
      try {
        authorize(event); if (event.sender !== output?.webContents) return;
        const { errors } = reportSchema.parse(raw);
        if (JSON.stringify(errors) !== JSON.stringify(outputErrors)) { outputErrors = errors; broadcast(); }
      } catch { /* Malformed or unauthorized reports are ignored. */ }
    });
    studio = createWindow(false);
    // A restored project may already contain YouTube sources.
    syncPlayers();
    studio.on('close', event => {
      if (!controller.snapshot().unsaved || process.env.HECTOR_TEST_DATA) return;
      const choice = dialog.showMessageBoxSync(studio!, { type: 'question', buttons: ['Keep editing', 'Quit without saving'], defaultId: 0, cancelId: 0, message: 'This draft has unsaved changes.' });
      if (choice === 0) event.preventDefault();
    });
    studio.on('closed', () => { studio = null; output?.close(); app.quit(); });
    if (startupError) void dialog.showMessageBox(studio, { type: 'error', message: startupError });
    screen.on('display-added', displayChanged); screen.on('display-removed', displayChanged); screen.on('display-metrics-changed', displayChanged);
  }).catch(error => { console.error('HECTOR startup failed:', error); app.quit(); });
  app.on('before-quit', () => players.dispose());
  app.on('window-all-closed', () => app.quit());
}
