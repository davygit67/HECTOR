// The editing contract: draft edits never reach output before Apply, and Apply never rebuilds unchanged media.
import { expect, test } from '@playwright/test';
import { newSurface, type Command } from '../src/core/model';
import { colors, expectColors, fullFrame, Hector, type Point } from './harness';
import { fixtures } from './fixtures';
import type { MediaProbe } from '../src/core/bridge';

// Playback position wraps at the end of a looping clip. Count displayed frames
// instead; decoder identity is checked separately, and dropped frames do not count.
const displayedFrames = (probe: MediaProbe) => probe.totalFrames! - probe.droppedFrames!;

// Image sample points outside the small video surface in the top-left corner.
const imagePoints: Point[] = [[0.4, 0.4], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]];
const imageColors = [colors.red, colors.green, colors.blue, colors.white];

test('no draft change reaches output before Apply; Apply keeps playback continuous', async () => {
  const h = await Hector.launch();
  try {
    const [image, video] = await h.importFiles([fixtures.quadrants, fixtures.clip]);
    await h.updateSurface({ sourceId: image.id, corners: fullFrame });
    await h.ok({ type: 'command', command: { type: 'surface.add', surface: { ...newSurface('video-surface', 'Video', video.id), corners: [[0.02, 0.02], [0.3, 0.02], [0.3, 0.3], [0.02, 0.3]] } } });
    await h.ok({ type: 'transport', playing: true, position: 0 });
    await h.ok({ type: 'apply' });
    const output = await h.openOutput();
    await expect.poll(async () => (await h.media(output, video.id))?.currentTime ?? 0).toBeGreaterThan(0.5);
    expectColors(await h.pixels(output, imagePoints), imageColors);
    const applied = await h.applied(), generation = (await h.media(output, video.id))!.generation;
    let lastFrames = displayedFrames((await h.media(output, video.id))!);

    const grid = { id: 'grid-source', name: 'Grid', kind: 'grid' as const, color: '#ffffff', loop: true, speed: 1, volume: 0 };
    const edits: [string, Command][] = [
      ['corners', { type: 'surface.update', id: 'surface-1', patch: { corners: [[0.3, 0.3], [0.7, 0.3], [0.7, 0.7], [0.3, 0.7]] } }],
      ['crop', { type: 'surface.update', id: 'surface-1', patch: { crop: [0.5, 0.2, 0, 0] } }],
      ['effects', { type: 'surface.update', id: 'surface-1', patch: { opacity: 0.3, brightness: 0.4, saturation: 0 } }],
      ['mask', { type: 'surface.update', id: 'surface-1', patch: { mask: 'ellipse' } }],
      ['visibility', { type: 'surface.update', id: 'video-surface', patch: { visible: false } }],
      ['new source', { type: 'source.put', source: grid }],
      ['new surface', { type: 'surface.add', surface: { ...newSurface('cover', 'Cover', 'grid-source'), corners: fullFrame } }],
      ['reorder', { type: 'surface.move', id: 'cover', direction: -1 }],
      ['source settings', { type: 'source.put', source: { ...video, speed: 2, loop: false, volume: 0.8 } }],
      ['reassign', { type: 'surface.update', id: 'video-surface', patch: { sourceId: 'grid-source' } }],
      ['remove applied source', { type: 'source.remove', id: video.id }],
      ['rename', { type: 'scene.rename', name: 'Draft only' }]
    ];
    for (const [label, command] of edits) {
      await h.ok({ type: 'command', command });
      await expect.poll(async () => displayedFrames((await h.media(output, video.id))!),
        { message: `${label}: playback advances` }).toBeGreaterThan(lastFrames);
      const state = await h.snapshot(output);
      expect(state.session.applied, `${label}: applied scene`).toEqual(applied);
      expect(state.session.unapplied, label).toBe(true);
      expectColors(await h.pixels(output, imagePoints), imageColors);
      const probe = (await h.media(output, video.id))!;
      expect(probe.generation, `${label}: decoder`).toBe(generation);
      expect(probe.paused, label).toBe(false);
      expect(probe.playbackRate, label).toBe(1);
      expect(probe.muted, label).toBe(true);
      expect(probe.loop, label).toBe(true);
      lastFrames = displayedFrames(probe);
    }
    // Undo/redo in Preview also stay in the draft.
    await h.ok({ type: 'undo' }); await h.ok({ type: 'undo' }); await h.ok({ type: 'redo' });
    expect((await h.snapshot(output)).session.applied).toEqual(applied);

    await h.ok({ type: 'discard' });
    expect(await h.draft()).toEqual(applied);

    // Apply geometry, effects and source settings: output changes, the same decoder keeps playing forward.
    await h.updateSurface({ brightness: 0.5 });
    await h.updateSurface({ corners: [[0.05, 0.05], [0.35, 0.05], [0.35, 0.35], [0.05, 0.35]] }, 'video-surface');
    await h.putSource(video.id, { speed: 2 });
    const beforeApply = (await h.media(output, video.id))!;
    await h.ok({ type: 'apply' });
    await expect.poll(async () => (await h.media(output, video.id))!.playbackRate).toBe(2);
    expectColors(await h.pixels(output, [[0.75, 0.75]]), [[128, 128, 128]], 45);
    const afterApply = (await h.media(output, video.id))!;
    expect(afterApply.generation).toBe(generation);
    await expect.poll(async () => displayedFrames((await h.media(output, video.id))!),
      { message: 'Apply: playback advances' }).toBeGreaterThan(displayedFrames(beforeApply));
    expect((await h.snapshot()).session.unapplied).toBe(false);
    h.expectNoErrors();
  } finally { await h.close(); }
});

test('switching to Live Edit with pending changes requires Apply, Discard or Cancel', async () => {
  const h = await Hector.launch();
  try {
    const output = await h.openOutput();
    const mode = h.studio.getByRole('radiogroup', { name: 'Editing mode' }), dialog = h.studio.getByRole('dialog', { name: 'Publish pending changes?' });
    await h.updateSurface({ opacity: 0.4 });
    await mode.getByRole('radio', { name: 'Live Edit' }).click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    expect((await h.snapshot()).session).toMatchObject({ mode: 'preview', unapplied: true });

    await mode.getByRole('radio', { name: 'Live Edit' }).click();
    await dialog.getByRole('button', { name: 'Discard & switch' }).click();
    await expect.poll(async () => (await h.snapshot()).session.mode).toBe('live');
    expect((await h.draft()).surfaces[0].opacity).toBe(1);

    // Live: edits publish immediately, including undo.
    await h.updateSurface({ opacity: 0.6 });
    expect((await h.snapshot(output)).session.applied.surfaces[0].opacity).toBe(0.6);
    await h.ok({ type: 'undo' });
    expect((await h.snapshot(output)).session.applied.surfaces[0].opacity).toBe(1);

    await mode.getByRole('radio', { name: 'Preview & Apply' }).click();
    await expect.poll(async () => (await h.snapshot()).session.mode).toBe('preview');
    await h.updateSurface({ opacity: 0.7 });
    await mode.getByRole('radio', { name: 'Live Edit' }).click();
    await dialog.getByRole('button', { name: 'Apply & switch' }).click();
    await expect.poll(async () => (await h.snapshot()).session.mode).toBe('live');
    expect((await h.snapshot(output)).session.applied.surfaces[0].opacity).toBe(0.7);
    expect((await h.snapshot()).session.unsaved).toBe(false);
    h.expectNoErrors();
  } finally { await h.close(); }
});
