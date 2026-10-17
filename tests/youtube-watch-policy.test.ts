import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedWatchNavigation, readPlayerRegion, watchVideoId, youtubeWatchUrl } from '../electron/youtube-watch-policy';
import { validateMediaCommand } from '../src/shared/media';

test('ordinary YouTube source uses a canonical watch URL, never an embed URL', () => {
  assert.equal(youtubeWatchUrl('M7lc1UVf-VE', 12.9), 'https://www.youtube.com/watch?v=M7lc1UVf-VE&t=12s');
  assert.throws(() => youtubeWatchUrl('https://example.com', 0));
});
test('watch navigation only permits exact HTTPS YouTube and account/consent hosts', () => {
  for (const url of ['https://www.youtube.com/watch?v=M7lc1UVf-VE', 'https://accounts.google.com/signin', 'https://consent.youtube.com/m']) assert.equal(allowedWatchNavigation(url), true);
  for (const url of ['http://www.youtube.com', 'https://youtube.com.example.com', 'https://www.youtube.com@evil.test', 'https://www.youtube.com:8000', 'file:///tmp/x', 'javascript:alert(1)', 'https://example.com', 'https://user@youtube.com']) assert.equal(allowedWatchNavigation(url), false);
});
test('capture requires a complete, bounded player rectangle and never accepts arbitrary page regions', () => {
  const r = { x: 16, y: 68, width: 1344, height: 756, viewportWidth: 1920, viewportHeight: 1080 };
  assert.deepEqual(readPlayerRegion(r), r);
  for (const invalid of [null, {}, { ...r, x: -1 }, { ...r, y: .5 }, { ...r, width: 9000 }, { ...r, height: Infinity }, { ...r, x: 1000 }, { ...r, height: 0 }]) assert.equal(readPlayerRegion(invalid), undefined);
});
test('opening the source is a narrow player command, with no URL or arbitrary script payload', () => {
  for (const action of ['open-source', 'close-source']) {
    assert.doesNotThrow(() => validateMediaCommand({ contentId: 'v', action }));
    assert.throws(() => validateMediaCommand({ contentId: 'v', action, url: 'https://example.com' }));
    assert.throws(() => validateMediaCommand({ contentId: 'v', action, script: 'alert(1)' }));
  }
});

test('next playback only recognizes actual YouTube watch pages', () => {
  assert.equal(watchVideoId('https://www.youtube.com/watch?v=M7lc1UVf-VE&list=playlist'), 'M7lc1UVf-VE');
  for (const url of ['https://accounts.google.com/watch?v=M7lc1UVf-VE', 'https://example.com/watch?v=M7lc1UVf-VE', 'https://www.youtube.com/watch?v=no', 'https://www.youtube.com/shorts/M7lc1UVf-VE']) assert.equal(watchVideoId(url), undefined);
});
test('next and ad skipping accept only narrow commands; autoplay requires an explicit boolean', () => {
  for (const action of ['next', 'skip-ad']) {
    assert.doesNotThrow(() => validateMediaCommand({ contentId: 'v', action }));
    assert.throws(() => validateMediaCommand({ contentId: 'v', action, url: 'https://example.com' }));
  }
  for (const enabled of [true, false]) assert.doesNotThrow(() => validateMediaCommand({ contentId: 'v', action: 'autoplay-next', enabled }));
  for (const enabled of [undefined, 1, 'true', null]) assert.throws(() => validateMediaCommand({ contentId: 'v', action: 'autoplay-next', enabled }));
});
