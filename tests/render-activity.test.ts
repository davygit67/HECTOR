import test from 'node:test';
import assert from 'node:assert/strict';
import { initialScene, reduceScene } from '../src/shared/domain';
import { surfaceFrameKey } from '../src/shared/renderActivity';
import { updateBacklight, clearBacklight, readBacklight, backlightRevision } from '../src/backlightField';
import type { BacklightSample } from '../src/shared/backlight';

const revisions = (id = '', revision = 0, lightRevision = 0, alpha = 1) => ({ media: (i: string) => i === id ? revision : 0, local: (i: string) => i === id ? revision : 0, light: (i: string) => ({ revision: i === id ? lightRevision : 0, alpha }) });
function videoScene() {
  const scene = reduceScene(initialScene(0), { type: 'effect.set', enabled: false });
  return reduceScene(scene, { type: 'content.create', id: 'video', title: 'Video', surfaceId: 'wall', spec: { kind: 'youtube', config: { videoId: 'M7lc1UVf-VE', startSeconds: 0, backlight: true } } });
}
test('video frames repaint their surface only; background depends on lighting, not video cadence', () => {
  const scene = videoScene(), key = (surface: string, background: boolean, r: ReturnType<typeof revisions>) => surfaceFrameKey(scene, surface, 1000, true, background, r);
  assert.notEqual(key('wall', false, revisions()), key('wall', false, revisions('video', 1)));
  assert.equal(key('tabletop', false, revisions()), key('tabletop', false, revisions('video', 1)));
  assert.equal(key('wall', true, revisions()), key('wall', true, revisions('video', 1)));
  assert.notEqual(key('wall', true, revisions()), key('wall', true, revisions('video', 1, 1)));
  assert.equal(key('tabletop', true, revisions()), key('tabletop', true, revisions('video', 1, 1)));
});
test('room fill invalidates receiving surfaces; fading light is visible without new video frames', () => {
  const scene = videoScene();
  const video = scene.contents[0]; if (video.kind !== 'youtube') throw new Error('fixture');
  video.config.backlightSettings = { ...video.config.backlightSettings, roomFill: 1 } as typeof video.config.backlightSettings;
  const key = (r: ReturnType<typeof revisions>) => surfaceFrameKey(scene, 'tabletop', 1000, false, true, r);
  assert.notEqual(key(revisions()), key(revisions('video', 0, 1)));
  assert.notEqual(key(revisions()), key(revisions('', 0, 0, .5)));
  video.layer = { ...video.layer, visible: false };
  assert.equal(key(revisions()), key(revisions('video', 10, 10)));
});
test('idle, paused and expired timers stop invalidating while running timers still advance', () => {
  let scene = reduceScene(videoScene(), { type: 'timer.create', id: 'timer', title: 'Timer', durationMs: 1000, surfaceId: 'tabletop' }, 0);
  const key = (time: number, background = false) => surfaceFrameKey(scene, 'tabletop', time, true, background, revisions());
  assert.equal(key(0), key(500));
  scene = reduceScene(scene, { type: 'timer.action', id: 'timer', action: 'start' }, 0);
  assert.notEqual(key(0), key(500)); assert.equal(key(0, true), key(500, true));
  assert.equal(key(1000), key(1500));
  scene = reduceScene(scene, { type: 'timer.action', id: 'timer', action: 'pause' }, 100);
  assert.equal(key(100), key(500));
});
test('per-source light revision stays stable for converged colors and never backdates a heartbeat', () => {
  const sample: BacklightSample = { sampledAt: 1000, costMs: 0, dark: false, colors: [{ x: .5, y: 0, region: 0, color: [40, 100, 200], weight: 1 }] };
  updateBacklight('audit-a', sample); const before = backlightRevision('audit-a');
  updateBacklight('audit-a', { ...sample, sampledAt: 1100 });
  assert.equal(backlightRevision('audit-a'), before);
  updateBacklight('audit-b', sample); assert.equal(backlightRevision('audit-a'), before);
  updateBacklight('audit-a', { ...sample, sampledAt: 500 });
  assert.equal(readBacklight('audit-a', 1400)?.alpha, 1);
  clearBacklight('audit-a'); clearBacklight('audit-b'); assert.equal(backlightRevision('audit-a'), 0);
});
