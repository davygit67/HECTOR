// Ambient backlight around mapped surfaces, measured from real screenshots of the studio preview and the output.
import { expect, test, type Page } from '@playwright/test';
import { ambientDefaults, type Surface } from '../src/core/model';
import { Hector, type Point, type Rgb } from './harness';
import { fixtures } from './fixtures';

// The quadrant image is red | green over blue | white. The surface covers the middle of the frame, so light just
// outside each edge must come from the nearest part of the picture.
const corners: Surface['corners'] = [[0.3, 0.3], [0.7, 0.3], [0.7, 0.7], [0.3, 0.7]];
const outside: Point[] = [[0.285, 0.38], [0.285, 0.62], [0.715, 0.38], [0.715, 0.62]], far: Point = [0.05, 0.05], inside: Point = [0.4, 0.4];
const lit = { ...ambientDefaults, enabled: true, intensity: 1.6 };
const dominant = (c: Rgb, channel: 0 | 1 | 2) => c[channel] > 60 && c.every((v, i) => i === channel || c[channel] > v + 25);
const dark = (c: Rgb) => c.every(v => v < 12);
const ambient = (h: Hector, page: Page) => page.evaluate(() => window.hectorProbe?.snapshot().ambient ?? []);
async function expectGlow(h: Hector, page: Page) {
  await expect.poll(async () => {
    const [topLeft, bottomLeft, topRight, bottomRight] = await h.pixels(page, outside);
    return dominant(topLeft, 0) && dominant(bottomLeft, 2) && dominant(topRight, 1) && bottomRight.every(v => v > 60) && Math.max(...bottomRight) - Math.min(...bottomRight) < 40;
  }, { timeout: 10_000 }).toBe(true);
  const [wall, picture] = await h.pixels(page, [far, inside]);
  expect(dark(wall), `far wall stays dark: ${wall}`).toBe(true);
  expect(picture[0] > 200 && picture[1] < 40 && picture[2] < 40, `glow never covers the picture: ${picture}`).toBe(true);
}
const expectDark = (h: Hector, page: Page) => expect.poll(async () => (await h.pixels(page, outside)).every(dark), { timeout: 5_000 }).toBe(true);

async function expectGeneratorGlow(h: Hector, page: Page, points: Point[]) {
  let pixels: Rgb[] = [];
  try {
    await expect.poll(async () => {
      pixels = await h.pixels(page, points, true);
      return pixels.some(c => c.some(v => v > 12));
    // Hosted Windows capture can take longer than five seconds even when the returned pixels are lit.
    // Keep polling the real pixels, allowing enough time for capture as well as worker startup.
    }, { timeout: 30_000 }).toBe(true);
  } catch (cause) {
    const probe = await page.evaluate(() => {
      const snapshot = window.hectorProbe?.snapshot();
      return snapshot && { frames: snapshot.frames, ambient: snapshot.ambient };
    });
    throw new Error(`Generator glow missing: ${JSON.stringify({ points, pixels, captureStage: h.pixelCaptureStage, probe, errors: h.errors })}`, { cause });
  }
}

test('ambient backlight lights the wall from the source edges, staged until Apply, independent per window', async () => {
  const h = await Hector.launch();
  try {
    const [image] = await h.importFiles([fixtures.quadrants]);
    await h.updateSurface({ sourceId: image.id, corners });
    await h.ok({ type: 'apply' });
    const output = await h.openOutput();
    await expect.poll(async () => (await h.media(output, image.id))?.width ?? 0).toBe(640);
    await expectDark(h, output);

    // Preview & Apply: the draft glows in the studio while the projector stays unchanged.
    await h.studio.getByRole('button', { name: 'Effects', exact: true }).click();
    // The switch draws over its visually hidden checkbox, so click it the way a user does.
    await h.studio.locator('label.switch', { hasText: 'Ambient backlight' }).click();
    await expect(h.studio.getByRole('checkbox', { name: 'Ambient backlight' })).toBeChecked();
    await expect.poll(async () => (await h.draft()).surfaces[0].ambient?.enabled).toBe(true);
    await h.updateSurface({ ambient: lit });
    await expectGlow(h, h.studio);
    await expectDark(h, output);
    expect((await h.applied()).surfaces[0].ambient).toBeUndefined();
    expect(await ambient(h, output)).toEqual([]);

    await h.ok({ type: 'apply' });
    await expectGlow(h, output);
    const [probe] = await ambient(h, output);
    // Analysis runs in a worker and readback is asynchronous, so neither competes with the render loop.
    expect(probe).toMatchObject({ surfaceId: 'surface-1', dark: false, worker: true, asyncReadback: true });
    expect(probe.samples).toBeGreaterThanOrEqual(3);
    // A still image is analysed until its picture boundary settles, not every frame.
    await h.studio.waitForTimeout(1500);
    expect((await ambient(h, output))[0].samples - probe.samples).toBeLessThan(6);
    expect((await ambient(h, output))[0].alpha, 'a still image keeps its light').toBe(1);

    // Live view off releases the studio's sampling; the projector keeps its own glow.
    const toggle = h.studio.getByRole('button', { name: 'Live view', exact: true });
    await toggle.click(); await expect(h.studio.locator('canvas.projection')).toHaveCount(0);
    await h.studio.waitForTimeout(1500);
    await expectGlow(h, output);
    await toggle.click(); await expect(h.studio.locator('canvas.projection')).toHaveCount(1);
    await expectGlow(h, h.studio);

    // Without frames there is no light: removing the source fades the glow out instead of keeping stale colours.
    await h.ok({ type: 'mode', mode: 'live' });
    await h.updateSurface({ sourceId: null });
    await expectDark(h, output);
    await h.ok({ type: 'undo' });
    await expectGlow(h, output);

    // Undo/redo follow Live Edit.
    await h.updateSurface({ ambient: { ...lit, enabled: false } });
    await expectDark(h, output);
    await h.ok({ type: 'undo' }); await expectGlow(h, output);
    await h.ok({ type: 'redo' }); await expectDark(h, output);
    h.expectNoErrors();
  } finally { await h.close(); }
});

test('ambient settings persist, render on generators and track a moved surface', async () => {
  const h = await Hector.launch();
  try {
    await h.ok({ type: 'mode', mode: 'live' });
    const settings = { ...lit, toneProfile: 'vivid' as const, spread: 0.25, smoothingMs: 120, vibrance: 1.4, opacity: 0.9 };
    await h.updateSurface({ corners, ambient: settings });
    const output = await h.openOutput();
    // The default aurora gradient is a generator: its rendered frames are sampled like any other source.
    await expectGeneratorGlow(h, output, outside);
    await h.ok({ type: 'command', command: { type: 'surface.nudge', id: 'surface-1', corner: -1, dx: 0.1, dy: 0 } });
    await expectGeneratorGlow(h, output, [[0.385, 0.5]]);
    await h.ok({ type: 'save' });
    const profile = h.profile; await h.close({ keepProfile: true });
    const restarted = await Hector.launch({ profile });
    try {
      expect((await restarted.draft()).surfaces[0].ambient).toEqual(settings);
      expect((await restarted.applied()).surfaces[0].ambient).toEqual(settings);
      restarted.expectNoErrors();
    } finally { await restarted.close(); }
  } finally { await h.close(); }
});

