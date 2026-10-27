// Desktop qualification smoke test. Launches the built app with an isolated profile and drives real windows.
// It does not exercise physical projectors, display disconnects, or OS-native file dialogs (the dialog is stubbed in main).
import { _electron as electron, expect } from '@playwright/test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

const profile = await mkdtemp(join(tmpdir(), 'hector-smoke-'));
const env = { ...process.env, HECTOR_TEST_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE; delete env.HECTOR_DEV_URL;
const errors = [];
const watch = (page, name) => {
  page.on('pageerror', e => errors.push(`${name} pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`${name} console: ${m.text()}`); });
};
const launch = async () => {
  const app = await electron.launch({ args: ['.'], cwd: process.cwd(), env, timeout: 120000 });
  const studio = await app.firstWindow(); watch(studio, 'studio'); await studio.waitForSelector('.canvas-frame');
  return { app, studio };
};
const request = (page, value) => page.evaluate(r => window.hector.request(r), value);
const snapshot = page => page.evaluate(() => window.hector.snapshot());
const probe = page => page.evaluate(() => window.hectorProbe?.() ?? null);
const outputWindowId = app => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('output=1'))?.id ?? null);
const findOutput = async (app, studio) => {
  await expect.poll(async () => (await app.windows()).length).toBe(2);
  const output = (await app.windows()).find(w => w !== studio); watch(output, 'output');
  await output.waitForSelector('.output canvas'); return output;
};
const videoProbe = async (page, sourceId) => (await probe(page))?.media.find(m => m.sourceId === sourceId);
const percentile = (values, p) => { const s = [...values].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const step = name => console.log(`  ✓ ${name}`);
// MediaRecorder WebM omits Segment Info Duration, which makes the clip unseekable. Insert it (TimecodeScale 1 ms).
function withDuration(buffer, ms) {
  const at = buffer.indexOf(Buffer.from([0x15, 0x49, 0xa9, 0x66])); if (at < 0) throw new Error('WebM Info element not found');
  const sizeAt = at + 4, first = buffer[sizeAt]; let width = 1; while (width < 8 && !(first & (0x80 >> (width - 1)))) width++;
  let size = first & (0xff >> width); for (let i = 1; i < width; i++) size = size * 256 + buffer[sizeAt + i];
  const next = size + 11; if (next >= 2 ** (7 * width) - 1) throw new Error('WebM Info size cannot grow in place');
  const sizeBytes = Buffer.alloc(width); for (let i = width - 1, v = next; i >= 0; i--, v = Math.floor(v / 256)) sizeBytes[i] = v & 0xff;
  sizeBytes[0] |= 0x80 >> (width - 1);
  const duration = Buffer.alloc(11); duration[0] = 0x44; duration[1] = 0x89; duration[2] = 0x88; duration.writeDoubleBE(ms, 3);
  return Buffer.concat([buffer.subarray(0, sizeAt), sizeBytes, duration, buffer.subarray(sizeAt + width)]);
}

let app, studio;
try {
  ({ app, studio } = await launch());
  await expect(studio.locator('.brand')).toContainText('HECTOR');
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle())).toBe('HECTOR Studio');
  step('studio launched with stable native title');

  const before = await snapshot(studio), displayId = before.displays[0].id;
  console.log(`  displays: ${before.displays.map(d => `${d.label} ${d.width}x${d.height}${d.primary ? ' (primary)' : ''}`).join('; ')}`);
  expect((await request(studio, { type: 'output', displayId, fullscreen: false })).ok).toBe(true);
  let output = await findOutput(app, studio);
  const outputId = await outputWindowId(app);
  expect(outputId).not.toBeNull();
  expect(await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).getTitle(), outputId)).toBe('HECTOR Output');
  await expect(output.locator('button, input, select, svg')).toHaveCount(0);
  expect(await output.evaluate(() => getComputedStyle(document.querySelector('.output')).cursor)).toBe('none');
  step('content-only output window with hidden cursor');

  const change = await request(studio, { type: 'command', command: { type: 'surface.update', id: 'surface-1', patch: { opacity: .45 } } });
  expect(change.ok).toBe(true);
  const staged = await snapshot(output);
  expect(staged.session.applied.surfaces[0].opacity).toBe(1); expect(staged.session.draft.surfaces[0].opacity).toBe(.45);
  await studio.getByRole('button', { name: 'Apply & Save', exact: true }).click();
  await expect.poll(async () => (await snapshot(output)).session.applied.surfaces[0].opacity).toBe(.45);
  expect((await request(output, { type: 'blackout', value: true })).ok).toBe(false);
  step('preview edits staged; Apply & Save publishes; output cannot mutate');

  const security = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(w => w.webContents.getLastWebPreferences()));
  for (const p of security) { expect(p.contextIsolation).toBe(true); expect(p.sandbox).toBe(true); expect(p.nodeIntegration).toBe(false); }
  step('secure web preferences on both windows');

  // Real local video: record a WebM in Chromium, then import through a stubbed main-process dialog.
  const recording = await studio.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
    const ctx = canvas.getContext('2d'), stream = canvas.captureStream(30);
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' }), chunks = [];
    recorder.ondataavailable = e => chunks.push(e.data);
    const started = performance.now(); let raf = 0;
    const draw = () => { const t = (performance.now() - started) / 1000; ctx.fillStyle = `hsl(${t * 60} 70% 45%)`; ctx.fillRect(0, 0, 320, 180);
      ctx.fillStyle = '#fff'; ctx.font = '48px monospace'; ctx.fillText(t.toFixed(1), 100, 110); raf = requestAnimationFrame(draw); };
    draw(); recorder.start(250); await new Promise(r => setTimeout(r, 8000)); recorder.stop(); cancelAnimationFrame(raf);
    await new Promise(r => { recorder.onstop = r; }); const duration = performance.now() - started;
    const bytes = new Uint8Array(await new Blob(chunks, { type: 'video/webm' }).arrayBuffer());
    let text = ''; for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return { base64: btoa(text), duration };
  });
  const fixture = join(profile, 'fixture.webm'); await writeFile(fixture, withDuration(Buffer.from(recording.base64, 'base64'), recording.duration));
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, fixture);
  expect((await request(studio, { type: 'import' })).ok).toBe(true);
  const video = (await snapshot(studio)).session.draft.sources.find(s => s.kind === 'video');
  expect(video).toBeTruthy();
  expect((await request(studio, { type: 'command', command: { type: 'surface.update', id: 'surface-1', patch: { sourceId: video.id } } })).ok).toBe(true);
  expect((await videoProbe(output, video.id))).toBeUndefined();
  step('imported video stays out of output until applied');
  expect((await request(studio, { type: 'transport', playing: true, position: 0 })).ok).toBe(true);
  expect((await request(studio, { type: 'apply' })).ok).toBe(true);
  await expect.poll(async () => (await videoProbe(output, video.id))?.currentTime ?? 0, { timeout: 15000 }).toBeGreaterThan(1);
  const playing = await videoProbe(output, video.id);
  expect(playing.error).toBe(''); expect(playing.paused).toBe(false);
  // The projected pixels must change while playing (texture uploads follow decoded frames).
  const frameA = await output.screenshot(); await output.waitForTimeout(700); const frameB = await output.screenshot();
  expect(frameA.equals(frameB)).toBe(false);
  step(`output decodes and plays local video (t=${playing.currentTime.toFixed(2)}s)`);

  // Geometry/effects edits, panel switches and AI drawer must not rebuild the decoder or restart playback.
  const previewBefore = await videoProbe(studio, video.id);
  await request(studio, { type: 'command', command: { type: 'surface.update', id: 'surface-1', patch: { corners: [[.1, .1], [.9, .12], [.88, .9], [.12, .88]], brightness: 1.2 } } });
  await studio.getByRole('button', { name: 'AI assistant', exact: true }).click();
  await studio.getByRole('button', { name: 'Media', exact: true }).click();
  await studio.getByRole('button', { name: 'Effects', exact: true }).click();
  const beforeApply = await videoProbe(output, video.id);
  expect((await request(studio, { type: 'apply' })).ok).toBe(true);
  await expect.poll(async () => (await snapshot(output)).session.applied.surfaces[0].brightness).toBe(1.2);
  await output.waitForTimeout(500);
  const afterApply = await videoProbe(output, video.id);
  expect(afterApply.generation).toBe(beforeApply.generation);
  expect(afterApply.currentTime).toBeGreaterThan(beforeApply.currentTime);
  expect((await videoProbe(studio, video.id)).generation).toBe(previewBefore.generation);
  expect(await outputWindowId(app)).toBe(outputId);
  step(`geometry/effects apply kept decoder and clock (${beforeApply.currentTime.toFixed(2)}s → ${afterApply.currentTime.toFixed(2)}s), output window identity stable`);

  // Blackout is immediate and does not stop the media clock.
  await studio.getByRole('button', { name: 'Blackout', exact: true }).click();
  await expect.poll(async () => (await snapshot(output)).output.blackout).toBe(true);
  const dark = await videoProbe(output, video.id); await output.waitForTimeout(600);
  expect((await videoProbe(output, video.id)).currentTime).toBeGreaterThan(dark.currentTime);
  await studio.getByRole('button', { name: 'Restore output', exact: true }).click();
  await expect.poll(async () => (await snapshot(output)).output.blackout).toBe(false);
  step('blackout immediate; playback continues underneath');

  // Pause and seek are immediate operational controls.
  expect((await request(studio, { type: 'transport', playing: false, position: 2 })).ok).toBe(true);
  await expect.poll(async () => (await videoProbe(output, video.id)).paused).toBe(true);
  await expect.poll(async () => (await videoProbe(output, video.id)).currentTime).toBeCloseTo(2, 1);
  const paused = await videoProbe(output, video.id);
  await output.waitForTimeout(400);
  expect((await videoProbe(output, video.id)).currentTime).toBeCloseTo(paused.currentTime, 2);
  expect((await request(studio, { type: 'transport', playing: true })).ok).toBe(true);
  await expect.poll(async () => (await videoProbe(output, video.id)).paused).toBe(false);
  step(`pause holds the frame; seek lands at ${paused.currentTime.toFixed(2)}s; resume continues`);

  // Frame pacing sample from the output renderer (this machine, windowed, not a projector).
  await output.waitForTimeout(3000);
  const sample = (await probe(output)).intervals.slice(-180);
  const metrics = { platform: process.platform, frames: sample.length, meanMs: sample.reduce((a, b) => a + b, 0) / sample.length,
    p95Ms: percentile(sample, .95), p99Ms: percentile(sample, .99), maxMs: Math.max(...sample), over25ms: sample.filter(v => v > 25).length,
    droppedVideoFrames: (await videoProbe(output, video.id)).droppedFrames };
  console.log(`  output pacing (last ${metrics.frames} frames): mean ${metrics.meanMs.toFixed(2)} ms, p95 ${metrics.p95Ms.toFixed(2)} ms, p99 ${metrics.p99Ms.toFixed(2)} ms, max ${metrics.maxMs.toFixed(2)} ms, >25 ms: ${metrics.over25ms}, decoder drops: ${metrics.droppedVideoFrames}`);

  // Fullscreen must survive studio focus.
  expect((await request(studio, { type: 'output', displayId, fullscreen: true })).ok).toBe(true);
  await expect.poll(() => app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).isFullScreen(), outputId), { timeout: 10000 }).toBe(true);
  await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.getAllWindows().find(w => w.id !== id).focus(), outputId);
  await studio.waitForTimeout(1000);
  expect(await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).isFullScreen(), outputId)).toBe(true);
  expect((await request(studio, { type: 'output', displayId, fullscreen: false })).ok).toBe(true);
  await expect.poll(() => app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).isFullScreen(), outputId), { timeout: 10000 }).toBe(false);
  expect(await outputWindowId(app)).toBe(outputId);
  step('output fullscreen survives studio focus; windowed toggle keeps window identity');

  await studio.getByRole('button', { name: 'AI assistant', exact: true }).click();
  await studio.getByRole('button', { name: 'Layers', exact: true }).click();
  await mkdir(resolve('artifacts'), { recursive: true });
  await studio.screenshot({ path: resolve('artifacts/studio-smoke.png') });
  await output.screenshot({ path: resolve('artifacts/output-smoke.png') });
  await writeFile(resolve('artifacts/smoke-metrics.json'), JSON.stringify(metrics, null, 2));

  // Close and reopen output: applied scene and video return in a fresh window.
  await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).close(), outputId);
  await expect.poll(async () => (await snapshot(studio)).output.open).toBe(false);
  expect((await request(studio, { type: 'output', displayId, fullscreen: false })).ok).toBe(true);
  output = await findOutput(app, studio);
  await expect.poll(async () => (await videoProbe(output, video.id))?.currentTime ?? 0, { timeout: 15000 }).toBeGreaterThan(0);
  step('output close/reopen restores applied scene and video');

  expect(errors).toEqual([]);
  await app.close(); app = null;

  // Restart with the same profile: the saved scene and media grant are restored.
  ({ app, studio } = await launch());
  const restored = (await snapshot(studio)).session;
  expect(restored.applied.surfaces[0].sourceId).toBe(video.id);
  expect(restored.applied.surfaces[0].brightness).toBe(1.2);
  expect(restored.unapplied).toBe(false); expect(restored.unsaved).toBe(false);
  await expect.poll(async () => (await videoProbe(studio, video.id))?.readyState ?? 0, { timeout: 15000 }).toBeGreaterThan(1);
  step('restart restores saved scene and reopens the local video');

  expect(errors).toEqual([]);
  console.log(`PASS: HECTOR desktop smoke (${process.platform}).`);
} finally {
  if (app) await app.close();
  await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 });
}
