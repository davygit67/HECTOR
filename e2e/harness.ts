// Drives the built HECTOR app through Playwright's Electron support. Each Hector instance owns an isolated profile.
// Native file dialogs are stubbed in the main process; everything else (windows, IPC, decoding, GPU) is real.
import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MediaProbe, Request, RequestResult, Snapshot } from '../src/core/bridge';
import type { Source, Surface } from '../src/core/model';

export type Rgb = [number, number, number];
export type Point = [number, number];
export const fullFrame: Surface['corners'] = [[0, 0], [1, 0], [1, 1], [0, 1]];

export class Hector {
  output: Page | null = null;
  readonly errors: string[] = [];
  pixelCaptureStage = 'idle';
  /** Console errors matching these are expected by the current test (for example a deliberately missing file). */
  readonly expectedErrors: RegExp[] = [];
  private constructor(readonly app: ElectronApplication, readonly studio: Page, readonly profile: string, private ownsProfile: boolean) {}

  static async launch(options: { profile?: string } = {}) {
    const profile = options.profile ?? await mkdtemp(join(tmpdir(), 'hector-e2e-'));
    const env: Record<string, string> = { ...process.env as Record<string, string>, HECTOR_TEST_DATA: profile };
    delete env.ELECTRON_RUN_AS_NODE; delete env.HECTOR_DEV_URL;
    const app = await electron.launch({ args: ['.'], cwd: process.cwd(), env, timeout: 120_000 });
    const studio = await app.firstWindow();
    const hector = new Hector(app, studio, profile, !options.profile);
    hector.watch(studio, 'studio');
    await studio.waitForSelector('.canvas-frame canvas.projection');
    return hector;
  }
  private watch(page: Page, name: string) {
    page.on('pageerror', e => this.errors.push(`${name} pageerror: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error' && !this.expectedErrors.some(r => r.test(m.text()))) this.errors.push(`${name} console: ${m.text()}`); });
  }
  /** Close the app; keep the profile when another launch will reuse it. */
  async close({ keepProfile = false } = {}) {
    await this.app.close().catch(() => {});
    if (this.ownsProfile && !keepProfile) await rm(this.profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
  expectNoErrors() { expect(this.errors, 'renderer errors').toEqual([]); }

  request(request: Request, page: Page = this.studio): Promise<RequestResult> { return page.evaluate(r => window.hector!.request(r), request); }
  async ok(request: Request) { const result = await this.request(request); expect(result.error ?? '').toBe(''); expect(result.ok).toBe(true); return result; }
  snapshot(page: Page = this.studio): Promise<Snapshot> { return page.evaluate(() => window.hector!.snapshot()); }
  async media(page: Page, sourceId: string): Promise<MediaProbe | undefined> {
    return (await page.evaluate(() => window.hectorProbe?.snapshot() ?? null))?.media.find(m => m.sourceId === sourceId);
  }
  async draft() { return (await this.snapshot()).session.draft; }
  async applied() { return (await this.snapshot()).session.applied; }
  async updateSurface(patch: Partial<Omit<Surface, 'id'>>, id = 'surface-1') { return this.ok({ type: 'command', command: { type: 'surface.update', id, patch } }); }
  async putSource(id: string, patch: Partial<Source>) {
    const source = (await this.draft()).sources.find(s => s.id === id)!;
    return this.ok({ type: 'command', command: { type: 'source.put', source: { ...source, ...patch } } });
  }

  async openOutput(fullscreen = false) {
    const displayId = (await this.snapshot()).displays[0].id;
    await this.ok({ type: 'output', displayId, fullscreen });
    if (!this.output || this.output.isClosed()) {
      const find = () => this.app.windows().find(w => !w.isClosed() && w.url().includes('output=1'));
      await expect.poll(() => !!find()).toBe(true);
      this.output = find()!;
      this.watch(this.output, 'output');
    }
    await this.output.waitForSelector('.output canvas.projection');
    return this.output;
  }
  outputWindowId() {
    return this.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('output=1'))?.id ?? null);
  }
  /** Replace native dialogs in main. `null` simulates Cancel. */
  async stubDialogs(stubs: { open?: string[] | null; save?: string | null }) {
    await this.app.evaluate(({ dialog }, { open, save, hasOpen, hasSave }) => {
      const target = dialog as unknown as Record<string, unknown>;
      if (hasOpen) target.showOpenDialog = async () => open ? { canceled: false, filePaths: open } : { canceled: true, filePaths: [] };
      if (hasSave) target.showSaveDialog = async () => save ? { canceled: false, filePath: save } : { canceled: true, filePath: '' };
    }, { open: stubs.open ?? null, save: stubs.save ?? null, hasOpen: 'open' in stubs, hasSave: 'save' in stubs });
  }
  /** Import files through the (stubbed) native picker; returns the new sources in import order. */
  async importFiles(paths: string[]) {
    const before = new Set((await this.draft()).sources.map(s => s.id));
    await this.stubDialogs({ open: paths });
    await this.ok({ type: 'import' });
    return (await this.draft()).sources.filter(s => !before.has(s.id));
  }
  /** Average RGB around normalized points of a window's projection canvas, from a real screenshot. */
  async pixels(page: Page, points: Point[]): Promise<Rgb[]> {
    const canvas = page.locator('canvas.projection');
    this.pixelCaptureStage = 'scroll';
    await canvas.scrollIntoViewIfNeeded();
    this.pixelCaptureStage = 'bounds';
    const bounds = await canvas.boundingBox();
    if (!bounds) throw new Error('Projection canvas is not visible.');
    const rect = { x: Math.floor(bounds.x), y: Math.floor(bounds.y), width: Math.ceil(bounds.width), height: Math.ceil(bounds.height) };
    // Capture the composited Electron page directly. Chromium's DevTools screenshot path can stall on
    // continuously animated WebGL canvases on Windows even while the renderer and ambient worker are healthy.
    this.pixelCaptureStage = 'window';
    const window = await this.app.browserWindow(page);
    this.pixelCaptureStage = 'capture';
    const result = await window.evaluate(async (window, { rect, points }) => {
      const image = (await window.webContents.capturePage(rect)).resize({ width: 480 });
      const { width, height } = image.getSize(), bitmap = image.toBitmap();
      return points.map(([x, y]) => {
        const px = Math.min(width - 2, Math.max(1, Math.round(x * (width - 1)))), py = Math.min(height - 2, Math.max(1, Math.round(y * (height - 1))));
        let r = 0, g = 0, b = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const i = ((py + dy) * width + px + dx) * 4; b += bitmap[i]; g += bitmap[i + 1]; r += bitmap[i + 2]; }
        return [Math.round(r / 9), Math.round(g / 9), Math.round(b / 9)] as [number, number, number];
      });
    }, { rect, points });
    this.pixelCaptureStage = 'complete';
    await window.dispose();
    return result;
  }
}

export const colors = { red: [255, 0, 0] as Rgb, green: [0, 255, 0] as Rgb, blue: [0, 0, 255] as Rgb, white: [255, 255, 255] as Rgb, black: [0, 0, 0] as Rgb, magenta: [255, 0, 255] as Rgb };
export function near(actual: Rgb, expected: Rgb, tolerance = 40) { return actual.every((v, i) => Math.abs(v - expected[i]) <= tolerance); }
export function expectColors(actual: Rgb[], expected: Rgb[], tolerance = 40) {
  const describe = (list: Rgb[]) => list.map(c => `(${c.join(',')})`).join(' ');
  expect(actual.every((c, i) => near(c, expected[i], tolerance)), `pixels ${describe(actual)} vs expected ${describe(expected)}`).toBe(true);
}

