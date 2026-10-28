import { validateProgramDefinition, PROGRAM_LIMITS, type ProgramArtifact } from '../src/shared/program.js';
import { createHash } from 'node:crypto';
import { MediaSources } from './media-sources.js';
import { app, BrowserWindow, ipcMain, Menu, screen, type IpcMainInvokeEvent } from 'electron';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { initialScene, readScene, reduceScene, type Command } from '../src/shared/domain.js';
import { createChatController, localAgentFactory } from '../host/chat-controller.js';
import { createCanvasRpc } from '../host/canvas-rpc.js';
import { reduceBatch } from '../src/shared/studioScene.js';
import type { MemoryRequest, StudioSnapshot, StudioResult, StudioObservation } from '../src/shared/studio.js';
import type { MappingObservation } from '../src/shared/mappingWorkshop.js';
import { createCloudReceiver, localCloudReceiverLoader } from '../host/cloud-receiver.js';
import type { CloudRelayAction } from '../src/shared/cloudRelay.js';
import { startStaticPreview } from '../host/static-preview.js';
import { LocalAssets } from '../host/local-assets.js';
import { isChatCommand } from '../src/shared/chat.js';
import type { CommandReceipt, OutputCommand, Snapshot } from '../src/shared/bridge.js';
import { isOutputCalibrationCommand } from '../src/shared/outputPermissions.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
// Development data stays next to the project and never shares another Electron app's profile.
const dataDir = process.env.PM_DATA_DIR ? resolve(process.env.PM_DATA_DIR) : join(root, '.local-data');
mkdirSync(dataDir, { recursive: true });
app.setName('Projection Mapper');
app.setPath('userData', join(dataDir, 'electron'));
const saveFile = join(dataDir, 'scene.json');
let scene = initialScene();
let saveStatus: Snapshot['saveStatus'] = 'saved';
let saveError: string | null = null;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let control: BrowserWindow | null = null;
let output: BrowserWindow | null = null;
let quitting = false;
let media: MediaSources | undefined;
let assets: Awaited<ReturnType<typeof startStaticPreview>> | undefined;

if (existsSync(saveFile)) {
  try {
    const raw = JSON.parse(readFileSync(saveFile, 'utf8'));
    scene = readScene(raw);
    if ([1, 2].includes(raw.schemaVersion) && !existsSync(`${saveFile}.pre-v3-backup`)) copyFileSync(saveFile, `${saveFile}.pre-v3-backup`);
  }
  catch (error) {
    // Preserve evidence for recovery before accepting new edits.
    try { renameSync(saveFile, `${saveFile}.invalid-${Date.now()}`); }
    catch { /* Save error below remains visible. */ }
    saveStatus = 'error'; saveError = `Could not restore the previous layout: ${String(error)}`;
  }
}

function snapshot(): Snapshot {
  const primaryId = screen.getPrimaryDisplay().id;
  return {
    scene, saveStatus, saveError, storage: 'disk',
    displays: screen.getAllDisplays().map(d => ({ id: String(d.id), label: d.label || (d.id === primaryId ? 'Mac display' : 'External display'),
      width: d.size.width, height: d.size.height, scale: d.scaleFactor, primary: d.id === primaryId })),
    output: { open: !!output && !output.isDestroyed(), fullscreen: output?.isFullScreen() ?? false,
      displayId: output ? String(screen.getDisplayMatching(output.getBounds()).id) : null },
  };
}
function broadcast() {
  if (!app.isReady()) return;
  const value = snapshot();
  for (const win of [control, output]) if (win && !win.isDestroyed()) win.webContents.send('scene:snapshot', value);
}
function save() {
  clearTimeout(saveTimer); saveTimer = undefined;
  try {
    writeFileSync(`${saveFile}.tmp`, JSON.stringify(scene, null, 2), 'utf8');
    renameSync(`${saveFile}.tmp`, saveFile);
    saveStatus = 'saved'; saveError = null;
  } catch (error) { saveStatus = 'error'; saveError = `Layout could not be saved: ${String(error)}`; }
  broadcast();
}
function queueSave() {
  clearTimeout(saveTimer); saveStatus = 'saving';
  saveTimer = setTimeout(save, 250);
}
function applyCommand(command: Command): CommandReceipt {
  try { scene = reduceScene(scene, command); media?.sync(scene); queueSave(); broadcast(); return { ok: true, scene: structuredClone(scene) }; }
  catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
}
const studioRpc = createCanvasRpc(request => {
  if (!control || control.isDestroyed()) throw new Error('Studio is not open.');
  control.webContents.send('studio:rpc', request);
}, 10000, () => chat.cancel());
const chat = createChatController({
  getSnapshot: async () => structuredClone(snapshot()),
  dispatch: async command => isChatCommand(command) ? applyCommand(command) : { ok: false, error: 'That operation is not available to the assistant.' },
  studio: {
    inspect: () => studioRpc.request<StudioSnapshot>({ operation: 'studio.inspect' }),
    execute: request => studioRpc.request<StudioResult>({ operation: 'studio.execute', request }),
    observe: request => studioRpc.request<StudioObservation>({ operation: 'studio.observe', request }),
    observeMapping: request => studioRpc.request<MappingObservation>({ operation:'studio.observeMapping',request }),
  },
}, localAgentFactory(root, dataDir), value => {
  if (control && !control.isDestroyed()) control.webContents.send('chat:state', value);
});
const cloud = createCloudReceiver(localCloudReceiverLoader(root), dataDir);
let releaseCloudTarget: (() => void) | undefined;
function registerCloudTarget() {
  releaseCloudTarget?.();
  releaseCloudTarget = cloud.register('desktop-studio', {
    ready: () => !!control && !control.isDestroyed() && !control.webContents.isLoadingMainFrame() && chat.currentState().ready && !chat.currentState().busy,
    deliver: prompt => chat.send(prompt, 'cloud'), cancel: () => chat.cancel(),
  });
}
function authorizeChat(event: IpcMainInvokeEvent) {
  authorize(event);
  if (event.sender !== control?.webContents) throw new Error('Use chat in the control window.');
}
function secure(win: BrowserWindow) {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
}
function openOutput(displayId?: string) {
  const display = screen.getAllDisplays().find(d => String(d.id) === displayId) ?? screen.getPrimaryDisplay();
  if (!output) {
    output = new BrowserWindow({ title: 'Projection output', width: 800, height: 450, useContentSize: true,
      backgroundColor: '#000000', show: false, autoHideMenuBar: true,
      webPreferences: { preload: join(root, 'electron/preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    secure(output);
    output.loadURL(assets!.origin + '/?view=output');
    output.once('ready-to-show', () => { output?.showInactive(); broadcast(); });
    output.on('closed', () => { output = null; broadcast(); });
    output.on('enter-full-screen', broadcast); output.on('leave-full-screen', broadcast);
    output.on('move', broadcast); output.on('resize', broadcast);
    output.webContents.on('before-input-event', (event, input) => {
      if (input.key === 'Escape' && input.type === 'keyDown') { event.preventDefault(); output?.setFullScreen(false); control?.focus(); }
    });
  }
  if (displayId || !output.isVisible()) {
    output.setFullScreen(false);
    const width = Math.min(800, display.workArea.width - 60);
    const height = Math.min(Math.round(width * 9 / 16) + 30, display.workArea.height - 60);
    output.setBounds({ x: display.workArea.x + display.workArea.width - width - 24, y: display.workArea.y + 48, width, height });
  }
  output.showInactive(); broadcast();
}
function authorize(event: IpcMainInvokeEvent) {
  if (event.sender !== control?.webContents && event.sender !== output?.webContents) throw new Error('Unknown window.');
  if (event.senderFrame !== event.sender.mainFrame) throw new Error('Subframe access denied.');
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { control?.show(); control?.focus(); });
  app.whenReady().then(async () => {
    const localAssets = new LocalAssets(join(dataDir, 'media-assets'));
    assets = await startStaticPreview(join(root, 'dist'), localAssets);
    ipcMain.handle('assets:store', (event, path, mimeType) => { authorizeChat(event); return localAssets.store(path, mimeType); });
    ipcMain.handle('assets:resolve', (event, id) => { authorize(event); return localAssets.url(id); });
    ipcMain.handle('assets:remove', (event, id) => { authorizeChat(event); return localAssets.remove(id); });
    const programsFile = join(dataDir, 'programs.json'), progressFile = join(dataDir, 'program-progress.json');
    ipcMain.handle('programs:read', event => { authorize(event); return existsSync(programsFile) ? JSON.parse(readFileSync(programsFile, 'utf8')) : []; });
    ipcMain.handle('programs:put', (event, artifact: ProgramArtifact) => {
      authorizeChat(event); validateProgramDefinition(artifact?.definition);
      if (JSON.stringify(artifact).length > 650000 || !artifact.report?.passed || artifact.id !== createHash('sha256').update(JSON.stringify(artifact.definition)).digest('hex')) throw new Error('Invalid tested program artifact.');
      const entries: ProgramArtifact[] = existsSync(programsFile) ? JSON.parse(readFileSync(programsFile, 'utf8')) : [];
      if (entries.some(a => a.id === artifact.id)) return;
      if (entries.length >= PROGRAM_LIMITS.artifacts) throw new Error('Program library is full (30 versions).');
      writeFileSync(programsFile + '.tmp', JSON.stringify([...entries, artifact]), { encoding: 'utf8', mode: 0o600 }); renameSync(programsFile + '.tmp', programsFile);
    });
    ipcMain.handle('programs:state:read', event => { authorizeChat(event); return existsSync(progressFile) ? readFileSync(progressFile, 'utf8') : null; });
    ipcMain.handle('programs:state:write', (event, value: unknown) => {
      authorizeChat(event); if (typeof value !== 'string' || value.length > 2400000) throw new Error('Program progress storage limit exceeded.');
      JSON.parse(value); writeFileSync(progressFile + '.tmp', value, { encoding: 'utf8', mode: 0o600 }); renameSync(progressFile + '.tmp', progressFile);
    });
    const libraryFile = join(dataDir, 'compositions.json');
    ipcMain.handle('library:read', event => { authorizeChat(event); return existsSync(libraryFile) ? JSON.parse(readFileSync(libraryFile, 'utf8')) : []; });
    ipcMain.handle('library:write', (event, items: unknown) => {
      authorizeChat(event);
      if (!Array.isArray(items) || items.length > 20 || JSON.stringify(items).length > 1000000) throw new Error('Composition library exceeds its storage limit.');
      writeFileSync(libraryFile + '.tmp', JSON.stringify(items), { encoding: 'utf8', mode: 0o600 }); renameSync(libraryFile + '.tmp', libraryFile);
    });
    media = new MediaSources(assets.origin, join(root, 'electron/source-preload.cjs'), event => {
      for (const win of [control, output]) if (win && !win.isDestroyed()) win.webContents.send('media:event', event);
    });
    ipcMain.on('media:source-state', (event, value) => media?.report(event.sender, event.senderFrame === event.sender.mainFrame, value));
    ipcMain.handle('media:snapshot', event => { authorize(event); return media!.snapshot(); });
    ipcMain.handle('media:input', (event, input) => { authorizeChat(event); media!.input(input); });
    ipcMain.handle('media:command', (event, command) => { authorizeChat(event); media!.command(command); });
    ipcMain.handle('scene:get', event => { authorize(event); return snapshot(); });
    ipcMain.handle('scene:command', (event, command: Command): CommandReceipt => {
      authorize(event);
      if (event.sender !== control?.webContents && !isOutputCalibrationCommand(command)) return { ok: false, error: 'Use the studio to edit content. This window can adjust manual alignment.' };
      return applyCommand(command);
    });
    ipcMain.handle('scene:batch', (event, commands: Command[], expectedRevision: number): CommandReceipt => {
      authorizeChat(event);
      try { scene = reduceBatch(scene, commands, expectedRevision); media?.sync(scene); queueSave(); broadcast(); return { ok: true, scene: structuredClone(scene) }; }
      catch (error) { return { ok: false, error: error instanceof Error ? error.message : 'Could not apply composition.' }; }
    });
    ipcMain.on('studio:reply', (event, reply) => { if (event.sender === control?.webContents && event.senderFrame === event.sender.mainFrame) studioRpc.receive(reply); });
    ipcMain.handle('chat:memory', (event, request: MemoryRequest) => { authorizeChat(event); return chat.memory(request); });
    ipcMain.handle('chat:relay', (event, action: CloudRelayAction) => { authorizeChat(event); return cloud.request('desktop-studio', action); });
    ipcMain.handle('chat:get', event => { authorizeChat(event); return chat.getState(); });
    ipcMain.handle('chat:send', (event, prompt: string) => { authorizeChat(event); return chat.send(prompt); });
    ipcMain.handle('chat:cancel', event => { authorizeChat(event); chat.cancel(); });
    ipcMain.handle('chat:clear', event => { authorizeChat(event); chat.clear(); });
    ipcMain.handle('output:command', (event, command: OutputCommand) => {
      authorize(event);
      if (event.sender !== control?.webContents) throw new Error('Use the control window.');
      if (!['open', 'fullscreen', 'windowed'].includes(command.action)) throw new Error('Unknown output command.');
      if (command.displayId && !screen.getAllDisplays().some(d => String(d.id) === command.displayId)) throw new Error('That display is no longer connected.');
      if (!output || command.action === 'open' || command.displayId) openOutput(command.displayId);
      if (command.action === 'fullscreen') { output?.show(); output?.setFullScreen(true); }
      if (command.action === 'windowed') output?.setFullScreen(false);
      broadcast();
    });
    const work = screen.getPrimaryDisplay().workArea;
    control = new BrowserWindow({ title: 'Projection Mapper — Studio', width: Math.min(1360, work.width), height: Math.min(940, work.height),
      minWidth: 940, minHeight: 680, backgroundColor: '#f5f4ef', show: false,
      webPreferences: { preload: join(root, 'electron/preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    secure(control);
    control.webContents.on('did-start-loading', () => { releaseCloudTarget?.(); releaseCloudTarget = undefined; });
    control.webContents.on('did-finish-load', registerCloudTarget);
    control.loadURL(assets.origin + '/');
    control.once('ready-to-show', () => { control?.show(); control?.focus(); });
    control.on('closed', () => { releaseCloudTarget?.(); releaseCloudTarget = undefined; control = null; if (!quitting) app.quit(); });
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'Projection Mapper', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] },
      { role: 'editMenu' },
      { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'front' }] },
      { label: 'Developer', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }] },
    ]));
    openOutput();
    media.sync(scene);
    const displaysChanged = () => {
      // Electron may already move the window when a monitor disconnects; ensure it is reachable.
      if (output && !screen.getAllDisplays().some(d => {
        const b = output!.getBounds(); return b.x < d.bounds.x + d.bounds.width && b.x + b.width > d.bounds.x && b.y < d.bounds.y + d.bounds.height && b.y + b.height > d.bounds.y;
      })) openOutput(String(screen.getPrimaryDisplay().id));
      broadcast();
    };
    screen.on('display-added', displaysChanged); screen.on('display-removed', displaysChanged); screen.on('display-metrics-changed', displaysChanged);
  }).catch(error => { console.error('Could not open Projection Mapper:', error); app.quit(); });
  let quitCleanup: Promise<void> | undefined;
  let quitCleanupDone = false;
  app.on('before-quit', event => {
    if (quitCleanupDone) return;
    event.preventDefault(); if (quitCleanup) return; quitting = true;
    media?.dispose(); assets?.close(); chat.dispose(); if (saveTimer) save();
    // Finish a cancelled delivery receipt and release its process lock on normal exit.
    quitCleanup = cloud.dispose().finally(() => { quitCleanupDone = true; app.quit(); });
  });
  app.on('window-all-closed', () => app.quit());
}
