// Screen/window capture through the real OS capture path (Windows Graphics Capture on Windows).
// macOS needs Screen Recording permission granted interactively first; set HECTOR_CAPTURE_TESTS=1 after granting it.
import { expect, test } from '@playwright/test';
import { colors, expectColors, fullFrame, Hector, near } from './harness';

test('window capture is staged, projected, cropped, kept alive for output, and reports its end', async () => {
  test.skip(process.platform === 'darwin' && !process.env.HECTOR_CAPTURE_TESTS, 'macOS Screen Recording permission must be granted interactively');
  const h = await Hector.launch();
  try {
    // A frameless window whose left half is red and right half blue.
    await h.app.evaluate(async ({ BrowserWindow }) => {
      const w = new BrowserWindow({ width: 480, height: 270, x: 60, y: 60, frame: false, title: 'HECTOR capture fixture', backgroundColor: '#000000' });
      await w.loadURL('data:text/html,' + encodeURIComponent('<title>HECTOR capture fixture</title><body style="margin:0;display:flex;height:100vh"><div style="flex:1;background:#f00"></div><div style="flex:1;background:#00f"></div></body>'));
    });
    const page = h.studio;
    await page.getByRole('button', { name: 'Media', exact: true }).click();
    await page.getByRole('button', { name: 'Add Screen / window capture' }).click();
    const picker = page.getByRole('dialog', { name: 'Capture a screen or window' });
    await picker.getByRole('button', { name: 'Windows', exact: true }).click();
    await expect(picker.getByRole('button', { name: 'Capture HECTOR capture fixture' })).toBeVisible();
    // HECTOR's own studio and output windows are never offered.
    await expect(picker.getByRole('button', { name: /Capture HECTOR (Studio|Output)/ })).toHaveCount(0);
    await picker.getByRole('button', { name: 'Capture HECTOR capture fixture' }).click();
    await expect(picker).toBeHidden();
    const capture = (await h.draft()).sources.find(s => s.kind === 'capture')!;
    expect(capture.name).toBe('HECTOR capture fixture');
    await h.updateSurface({ sourceId: capture.id, corners: fullFrame });

    // Preview & Apply: the studio previews the capture; output starts it only after Apply.
    const output = await h.openOutput();
    await expect.poll(async () => (await h.media(h.studio, capture.id))?.live ?? null).toBe(true);
    expect(await h.media(output, capture.id)).toBeUndefined();
    await h.ok({ type: 'apply' });
    await expect.poll(async () => (await h.media(output, capture.id))?.readyState ?? 0).toBeGreaterThan(1);
    await expect.poll(async () => near((await h.pixels(output, [[0.25, 0.5]]))[0], colors.red, 60)).toBe(true);
    expectColors(await h.pixels(output, [[0.25, 0.5], [0.75, 0.5]]), [colors.red, colors.blue], 60);

    // Crop applies to captures like any source.
    await h.updateSurface({ crop: [0.5, 0, 0, 0] }); await h.ok({ type: 'apply' });
    await expect.poll(async () => near((await h.pixels(output, [[0.25, 0.5]]))[0], colors.blue, 60)).toBe(true);

    // Removing the capture from the draft must not stop the capture the output is projecting.
    const live = (await h.media(output, capture.id))!;
    await h.ok({ type: 'command', command: { type: 'source.remove', id: capture.id } });
    await output.waitForTimeout(600);
    expect(await h.media(output, capture.id)).toMatchObject({ generation: live.generation, live: true, error: '' });
    expect((await h.snapshot()).captures[capture.captureId!]).toBeTruthy();
    await h.ok({ type: 'discard' });

    // Closing the captured window ends the capture: output goes black there and the studio is told.
    await h.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() === 'HECTOR capture fixture')!.close());
    await expect(page.getByRole('status')).toContainText('Capture ended', { timeout: 20000 });
    expectColors(await h.pixels(output, [[0.25, 0.5]]), [colors.black], 10);

    // Reconnect to a screen through the same picker; it is staged until Apply.
    await page.getByRole('button', { name: 'Change capture source' }).click();
    const reconnect = page.getByRole('dialog', { name: 'Reconnect capture' });
    await reconnect.locator('button.capture-choice').first().click();
    await expect(reconnect).toBeHidden();
    const reconnected = (await h.draft()).sources.find(s => s.id === capture.id)!;
    expect(reconnected.captureId).not.toBe(capture.captureId);
    await h.ok({ type: 'apply' });
    await expect.poll(async () => (await h.media(output, capture.id))?.live ?? null).toBe(true);
    await expect(page.getByRole('status')).toHaveCount(0, { timeout: 20000 });
    h.expectNoErrors();
  } finally { await h.close(); }
});
