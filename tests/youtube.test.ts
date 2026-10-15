import test from 'node:test';
import assert from 'node:assert/strict';
import { parseYouTubeInput, youtubeEmbedUrl, youtubePlayerLayout } from '../src/shared/youtube.ts';
import { WIDTH, HEIGHT } from '../src/shared/geometry.ts';
import { initialScene, readScene, reduceScene, type Command } from '../src/shared/domain.ts';
import { CONTENT_REGISTRY, type YouTubeContent } from '../src/shared/content.ts';
import { updateBacklight, readBacklight, clearBacklight } from '../src/backlightField.ts';
import { paintYouTubeBacklight } from '../src/contentPainter.ts';

const id = 'M7lc1UVf-VE'; // Video used in the official YouTube iframe API documentation.
const config = { videoId: id, startSeconds: 90, backlight: true };
function scene() { return reduceScene(initialScene(1000), { type: 'content.create', id: 'video', surfaceId: 'wall', title: 'API example', spec: { kind: 'youtube', config } }, 1000); }
test('YouTube parser accepts known video URLs and normalizes bounded timestamps', () => {
  for (const input of [id, 'youtube.com/watch?v=' + id, 'https://youtu.be/' + id, 'https://m.youtube.com/shorts/' + id, 'https://www.youtube.com/live/' + id, 'https://www.youtube-nocookie.com/embed/' + id]) assert.deepEqual(parseYouTubeInput(input), { videoId: id, startSeconds: 0 });
  for (const input of ['https://youtu.be/' + id + '?t=1m30s', 'https://youtube.com/watch?v=' + id + '&start=90', 'https://youtube.com/watch?v=' + id + '#t=90']) assert.deepEqual(parseYouTubeInput(input), { videoId: id, startSeconds: 90 });
  assert.equal(parseYouTubeInput('https://youtu.be/' + id + '?t=24h').startSeconds, 86400);
});
test('YouTube parser rejects foreign hosts, executable input, ambiguous IDs and bad timestamps', () => {
  for (const input of ['', 'find fish', 'javascript:alert(1)', 'https://youtube.com.evil.test/watch?v=' + id, 'https://youtube.com@evil.test/watch?v=' + id, 'https://user:pass@youtube.com/watch?v=' + id, 'https://youtu.be:8443/' + id, 'https://youtube.com/playlist?list=example', 'https://youtube.com/watch?v=' + id + '&v=' + id, 'https://youtu.be/' + id + '?start=1&start=2', 'https://youtu.be/' + id + '?t=-1', 'https://youtu.be/' + id + '?t=1.5', 'https://youtu.be/' + id + '?t=86401', 'https://youtu.be/' + id + '?t=', 'https://youtu.be/short', 'x'.repeat(2049)]) assert.throws(() => parseYouTubeInput(input), input);
});
test('official embed includes a real local origin and never starts automatically', () => {
  const url = new URL(youtubeEmbedUrl(id, 90, 'http://127.0.0.1:5173'));
  assert.equal(url.origin, 'https://www.youtube.com'); assert.equal(url.pathname, '/embed/' + id);
  assert.equal(url.searchParams.get('origin'), 'http://127.0.0.1:5173'); assert.equal(url.searchParams.get('enablejsapi'), '1'); assert.equal(url.searchParams.get('autoplay'), '0'); assert.equal(url.searchParams.get('mute'), '1'); assert.equal(url.searchParams.get('controls'), '1'); assert.equal(url.searchParams.get('start'), '90');
  for (const origin of ['file://', 'null', 'http://localhost:5173/path']) assert.throws(() => youtubeEmbedUrl(id, 0, origin));
});
test('video sizing is independent of the editor preview and contains a fixed 1080p source without distortion', () => {
  for (const [w, h] of [[1920, 1080], [160, 90], [1, 1], [1, 1080], [1920, 1]]) {
    const layout = youtubePlayerLayout({ x: 0, y: 0, w: w / WIDTH, h: h / HEIGHT });
    assert.ok(layout.width <= w + 1e-9 && layout.height <= h + 1e-9);
    assert.ok(layout.scale > 0 && layout.scale <= 1);
    assert.ok(Math.abs(layout.width / layout.height - 16 / 9) < 1e-9);
    assert.ok(Math.abs(layout.left * 2 + layout.width - w) < 1e-9);
    assert.ok(Math.abs(layout.top * 2 + layout.height - h) < 1e-9);
  }
});
test('small videos keep their source and placement through saving and attachment without shrinking other content limits', () => {
  let s = scene();
  const before = structuredClone(s);
  s = reduceScene(s, { type: 'content.move', id: 'video', bounds: { x: .4, y: .2, w: 160 / WIDTH, h: 90 / HEIGHT } });
  assert.equal(s.contents[0].bounds.w, 160 / WIDTH); assert.equal(s.contents[0].bounds.h, 90 / HEIGHT);
  assert.deepEqual(readScene(s), s); assert.deepEqual(s.contents[0].config, before.contents[0].config);
  s = reduceScene(s, { type: 'content.attach', id: 'video', surfaceId: 'tabletop' });
  assert.equal(s.contents[0].bounds.w, 160 / WIDTH); assert.equal(s.contents[0].bounds.h, 90 / HEIGHT);
  s = reduceScene(s, { type: 'content.move', id: 'video', bounds: { x: .4, y: .2, w: 0, h: 0 } });
  assert.equal(s.contents[0].bounds.w, 1 / WIDTH); assert.equal(s.contents[0].bounds.h, 1 / HEIGHT);
  assert.deepEqual(readScene(s), s); assert.deepEqual(s.surfaces, before.surfaces);
  s = reduceScene(s, { type: 'timer.create', id: 'timer', surfaceId: 'wall', title: 'Timer', durationMs: 1000 });
  s = reduceScene(s, { type: 'timer.move', id: 'timer', bounds: { x: .4, y: .2, w: 1 / WIDTH, h: 1 / HEIGHT } });
  assert.equal(s.timers[0].bounds.w, .18); assert.equal(s.timers[0].bounds.h, .18);
});
test('YouTube backlight is default-on metadata and narrow toggles preserve source, placement, geometry and player URL', () => {
  const entry = CONTENT_REGISTRY.find(e => e.kind === 'youtube')!;
  assert.equal(entry.defaults.backlight, true); assert.deepEqual(entry.output, ['manual']); assert.deepEqual(entry.actions, []);
  let s = scene(); const before = structuredClone(s), origin = 'http://127.0.0.1:5173';
  const url = youtubeEmbedUrl(config.videoId, config.startSeconds, origin);
  for (const enabled of [false, false, true]) {
    s = reduceScene(s, { type: 'youtube.backlight', id: 'video', enabled });
    const video = s.contents[0] as YouTubeContent;
    assert.equal(video.config.backlight, enabled); assert.equal(video.config.videoId, id); assert.equal(video.config.startSeconds, 90);
    assert.equal(youtubeEmbedUrl(video.config.videoId, video.config.startSeconds, origin), url);
    assert.deepEqual(video.state, {}); assert.deepEqual(video.bounds, before.contents[0].bounds); assert.deepEqual(s.surfaces, before.surfaces); assert.equal(s.geometryRevision, before.geometryRevision);
  }
  assert.deepEqual(readScene(s), s);
  assert.equal(before.contents[0].config.backlight, true);
});
test('invalid YouTube configs and unsupported scene playback commands fail atomically', () => {
  const s = scene(), before = JSON.stringify(s);
  for (const patch of [{ videoId: 'broken' }, { startSeconds: .5 }, { startSeconds: -1 }, { startSeconds: 86401 }, { backlight: 'yes' }, { autoplay: true }]) assert.throws(() => reduceScene(s, { type: 'content.update', id: 'video', spec: { kind: 'youtube', config: { ...config, ...patch } } } as Command));
  for (const command of [{ type: 'content.action', id: 'video', action: 'start' }, { type: 'youtube.backlight', id: 'video', enabled: 'yes' }, { type: 'youtube.backlight', id: 'missing', enabled: false }]) assert.throws(() => reduceScene(s, command as Command));
  assert.throws(() => readScene({ ...s, contents: [{ ...s.contents[0], state: { playing: true } }] }));
  assert.equal(JSON.stringify(s), before);
});
test('backlight requires real samples, fades stale input and respects its toggle', () => {
  const calls: string[] = [];
  const ctx = Object.fromEntries(['save', 'restore', 'fillRect'].map(name => [name, () => calls.push(name)])) as unknown as CanvasRenderingContext2D;
  ctx.createRadialGradient = () => ({ addColorStop() {} }) as CanvasGradient;
  const video = scene().contents[0] as YouTubeContent;
  clearBacklight(video.id);
  paintYouTubeBacklight(ctx, video, 768, 432, 1000); assert.deepEqual(calls, []);
  updateBacklight(video.id, { colors: [{ x: .1, y: .5, region: 0, color: [0, 0, 255], weight: 1 }], sampledAt: 1000, costMs: 3, dark: false }, 0);
  assert.equal(readBacklight(video.id, 1000)?.alpha, 1);
  assert.ok(readBacklight(video.id, 1650)!.alpha < 1);
  calls.length = 0; paintYouTubeBacklight(ctx, { ...video, config: { ...video.config, backlight: false } }, 768, 432, 1100); assert.deepEqual(calls, []);
  paintYouTubeBacklight(ctx, video, 768, 432, 2500); assert.deepEqual(calls, []); clearBacklight(video.id);
});
