// Window lifecycle and security on the platform running the tests (one display unless more are attached).
import { expect, test } from '@playwright/test';
import { fullFrame, Hector } from './harness';
import { fixtures } from './fixtures';

test('studio and content-only output windows are secure and stable', async () => {
  const h = await Hector.launch();
  try {
    expect(await h.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle())).toBe('HECTOR Studio');
    await expect(h.studio.locator('.brand')).toContainText('HECTOR');
    const output = await h.openOutput(), id = await h.outputWindowId();
    expect(id).not.toBeNull();
    expect(await h.app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id!)!.getTitle(), id)).toBe('HECTOR Output');
    await expect(output.locator('button, input, select, svg')).toHaveCount(0);
    expect(await output.evaluate(() => getComputedStyle(document.querySelector('.output')!).cursor)).toBe('none');
    for (const p of await h.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(w => (w.webContents as unknown as { getLastWebPreferences(): Record<string, unknown> }).getLastWebPreferences()))) {
      expect(p).toMatchObject({ contextIsolation: true, sandbox: true, nodeIntegration: false });
    }
    // Output can read state but never mutate it.
    expect((await h.request({ type: 'blackout', value: true }, output)).ok).toBe(false);
    expect((await h.request({ type: 'command', command: { type: 'scene.rename', name: 'x' } }, output)).ok).toBe(false);
    expect((await h.request({ type: 'capture.sources' }, output)).ok).toBe(false);
    // Output cannot start captures the applied scene does not use.
    expect((await output.evaluate(() => window.hector!.armCapture('not-a-grant'))).ok).toBe(false);
    // Panels, selection and the AI drawer never recreate output.
    for (const name of ['AI assistant', 'Media', 'Setups', 'Layers', 'Crop', 'Effects', 'Transform', 'AI assistant']) await h.studio.getByRole('button', { name, exact: true }).click();
    for (const panel of ['Inspector', 'Inspector', 'Library', 'Library']) await h.studio.getByRole('button', { name: panel, exact: true }).click();
    expect(await h.outputWindowId()).toBe(id);
    h.expectNoErrors();
  } finally { await h.close(); }
});

test('fullscreen survives studio focus; windowed toggle and close/reopen keep the applied scene', async () => {
  const h = await Hector.launch();
  try {
    const [video] = await h.importFiles([fixtures.clip]);
    await h.updateSurface({ sourceId: video.id, corners: fullFrame, opacity: 0.8 });
    await h.ok({ type: 'apply' });
    let output = await h.openOutput();
    const id = await h.outputWindowId(), displayId = (await h.snapshot()).displays[0].id;
    const fullscreen = () => h.app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id!)!.isFullScreen(), id);
    await h.ok({ type: 'output', displayId, fullscreen: true });
    await expect.poll(fullscreen, { timeout: 10000 }).toBe(true);
    await h.app.evaluate(({ BrowserWindow }, id) => BrowserWindow.getAllWindows().find(w => w.id !== id)!.focus(), id);
    await h.studio.getByRole('button', { name: 'Media', exact: true }).click();
    await h.updateSurface({ opacity: 0.7 });
    await h.studio.waitForTimeout(1000);
    expect(await fullscreen()).toBe(true);
    await h.ok({ type: 'output', displayId, fullscreen: false });
    await expect.poll(fullscreen, { timeout: 10000 }).toBe(false);
    expect(await h.outputWindowId()).toBe(id);

    await h.app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id!)!.close(), id);
    await expect.poll(async () => (await h.snapshot()).output.open).toBe(false);
    output = await h.openOutput();
    expect(await h.outputWindowId()).not.toBe(id);
    expect((await h.snapshot(output)).session.applied.surfaces[0].opacity).toBe(0.8);
    await expect.poll(async () => (await h.media(output, video.id))?.currentTime ?? 0).toBeGreaterThan(0.2);
    h.expectNoErrors();
  } finally { await h.close(); }
});

test('restart restores the saved scene and its media', async () => {
  const first = await Hector.launch();
  let second: Hector | null = null;
  try {
    const [video] = await first.importFiles([fixtures.clip]);
    await first.updateSurface({ sourceId: video.id, brightness: 1.2 });
    await first.ok({ type: 'apply' });
    await first.updateSurface({ brightness: 0.4 }); // unsaved draft change is not restored
    await first.close({ keepProfile: true });
    second = await Hector.launch({ profile: first.profile });
    const restored = (await second.snapshot()).session;
    expect(restored.applied.surfaces[0]).toMatchObject({ sourceId: video.id, brightness: 1.2 });
    expect(restored).toMatchObject({ unapplied: false, unsaved: false });
    await expect.poll(async () => (await second!.media(second!.studio, video.id))?.readyState ?? 0).toBeGreaterThan(1);
    second.expectNoErrors();
  } finally {
    await (second ?? first).close();
    const { rm } = await import('node:fs/promises');
    await rm(first.profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
});

test('Live view releases studio playback while output keeps its decoder and transport', async () => {
  const h = await Hector.launch();
  try {
    const [video] = await h.importFiles([fixtures.clip]);
    await h.updateSurface({ sourceId: video.id, corners: fullFrame });
    await h.ok({ type: 'transport', playing: true, position: 0 });
    await h.ok({ type: 'apply' });
    const output = await h.openOutput(), outputId = await h.outputWindowId();
    await expect.poll(async () => (await h.media(output, video.id))?.totalFrames ?? 0).toBeGreaterThan(5);
    const toggle = h.studio.getByRole('button', { name: 'Live view', exact: true });
    const transport = (await h.snapshot()).transport;
    for (let i = 0; i < 2; i++) {
      const before = (await h.media(output, video.id))!;
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-pressed', 'false');
      await expect(h.studio.locator('canvas.projection')).toHaveCount(0);
      expect(await h.studio.evaluate(() => window.hectorProbe === undefined)).toBe(true);
      await expect.poll(async () => { const probe = (await h.media(output, video.id))!; return probe.totalFrames! - probe.droppedFrames!; })
        .toBeGreaterThan(before.totalFrames! - before.droppedFrames!);
      expect((await h.media(output, video.id))!.generation).toBe(before.generation);
      expect((await h.media(output, video.id))!.paused).toBe(false);
      expect(await h.outputWindowId()).toBe(outputId);
      expect((await h.snapshot()).transport).toEqual(transport);
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-pressed', 'true');
      await expect(h.studio.locator('canvas.projection')).toHaveCount(1);
      await expect.poll(async () => (await h.media(h.studio, video.id))?.totalFrames ?? 0).toBeGreaterThan(1);
      expect((await h.media(output, video.id))!.generation).toBe(before.generation);
    }
    h.expectNoErrors();
  } finally { await h.close(); }
});
