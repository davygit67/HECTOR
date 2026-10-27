import { expect, test } from '@playwright/test';
import { copyFile, mkdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { colors, expectColors, fullFrame, Hector, type Point } from './harness';
import { fixtures } from './fixtures';

const quadrantPoints: Point[] = [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]];
const quadrantColors = [colors.red, colors.green, colors.blue, colors.white];

test('local video: frames, pause/seek, blackout, speed and volume', async () => {
  const h = await Hector.launch();
  try {
    const [video] = await h.importFiles([fixtures.clip]);
    await h.updateSurface({ sourceId: video.id, corners: fullFrame });
    await h.ok({ type: 'transport', playing: true, position: 0 });
    await h.ok({ type: 'apply' });
    const output = await h.openOutput();
    await expect.poll(async () => (await h.media(output, video.id))?.currentTime ?? 0).toBeGreaterThan(1);
    const generation = (await h.media(output, video.id))!.generation;
    // Projected pixels follow decoded frames (the fixture's hue changes every frame).
    const a = await h.pixels(output, [[0.1, 0.1]]); await output.waitForTimeout(800); const b = await h.pixels(output, [[0.1, 0.1]]);
    expect(a).not.toEqual(b);

    // Pause and seek are immediate operational controls.
    await h.ok({ type: 'transport', playing: false, position: 2 });
    await expect.poll(async () => (await h.media(output, video.id))!.paused).toBe(true);
    await expect.poll(async () => (await h.media(output, video.id))!.currentTime).toBeCloseTo(2, 1);
    const held = await h.pixels(output, [[0.1, 0.1]]); await output.waitForTimeout(500);
    expect(await h.pixels(output, [[0.1, 0.1]])).toEqual(held);
    await h.ok({ type: 'transport', playing: true });
    await expect.poll(async () => (await h.media(output, video.id))!.paused).toBe(false);

    // Blackout is immediate; the media clock keeps running underneath.
    await h.studio.getByRole('button', { name: 'Blackout', exact: true }).click();
    await expect.poll(async () => (await h.snapshot(output)).output.blackout).toBe(true);
    expectColors(await h.pixels(output, [[0.5, 0.5], [0.1, 0.9]]), [colors.black, colors.black], 6);
    const dark = (await h.media(output, video.id))!.currentTime!; await output.waitForTimeout(600);
    expect((await h.media(output, video.id))!.currentTime!).toBeGreaterThan(dark);
    await h.studio.getByRole('button', { name: 'Restore output', exact: true }).click();
    await expect.poll(async () => (await h.snapshot(output)).output.blackout).toBe(false);

    // Speed and volume are staged source settings.
    await h.putSource(video.id, { speed: 2, volume: 0.6 });
    await output.waitForTimeout(300);
    expect(await h.media(output, video.id)).toMatchObject({ playbackRate: 1, muted: true });
    await h.ok({ type: 'apply' });
    await expect.poll(async () => (await h.media(output, video.id))!.playbackRate).toBe(2);
    expect(await h.media(output, video.id)).toMatchObject({ muted: false, volume: 0.6, generation });
    expect(await h.media(h.studio, video.id)).toMatchObject({ muted: true });
    const t0 = (await h.media(output, video.id))!.currentTime!, wall = Date.now();
    await output.waitForTimeout(1500);
    const t1 = (await h.media(output, video.id))!.currentTime!, rate = (t1 - t0 + (t1 < t0 ? 10 : 0)) / ((Date.now() - wall) / 1000);
    expect(rate).toBeGreaterThan(1.6); expect(rate).toBeLessThan(2.4);
    h.expectNoErrors();
  } finally { await h.close(); }
});

test('loop on wraps, loop off ends, re-enabling loop restarts', async () => {
  const h = await Hector.launch();
  try {
    const [clip] = await h.importFiles([fixtures.shortClip]);
    await h.updateSurface({ sourceId: clip.id, corners: fullFrame });
    await h.ok({ type: 'transport', playing: true, position: 0 });
    await h.ok({ type: 'apply' });
    const output = await h.openOutput();
    await expect.poll(async () => (await h.media(output, clip.id))?.duration ?? 0).toBeCloseTo(3, 1);
    // With loop on, time wraps past the 3 s end without ending.
    let previous = 0, wrapped = false;
    for (let i = 0; i < 40 && !wrapped; i++) {
      const probe = (await h.media(output, clip.id))!; expect(probe.ended).toBe(false);
      if (probe.currentTime! + 0.5 < previous) wrapped = true; previous = probe.currentTime!; await output.waitForTimeout(150);
    }
    expect(wrapped).toBe(true);
    await h.putSource(clip.id, { loop: false });
    await h.ok({ type: 'apply' });
    await expect.poll(async () => (await h.media(output, clip.id))!.ended, { timeout: 8000 }).toBe(true);
    await h.putSource(clip.id, { loop: true });
    await h.ok({ type: 'apply' });
    await expect.poll(async () => (await h.media(output, clip.id))!.paused).toBe(false);
    const restarted = (await h.media(output, clip.id))!.currentTime!;
    await expect.poll(async () => (await h.media(output, clip.id))!.currentTime).not.toBe(restarted);
    expect((await h.media(output, clip.id))!.ended).toBe(false);
    h.expectNoErrors();
  } finally { await h.close(); }
});

test('image sources render with correct orientation; missing files are reported and relinked', async () => {
  const h = await Hector.launch();
  const media = join(h.profile, 'media'), original = join(media, 'stage.png'), moved = join(media, 'stage-moved.png');
  let restarted: Hector | null = null;
  try {
    await mkdir(media, { recursive: true }); await copyFile(fixtures.quadrants, original);
    const [image] = await h.importFiles([original]);
    await h.updateSurface({ sourceId: image.id, corners: fullFrame });
    await h.ok({ type: 'apply' });
    const output = await h.openOutput();
    await expect.poll(async () => (await h.media(output, image.id))?.width ?? 0).toBe(640);
    expectColors(await h.pixels(output, quadrantPoints), quadrantColors);
    expectColors(await h.pixels(h.studio, quadrantPoints), quadrantColors);
    h.expectNoErrors();
    await h.close({ keepProfile: true });

    await rename(original, moved);
    restarted = await Hector.launch({ profile: h.profile });
    const state = await restarted.snapshot(), source = state.session.applied.sources.find(s => s.id === image.id)!;
    expect(state.assets[source.assetId!].missing).toBe(true);
    const restartedOutput = await restarted.openOutput();
    expectColors(await restarted.pixels(restartedOutput, quadrantPoints), [colors.black, colors.black, colors.black, colors.black], 6);
    await expect(restarted.studio.getByRole('status')).toContainText('Output: Missing file — relink in Media');
    await restarted.studio.getByRole('button', { name: 'Media', exact: true }).click();
    await restarted.stubDialogs({ open: [fixtures.clip] });
    await restarted.studio.getByRole('button', { name: 'Missing · Relink' }).click();
    await expect(restarted.studio.getByRole('alert')).toContainText('Relink requires the same media type.');
    await restarted.studio.getByRole('button', { name: 'Dismiss' }).click();
    await restarted.stubDialogs({ open: [moved] });
    await restarted.studio.getByRole('button', { name: 'Missing · Relink' }).click();
    await expect.poll(async () => (await restarted!.draft()).sources[0].assetId).not.toBe(source.assetId);
    // Preview & Apply: the relink is staged, so output stays black until Apply.
    expectColors(await restarted.pixels(restarted.studio, quadrantPoints), quadrantColors);
    expectColors(await restarted.pixels(restartedOutput, quadrantPoints), [colors.black, colors.black, colors.black, colors.black], 6);
    await restarted.ok({ type: 'apply' });
    await expect.poll(async () => (await restarted!.media(restartedOutput, image.id))?.width ?? 0).toBe(640);
    expectColors(await restarted.pixels(restartedOutput, quadrantPoints), quadrantColors);
    await expect(restarted.studio.getByRole('status')).toHaveCount(0);
    restarted.expectNoErrors();
  } finally {
    await (restarted ?? h).close();
    await rm(h.profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
});
