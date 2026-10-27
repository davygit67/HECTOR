import { app, BrowserWindow, dialog, ipcMain, net, protocol, screen, session as electronSession, Menu, type IpcMainInvokeEvent } from 'electron';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, realpath, rm } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { SceneSession } from '../src/core/session';
import { commandSchema, idSchema, type Scene, type Source } from '../src/core/model';
import type { Snapshot, Transport } from '../src/core/bridge';
import { atomicWrite, readProject } from './persistence';
import { outputAction } from './output-policy';

protocol.registerSchemesAsPrivileged([{ scheme: 'hector-media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }]);
app.setName('HECTOR');
if (process.env.HECTOR_TEST_DATA) app.setPath('userData', resolve(process.env.HECTOR_TEST_DATA));
let studio: BrowserWindow | null = null, output: BrowserWindow | null = null;
let selectedDisplay: number | null = null, disconnected = false, blackout = false, operation = false;
const assets = new Map<string, string>();
let setupNames: string[] = [];
let startupError = '';
let transport: Transport = { playing: true, position: 0, anchor: Date.now(), revision: 0 };
const dataPath = () => join(app.getPath('userData'), 'projects');
const assetEntries = (scene: Scene) => Object.fromEntries(scene.sources.filter(s => s.assetId && assets.has(s.assetId)).map(s => [s.assetId!, assets.get(s.assetId!)!]));
const document = (scene: Scene) => ({ format: 'hector', version: 1, scene, assets: assetEntries(scene) });
const controller = new SceneSession(undefined, async scene => atomicWrite(join(dataPath(), 'current.json'), document(scene)));
const simple = z.enum(['undo', 'redo', 'discard', 'save', 'apply', 'import', 'open', 'export']);
const setupName = z.string().min(1).max(80).regex(/^[\p{L}\p{N} _-]+$/u);
const requestSchema = z.union([
  z.object({ type: simple }).strict(),
  z.object({ type: z.literal('command'), command: commandSchema }).strict(),
  z.object({ type: z.literal('mode'), mode: z.enum(['preview', 'live']), resolution: z.enum(['apply', 'discard', 'cancel']).optional() }).strict(),
  z.object({ type: z.literal('output'), displayId: z.number().int(), fullscreen: z.boolean() }).strict(),
  z.object({ type: z.literal('blackout'), value: z.boolean() }).strict(),
  z.object({ type: z.literal('transport'), playing: z.boolean(), position: z.number().finite().min(0).max(86400).optional() }).strict(),
  z.object({ type: z.literal('relink'), assetId: idSchema }).strict(),
  z.object({ type: z.enum(['setup.save', 'setup.load']), name: setupName }).strict()
]);
const mediaFilters = [{ name: 'Images and videos', extensions: ['png', 'jpg', 'jpeg', 'webp', 'mp4', 'webm', 'mov', 'm4v'] }];
function kind(path: string): 'image' | 'video' {
  const extension = extname(path).toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.webp'].includes(extension)) return 'image';
  if (['.mp4', '.webm', '.mov', '.m4v'].includes(extension)) return 'video';
  throw new Error('Unsupported media extension. Use PNG, JPEG, WebP, MP4, WebM, MOV or M4V. Codec support depends on Chromium.');
}
function snapshot(): Snapshot {
  const primary = screen.getPrimaryDisplay().id;
  return { session: controller.snapshot(),
    displays: screen.getAllDisplays().map(d => ({ id: d.id, label: d.label || `Display ${d.id}`, width: d.size.width, height: d.size.height, primary: d.id === primary })),
    output: { open: !!output, fullscreen: output?.isFullScreen() ?? false, displayId: selectedDisplay, blackout, disconnected }, transport,
    assets: Object.fromEntries([...assets].map(([id, path]) => [id, { url: `hector-media://asset/${id}`, missing: !existsSync(path) }])), setups: setupNames };
}
function broadcast() { const state = snapshot(); for (const window of [studio, output]) if (window && !window.isDestroyed()) window.webContents.send('hector:state', state); }
function authorize(event: IpcMainInvokeEvent, write = false) {
  if (event.sender !== studio?.webContents && (write || event.sender !== output?.webContents)) throw new Error('Unknown or unauthorized window.');
  if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame) throw new Error('Subframes cannot access desktop APIs.');
}
function createWindow(isOutput: boolean) {
  const window = new BrowserWindow({ title: isOutput ? 'HECTOR Output' : 'HECTOR Studio', width: isOutput ? 960 : 1440, height: isOutput ? 540 : 900,
    minWidth: isOutput ? 320 : 1024, minHeight: isOutput ? 240 : 650, show: false, backgroundColor: '#090a0e', autoHideMenuBar: true,
    webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, webSecurity: true } });
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
    output = createWindow(true);
    output.on('closed', () => { output = null; broadcast(); });
    output.on('enter-full-screen', broadcast); output.on('leave-full-screen', broadcast);
    output.webContents.on('before-input-event', (event, input) => { if (input.type === 'keyDown' && input.key === 'Escape') { event.preventDefault(); output?.setFullScreen(false); studio?.focus(); } });
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
/** Drop file grants that no reachable scene (draft, applied, saved, undo/redo) references. */
function pruneAssets() {
  const referenced = new Set(controller.reachableScenes().flatMap(scene => scene.sources.map(s => s.assetId).filter(Boolean)));
  for (const id of assets.keys()) if (!referenced.has(id)) assets.delete(id);
}
async function handle(raw: unknown) {
  const request = requestSchema.parse(raw);
  // Emergency/transport controls remain available during disk operations.
  if (request.type === 'blackout') { blackout = request.value; broadcast(); return { ok: true }; }
  if (request.type === 'transport') {
    const current = transport.position + (transport.playing ? (Date.now() - transport.anchor) / 1000 : 0);
    transport = { playing: request.playing, position: request.position ?? current, anchor: Date.now(), revision: transport.revision + 1 }; broadcast(); return { ok: true };
  }
  if (operation) throw new Error('Wait for the current file operation to finish.');
  operation = true;
  try {
    switch (request.type) {
      case 'command': {
        if (request.command.type === 'source.put' && request.command.source.assetId && !assets.has(request.command.source.assetId)) throw new Error('Media has not been granted through a file picker.');
        controller.command(request.command); break;
      }
      case 'undo': controller.undo(); break;
      case 'redo': controller.redo(); break;
      case 'discard': controller.discard(); break;
      case 'save': await controller.save(); break;
      case 'apply': await controller.save(true); break;
      case 'mode': await controller.switchMode(request.mode, request.resolution); break;
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
          throw new Error(`Portable export failed; nothing was written. ${error instanceof Error ? error.message : String(error)}`);
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
  } finally { operation = false; pruneAssets(); broadcast(); }
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { studio?.show(); studio?.focus(); });
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]) : null);
    electronSession.defaultSession.setPermissionRequestHandler((_w, _p, callback) => callback(false));
    electronSession.defaultSession.setPermissionCheckHandler(() => false);
    protocol.handle('hector-media', async request => {
      try {
        const url = new URL(request.url); if (url.hostname !== 'asset' || !['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 403 });
        const path = assets.get(url.pathname.slice(1)); if (!path) return new Response(null, { status: 404 });
        const resolved = await realpath(path); kind(resolved);
        const response = await net.fetch(pathToFileURL(resolved).href, { method: request.method, headers: request.headers });
        // Granted media is readable by HECTOR's own pages only (CSP media-src/img-src); CORS lets WebGL sample it.
        const headers = new Headers(response.headers); headers.set('Access-Control-Allow-Origin', '*'); headers.set('Cache-Control', 'no-store');
        return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
      } catch { return new Response(null, { status: 404 }); }
    });
    const current = join(dataPath(), 'current.json');
    if (existsSync(current)) {
      try { await stageFile(current); controller.applied = structuredClone(controller.draft); controller.saved = structuredClone(controller.draft); controller.discard(); }
      catch (error) { startupError = `Saved project could not be restored. The file was preserved. ${String(error)}`; }
    }
    const setupsDir = join(dataPath(), 'setups'); await mkdir(setupsDir, { recursive: true });
    setupNames = (await readdir(setupsDir)).filter(n => n.endsWith('.json')).map(n => n.slice(0, -5));
    ipcMain.handle('hector:snapshot', event => { authorize(event); return snapshot(); });
    ipcMain.handle('hector:request', async (event, raw) => {
      try { authorize(event, true); return await handle(raw); }
      catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
    });
    studio = createWindow(false);
    studio.on('close', event => {
      if (!controller.snapshot().unsaved || process.env.HECTOR_TEST_DATA) return;
      const choice = dialog.showMessageBoxSync(studio!, { type: 'question', buttons: ['Keep editing', 'Quit without saving'], defaultId: 0, cancelId: 0, message: 'This draft has unsaved changes.' });
      if (choice === 0) event.preventDefault();
    });
    studio.on('closed', () => { studio = null; output?.close(); app.quit(); });
    if (startupError) void dialog.showMessageBox(studio, { type: 'error', message: startupError });
    screen.on('display-added', displayChanged); screen.on('display-removed', displayChanged); screen.on('display-metrics-changed', displayChanged);
  }).catch(error => { console.error('HECTOR startup failed:', error); app.quit(); });
  app.on('window-all-closed', () => app.quit());
}
