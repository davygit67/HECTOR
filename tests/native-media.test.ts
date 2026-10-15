import test from 'node:test';
import assert from 'node:assert/strict';
import { validateMediaCommand, validateMediaInput, videoInputPoint } from '../src/shared/media.ts';

test('native media controls accept explicit actions and bounded seek only', () => {
  for (const action of ['play', 'pause', 'mute', 'unmute', 'retry']) validateMediaCommand({ contentId: 'video', action });
  validateMediaCommand({ contentId: 'video', action: 'seek', seconds: 120 });
  for (const value of [null, {}, { contentId: 'x', action: 'autoplay' }, { contentId: 'x', action: 'play', muted: false }, { contentId: 'x', action: 'seek', seconds: -1 }, { contentId: 'x', action: 'seek', seconds: Infinity }, { contentId: 'x', action: 'seek', seconds: 86401 }, { contentId: 'x', action: 'navigate', url: 'file:///etc/passwd' }]) assert.throws(() => validateMediaCommand(value));
});

test('video input follows the inverse calibrated perspective and is bounded to its source', () => {
  const quad = [{x:100,y:50},{x:500,y:80},{x:450,y:350},{x:150,y:310}] as const;
  const center = videoInputPoint([...quad], {x:300,y:200});
  assert.ok(center && center.x > 800 && center.x < 1150 && center.y > 400 && center.y < 680);
  assert.equal(videoInputPoint([...quad], {x:0,y:0}),null);
  validateMediaInput({contentId:'x',type:'mouseDown',x:100,y:200});
  for (const p of [{x:-1,y:0},{x:1920,y:0},{x:0,y:1080},{x:NaN,y:0},{x:0.1,y:1}]) assert.throws(()=>validateMediaInput({contentId:'x',type:'mouseDown',...p}));
  assert.throws(()=>validateMediaInput({contentId:'x',type:'keyDown',x:0,y:0}));
});
