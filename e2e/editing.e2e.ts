// Real pointer and keyboard input on the mapping canvas.
import { expect, test } from '@playwright/test';
import { surfaceSchema } from '../src/core/model';
import { Hector } from './harness';

test('corner and surface dragging, fine drag, convexity guard, lock, nudge, rotate/scale', async () => {
  const h = await Hector.launch();
  try {
    const output = await h.openOutput();
    const page = h.studio, svg = (await page.locator('svg.handles').boundingBox())!;
    const handleCenter = async (index: number) => { const box = (await page.locator('circle.handle').nth(index).boundingBox())!; return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; };
    const corners = async () => (await h.draft()).surfaces[0].corners;
    const applied = await h.applied();

    // Corner 1 drag: the draft changes once, on release.
    let start = await handleCenter(0);
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    await page.mouse.move(start.x + 60, start.y + 30, { steps: 6 });
    expect((await corners())[0]).toEqual([0.15, 0.15]);
    await page.mouse.up();
    await expect.poll(async () => (await corners())[0][0]).toBeCloseTo(0.15 + 60 / svg.width, 2);
    expect((await corners())[0][1]).toBeCloseTo(0.15 + 30 / svg.height, 2);
    expect((await corners())[2]).toEqual([0.85, 0.85]);
    expect((await h.snapshot(output)).session.applied.surfaces[0].corners[0][0]).toBeCloseTo(0.15 + 60 / svg.width, 2);

    // Surface drag moves every corner by the same amount.
    const before = await corners();
    await page.mouse.move(svg.x + svg.width * 0.5, svg.y + svg.height * 0.5); await page.mouse.down();
    await page.mouse.move(svg.x + svg.width * 0.5 + 40, svg.y + svg.height * 0.5 + 20, { steps: 5 }); await page.mouse.up();
    await expect.poll(async () => (await corners())[1][0]).toBeCloseTo(before[1][0] + 40 / svg.width, 2);
    (await corners()).forEach((c, i) => { expect(c[0]).toBeCloseTo(before[i][0] + 40 / svg.width, 2); expect(c[1]).toBeCloseTo(before[i][1] + 20 / svg.height, 2); });

    // Alt-drag moves at one tenth of the pointer distance.
    const fine = await corners(); start = await handleCenter(2);
    await page.keyboard.down('Alt'); await page.mouse.move(start.x, start.y); await page.mouse.down();
    await page.mouse.move(start.x + 100, start.y, { steps: 5 }); await page.mouse.up(); await page.keyboard.up('Alt');
    await expect.poll(async () => (await corners())[2][0]).toBeCloseTo(fine[2][0] + 10 / svg.width, 2);

    // Dragging corner 1 past corner 2 would fold the quad; the last convex position is kept.
    start = await handleCenter(0);
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    await page.mouse.move(svg.x + svg.width * 0.98, start.y, { steps: 12 }); await page.mouse.up();
    await page.waitForTimeout(300);
    const folded = await corners();
    expect(surfaceSchema.safeParse({ ...(await h.draft()).surfaces[0], corners: folded }).success).toBe(true);
    expect(folded[0][0]).toBeLessThan(folded[1][0]);

    // Keyboard nudge on the selected corner: 1 px, Shift for 10 px (output pixels of a 1920×1080 scene).
    start = await handleCenter(1); await page.mouse.click(start.x, start.y);
    const nudge = (await corners())[1];
    // Rapid presses (like a held key) must all count.
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowDown');
    await expect.poll(async () => (await corners())[1][0]).toBeCloseTo(nudge[0] + 3 / 1920, 5);
    expect((await corners())[1][1]).toBeCloseTo(nudge[1] + 10 / 1080, 5);

    // Rotate/scale buttons keep the centroid.
    const centroid = (c: [number, number][]) => [c.reduce((a, p) => a + p[0], 0) / 4, c.reduce((a, p) => a + p[1], 0) / 4];
    const pre = await corners();
    await page.getByRole('button', { name: '+5%' }).click();
    await expect.poll(async () => (await corners())[0][0]).not.toBe(pre[0][0]);
    const scaled = await corners();
    expect(centroid(scaled)[0]).toBeCloseTo(centroid(pre)[0], 5); expect(centroid(scaled)[1]).toBeCloseTo(centroid(pre)[1], 5);
    expect(scaled[1][0] - scaled[0][0]).toBeCloseTo((pre[1][0] - pre[0][0]) * 1.05, 5);
    await page.getByRole('button', { name: 'Rotate 15° clockwise', exact: true }).click();
    await expect.poll(async () => (await corners())[0][0]).not.toBe(scaled[0][0]);
    expect(centroid(await corners())[0]).toBeCloseTo(centroid(scaled)[0], 5);

    // Locked surfaces cannot be dragged or nudged.
    await page.getByRole('button', { name: 'Lock Wall 01' }).click();
    await expect.poll(async () => (await h.draft()).surfaces[0].locked).toBe(true);
    const locked = await corners(); start = await handleCenter(0);
    await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(start.x + 50, start.y + 50, { steps: 4 }); await page.mouse.up();
    await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(300);
    expect(await corners()).toEqual(locked);
    expect((await h.snapshot(output)).session.applied.surfaces[0].locked).toBe(true);
    h.expectNoErrors();
  } finally { await h.close(); }
});

test('undo and redo through buttons and shortcuts follow the editing mode', async () => {
  const h = await Hector.launch();
  try {
    const output = await h.openOutput(), page = h.studio, opacity = async () => (await h.draft()).surfaces[0].opacity;
    for (const value of [0.8, 0.6, 0.4]) await h.updateSurface({ opacity: value });
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect.poll(opacity).toBe(0.6);
    // Focus now sits on the Undo button; shortcuts must still work.
    await page.keyboard.press('Control+z'); await expect.poll(opacity).toBe(0.8);
    await page.keyboard.press('Control+Shift+z'); await expect.poll(opacity).toBe(0.6);
    await page.getByRole('button', { name: 'Redo', exact: true }).click(); await expect.poll(opacity).toBe(0.4);
    await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeDisabled();
    expect((await h.snapshot(output)).session.applied.surfaces[0].opacity).toBe(0.4);
    // A text field keeps its own undo: Ctrl+Z inside it does not touch the scene.
    await page.getByLabel('Project name').focus(); await page.keyboard.press('Control+z');
    await page.waitForTimeout(200); expect(await opacity()).toBe(0.4);

    await h.updateSurface({ opacity: 0.2 });
    expect((await h.snapshot(output)).session.applied.surfaces[0].opacity).toBe(0.2);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect.poll(async () => (await h.snapshot(output)).session.applied.surfaces[0].opacity).toBe(0.4);
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(async () => (await h.snapshot(output)).session.applied.surfaces[0].opacity).toBe(0.2);
    h.expectNoErrors();
  } finally { await h.close(); }
});
