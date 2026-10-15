import { app, ipcMain } from 'electron';
import { createInterface } from 'node:readline';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MediaSources } from './media-sources.js';
import { startStaticPreview } from '../host/static-preview.js';
import { readScene } from '../src/shared/domain.js';
import type { MediaEvent } from '../src/shared/media.js';

// Private child-process pipe only. No HTTP scene/control endpoint or desktop window.
const root = fileURLToPath(new URL('../../', import.meta.url));
// Bitmap-only source: software rendering avoids Windows GPU readback/driver failures.
if (process.env.PM_MEDIA_SOFTWARE === '1') app.disableHardwareAcceleration();
app.setName('Projection Video Renderer');
app.setPath('userData', resolve(process.env.PM_MEDIA_DATA!));
let media: MediaSources | undefined, assets: Awaited<ReturnType<typeof startStaticPreview>> | undefined;
let blocked = false;
function write(value: unknown) { blocked = !process.stdout.write('PM_MEDIA:' + JSON.stringify(value) + '\n'); }
process.stdout.on('drain', () => { blocked = false; });
function wire(event: MediaEvent) {
  return event.type === 'frame' ? { ...event, frame: { ...event.frame, jpeg: Buffer.from(event.frame.jpeg).toString('base64') } } : event;
}
app.whenReady().then(async () => {
  app.dock?.hide();
  assets = await startStaticPreview(join(root, 'dist'));
  media = new MediaSources(assets.origin, join(root, 'electron/source-preload.cjs'), event => {
    if (event.type !== 'frame' || !blocked) write({ event: wire(event) });
  }, { canProcessFrame: () => !blocked });
  ipcMain.on('media:source-state', (event, value) => media?.report(event.sender, event.senderFrame === event.sender.mainFrame, value));
  const lines = createInterface({ input: process.stdin });
  lines.on('line', line => {
    if (line.length > 1000000) return;
    let request: { id: string; action: string; value?: unknown };
    try { request = JSON.parse(line); } catch { return; }
    try {
      if (request.action === 'sync') media!.sync(readScene(request.value));
      else if (request.action === 'command') media!.command(request.value);
      else if (request.action === 'input') media!.input(request.value);
      else if (request.action === 'snapshot') { write({ id: request.id, value: media!.snapshot().map(wire) }); return; }
      else throw new Error('Unknown media operation.');
      write({ id: request.id });
    } catch (error) { write({ id: request.id, error: error instanceof Error ? error.message : String(error) }); }
  });
  lines.on('close', () => app.quit());
  write({ ready: true });
}).catch(error => { write({ fatal: String(error) }); app.quit(); });
app.on('before-quit', () => { media?.dispose(); assets?.close(); });
// Offscreen source removal must not terminate the service while the site is open.
app.on('window-all-closed', () => {});
