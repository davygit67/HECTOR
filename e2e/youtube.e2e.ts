// YouTube sources: link validation, player isolation, failure reporting and (with network access) real playback that
// reaches mapped surfaces through the official embedded player window.
import { expect, test, type Page } from '@playwright/test';
import { ambientDefaults } from '../src/core/model';
import { playerKey } from '../src/core/youtube';
import { fullFrame, Hector } from './harness';

const online = !!process.env.HECTOR_YOUTUBE_TESTS;
// YouTube's own IFrame API demo video, embeddable by design.
const embeddable = 'M7lc1UVf-VE';
const youtube = async (h: Hector) => (await h.draft()).sources.filter(s => s.kind === 'youtube');
const status = async (h: Hector, videoId: string) => {
  const snapshot = await h.snapshot(), source = snapshot.session.draft.sources.find(s => s.videoId === videoId);
  return source ? snapshot.players[playerKey(source)] : undefined;
};
const playerPage = (h: Hector) => expect.poll(() => h.app.windows().find(w => !w.isClosed() && w.url().startsWith('hector-player://')) ?? null).not.toBeNull()
  .then(() => h.app.windows().find(w => !w.isClosed() && w.url().startsWith('hector-player://'))! as Page);
async function addLink(h: Hector, link: string) {
  await h.studio.getByRole('button', { name: 'Media', exact: true }).click();
  await h.studio.getByLabel('YouTube link').fill(link);
  await h.studio.getByRole('button', { name: 'Add video' }).click();
}

test('YouTube links are validated before anything is loaded, and failures are explained', async () => {
  const h = await Hector.launch();
  try {
    for (const [link, message] of [['https://vimeo.com/76979871', 'Only YouTube video links'], ['https://www.youtube.com/playlist?list=PL0', 'Playlists are not supported'], ['youtube.com/watch?v=short', 'valid YouTube video ID']]) {
      await addLink(h, link);
      await expect(h.studio.locator('#youtube-feedback')).toContainText(message);
      await expect(h.studio.getByLabel('YouTube link')).toHaveAttribute('aria-invalid', 'true');
      // Main validates independently of the studio.
      expect(await h.request({ type: 'youtube.add', link })).toMatchObject({ ok: false, error: expect.stringContaining(message) });
    }
    expect(await youtube(h)).toEqual([]);
    expect(h.app.windows().some(w => w.url().startsWith('hector-player://'))).toBe(false);

    // A real network outage (requests from the player session are cancelled) is reported with a way to recover.
    await h.app.evaluate(({ session }) => session.fromPartition('hector-youtube').webRequest.onBeforeRequest({ urls: ['https://*/*'] }, (_details, callback) => callback({ cancel: true })));
    await addLink(h, `https://youtu.be/${embeddable}?t=30`);
    await expect.poll(async () => (await youtube(h)).map(s => [s.videoId, s.start])).toEqual([[embeddable, 30]]);
    expect((await h.applied()).sources.some(s => s.kind === 'youtube')).toBe(false);
    await expect.poll(async () => (await status(h, embeddable))?.state, { timeout: 30_000 }).toBe('error');
    expect((await status(h, embeddable))?.error).toMatch(/Could not reach YouTube/);
    await expect(h.studio.getByText(/Could not reach YouTube/)).toBeVisible();
    await expect(h.studio.getByRole('button', { name: 'Reload player' })).toBeVisible();

    // The player page is isolated: no HECTOR bridge, no Node, sandboxed, and it cannot navigate away.
    const page = await playerPage(h);
    expect(await page.evaluate(() => ({ hector: typeof (window as { hector?: unknown }).hector, require: typeof (window as { require?: unknown }).require, bridge: Object.keys((window as unknown as { hectorPlayer: object }).hectorPlayer) })))
      .toEqual({ hector: 'undefined', require: 'undefined', bridge: ['report', 'onCommand'] });
    const preferences = await h.app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('hector-player://'))!;
      return (win.webContents as unknown as { getLastWebPreferences(): Record<string, unknown> }).getLastWebPreferences();
    });
    expect(preferences).toMatchObject({ sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true });
    await page.evaluate(() => { location.href = 'https://example.com/'; });
    await page.waitForTimeout(500);
    expect(page.url()).toMatch(/^hector-player:\/\/player\//);
    // Player windows are never offered as capture sources.
    const choices = (await h.request({ type: 'capture.sources' })).choices ?? [];
    expect(choices.some(c => c.name.startsWith('YouTube'))).toBe(false);

    // Removing the draft-only source closes its player.
    await h.ok({ type: 'discard' });
    await expect.poll(() => h.app.windows().filter(w => !w.isClosed() && w.url().startsWith('hector-player://')).length).toBe(0);
    h.expectNoErrors();
  } finally { await h.close(); }
});

test('a YouTube video plays on a mapped surface and in the output through the official player', async () => {
  test.skip(!online, 'Needs network access to YouTube; set HECTOR_YOUTUBE_TESTS=1.');
  const h = await Hector.launch();
  try {
    await addLink(h, `https://www.youtube.com/watch?v=${embeddable}`);
    const [source] = await youtube(h);
    await h.updateSurface({ sourceId: source.id, corners: fullFrame });
    await expect.poll(async () => (await status(h, embeddable))?.state, { timeout: 45_000 }).toBe('playing');
    expect((await status(h, embeddable))?.title).toMatch(/YouTube/);
    // The studio preview mirrors the player window; the output has nothing until Apply.
    await expect.poll(async () => (await h.media(h.studio, source.id))?.width ?? 0, { timeout: 20_000 }).toBeGreaterThan(300);
    await expect.poll(async () => { const p = await h.pixels(h.studio, [[0.3, 0.3], [0.5, 0.5], [0.7, 0.7]]); return p.some(c => c.some(v => v > 40)); }).toBe(true);
    const output = await h.openOutput();
    expect(await h.media(output, source.id)).toBeUndefined();
    await h.ok({ type: 'apply' });
    await expect.poll(async () => (await h.media(output, source.id))?.live, { timeout: 20_000 }).toBe(true);
    await expect.poll(async () => (await h.media(output, source.id))?.totalFrames ?? 0).toBeGreaterThan(10);

    // Ambient light comes from the video's own frames.
    await h.ok({ type: 'mode', mode: 'live' });
    await h.updateSurface({ corners: [[0.3, 0.3], [0.7, 0.3], [0.7, 0.7], [0.3, 0.7]], ambient: { ...ambientDefaults, enabled: true, intensity: 1.6 } });
    await expect.poll(async () => (await output.evaluate(() => window.hectorProbe?.snapshot().ambient[0]?.samples ?? 0)), { timeout: 15_000 }).toBeGreaterThan(5);
    await expect.poll(async () => (await h.pixels(output, [[0.29, 0.5], [0.71, 0.5], [0.5, 0.29], [0.5, 0.71]])).some(c => c.some(v => v > 12)), { timeout: 10_000 }).toBe(true);

    // Live view off leaves the projected video running.
    const before = (await h.media(output, source.id))!;
    await h.studio.getByRole('button', { name: 'Live view', exact: true }).click();
    await expect.poll(async () => (await h.media(output, source.id))!.totalFrames!).toBeGreaterThan(before.totalFrames!);
    expect((await h.media(output, source.id))!.generation).toBe(before.generation);
    await h.studio.getByRole('button', { name: 'Live view', exact: true }).click();

    // The transport drives the official player.
    await h.ok({ type: 'transport', playing: false });
    await expect.poll(async () => (await status(h, embeddable))?.state, { timeout: 15_000 }).toBe('paused');
    await h.ok({ type: 'transport', playing: true, position: 0 });
    await expect.poll(async () => (await status(h, embeddable))?.state, { timeout: 15_000 }).toBe('playing');

    // YouTube's own refusal is passed on, not hidden.
    await addLink(h, 'https://youtu.be/aaaaaaaaaaa');
    await expect.poll(async () => (await status(h, 'aaaaaaaaaaa'))?.state, { timeout: 45_000 }).toBe('error');
    expect((await status(h, 'aaaaaaaaaaa'))?.error).toMatch(/embedding|not found|private|removed/);
  } finally { await h.close(); }
});
