import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { cp, copyFile, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { newSurface } from '../src/core/model';
import { colors, expectColors, fullFrame, Hector } from './harness';
import { fixtures } from './fixtures';

test('named setups save the draft and recall according to the editing mode', async () => {
  const h = await Hector.launch();
  try {
    const output = await h.openOutput(), page = h.studio;
    const [video] = await h.importFiles([fixtures.clip]);
    await h.updateSurface({ sourceId: video.id, opacity: 0.5 });
    await page.getByRole('button', { name: 'Setups', exact: true }).click();
    await page.getByLabel('Setup name').fill('bad/name');
    await page.getByRole('button', { name: 'Save named setup' }).click();
    await expect(page.getByRole('alert')).toContainText('Setup names may contain letters, numbers, spaces, underscores and hyphens.');
    await page.getByLabel('Setup name').fill('Stage A');
    await page.getByRole('button', { name: 'Save named setup' }).click();
    await expect(page.getByRole('button', { name: /Stage A/ })).toBeVisible();
    expect((await h.snapshot()).setups).toContain('Stage A');

    // Preview: recall is a staged edit.
    await h.ok({ type: 'discard' });
    expect((await h.draft()).surfaces[0].opacity).toBe(1);
    await page.getByRole('button', { name: /Stage A/ }).click();
    await expect.poll(async () => (await h.draft()).surfaces[0].opacity).toBe(0.5);
    const recalled = await h.draft();
    expect(recalled.sources.find(s => s.id === video.id)!.assetId).not.toBe(video.assetId);
    expect((await h.snapshot(output)).session.applied.surfaces[0].opacity).toBe(1);
    await h.ok({ type: 'apply' });
    await expect.poll(async () => (await h.media(output, video.id))?.readyState ?? 0).toBeGreaterThan(1);

    // Live: recall publishes immediately.
    await h.ok({ type: 'mode', mode: 'live' });
    await h.updateSurface({ opacity: 0.9 });
    await page.getByRole('button', { name: /Stage A/ }).click();
    await expect.poll(async () => (await h.snapshot(output)).session.applied.surfaces[0].opacity).toBe(0.5);
    h.expectNoErrors();
  } finally { await h.close(); }
});

test('portable export copies media, survives a move, and rolls back on failure', async () => {
  const h = await Hector.launch();
  const work = join(h.profile, 'work'), sources = join(work, 'sources'), exported = join(work, 'export'), moved = join(work, 'moved');
  try {
    await mkdir(sources, { recursive: true }); await mkdir(exported, { recursive: true });
    await copyFile(fixtures.quadrants, join(sources, 'wall.png')); await copyFile(fixtures.clip, join(sources, 'loop.webm'));
    const [image, video] = await h.importFiles([join(sources, 'wall.png'), join(sources, 'loop.webm')]);
    await h.updateSurface({ sourceId: image.id, corners: fullFrame });
    await h.ok({ type: 'command', command: { type: 'surface.add', surface: { ...newSurface('video-surface', 'Video', video.id), corners: [[0, 0], [0.3, 0], [0.3, 0.3], [0, 0.3]] } } });

    await h.stubDialogs({ save: join(exported, 'show.hector.json') });
    await h.studio.getByRole('button', { name: 'Export portable' }).click();
    await expect.poll(() => existsSync(join(exported, 'show.hector.json'))).toBe(true);
    expect((await h.snapshot()).session.unapplied).toBe(true); // export neither applies nor saves
    const doc = JSON.parse(await readFile(join(exported, 'show.hector.json'), 'utf8')) as { assets: Record<string, string> };
    const paths = Object.values(doc.assets);
    expect(paths).toHaveLength(2);
    for (const path of paths) { expect(isAbsolute(path)).toBe(false); expect(path).not.toContain('..'); expect(existsSync(join(exported, path))).toBe(true); }

    // Move the package and remove the originals: only the copied media can satisfy the project.
    await mkdir(moved, { recursive: true });
    for (const entry of await readdir(exported)) await cp(join(exported, entry), join(moved, entry), { recursive: true });
    await rm(exported, { recursive: true, force: true }); await rm(sources, { recursive: true, force: true });
    await h.ok({ type: 'discard' });
    await h.stubDialogs({ open: [join(moved, 'show.hector.json')] });
    await h.studio.getByRole('button', { name: 'Open project' }).click();
    await expect.poll(async () => (await h.draft()).surfaces.length).toBe(2);
    const state = await h.snapshot();
    for (const source of state.session.draft.sources.filter(s => s.assetId)) expect(state.assets[source.assetId!].missing).toBe(false);
    await h.ok({ type: 'apply' });
    const output = await h.openOutput();
    await expect.poll(async () => (await h.media(output, video.id))?.currentTime ?? 0).toBeGreaterThan(0.3);
    expectColors(await h.pixels(output, [[0.75, 0.25], [0.75, 0.75]]), [colors.green, colors.white]);

    // A failed export (a source file vanished) leaves nothing behind.
    await rm(moved, { recursive: true, force: true });
    const failed = join(work, 'failed'); await mkdir(failed, { recursive: true });
    await h.stubDialogs({ save: join(failed, 'broken.hector.json') });
    const result = await h.request({ type: 'export' });
    expect(result.ok).toBe(false); expect(result.error).toContain('Portable export failed');
    expect(await readdir(failed)).toEqual([]);
    h.expectNoErrors();
  } finally { await h.close(); }
});

test('save and apply failures keep both the output and the draft', async () => {
  const h = await Hector.launch();
  const current = join(h.profile, 'projects', 'current.json');
  // A directory where the project file should go makes the final rename fail.
  const breakSaving = async () => { await rm(current, { recursive: true, force: true }); await mkdir(current, { recursive: true }); };
  const fixSaving = () => rm(current, { recursive: true, force: true });
  try {
    const output = await h.openOutput(), page = h.studio;
    await breakSaving();
    await h.updateSurface({ opacity: 0.3 });
    await page.getByRole('button', { name: 'Apply & Save', exact: true }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    let state = await h.snapshot(output);
    expect(state.session.applied.surfaces[0].opacity).toBe(1);
    expect(state.session).toMatchObject({ unapplied: true, unsaved: true, mode: 'preview' });
    expect(state.session.draft.surfaces[0].opacity).toBe(0.3);

    // Apply & switch to Live fails the same way: mode, draft and output are unchanged; the dialog stays open.
    await page.getByLabel('Editing mode').selectOption('live');
    const dialog = page.getByRole('dialog', { name: 'Publish pending changes?' });
    await dialog.getByRole('button', { name: 'Apply & switch' }).click();
    await expect(dialog).toBeVisible();
    state = await h.snapshot(output);
    expect(state.session).toMatchObject({ mode: 'preview', unapplied: true });
    expect(state.session.applied.surfaces[0].opacity).toBe(1);
    await dialog.getByRole('button', { name: 'Cancel' }).click();

    await fixSaving();
    await page.getByRole('button', { name: 'Apply & Save', exact: true }).click();
    await expect.poll(async () => (await h.snapshot(output)).session.applied.surfaces[0].opacity).toBe(0.3);
    expect((await h.snapshot()).session).toMatchObject({ unapplied: false, unsaved: false });

    // Live: edits are already on output; a failed Save only leaves them unsaved.
    await h.ok({ type: 'mode', mode: 'live' });
    await breakSaving();
    await h.updateSurface({ opacity: 0.6 });
    expect((await h.snapshot(output)).session.applied.surfaces[0].opacity).toBe(0.6);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    expect((await h.snapshot()).session.unsaved).toBe(true);
    await fixSaving();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(async () => (await h.snapshot()).session.unsaved).toBe(false);
    h.expectNoErrors();
  } finally { await h.close(); }
});
