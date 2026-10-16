import test from 'node:test';
import assert from 'node:assert/strict';
import { initialScene, readScene, reduceScene } from '../src/shared/domain.ts';
import { FULL_QUAD, homography, isValidProjectionQuad, project, type Quad } from '../src/shared/geometry.ts';
import { alignmentCorners, manualAlignment, moveAlignment, moveAlignmentCorner, moveAlignmentCorners, surfaceQuadFromAnchors, videoAlignmentBounds } from '../src/shared/manualAlignment.ts';

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
const equalQuad = (a: Quad, b: Quad) => a.forEach((p, i) => { close(p.x, b[i].x); close(p.y, b[i].y); });
const skew: Quad = [{ x: .17, y: .13 }, { x: .85, y: .2 }, { x: .78, y: .87 }, { x: .11, y: .78 }];
const bounds = { x: .2, y: .2, w: .6, h: .6 };

function videoScene() {
  let scene = reduceScene(initialScene(0), { type: 'manual.target', surfaceId: 'wall' }, 0);
  scene = reduceScene(scene, { type: 'content.create', id: 'video', title: 'Video', surfaceId: 'wall', spec: { kind: 'youtube', config: { videoId: 'M7lc1UVf-VE', startSeconds: 0, backlight: true } } }, 0);
  return reduceScene(scene, { type: 'content.move', id: 'video', bounds: { x: .2, y: .1, w: .6, h: .8 } }, 0);
}

test('video anchors exclude both forms of letterboxing and never include the backlight', () => {
  const tall = videoAlignmentBounds({ x: .2, y: .1, w: .6, h: .8 });
  close(tall.x, .2); close(tall.y, .2); close(tall.w, .6); close(tall.h, .6);
  const wide = videoAlignmentBounds({ x: .1, y: .2, w: .8, h: .3 });
  close(wide.x, .35); close(wide.y, .2); close(wide.w, .3); close(wide.h, .3);
  const scene = videoScene(), before = JSON.stringify(scene), anchor = manualAlignment(scene);
  equalQuad(anchor.corners, alignmentCorners(scene.manualOutput.quad, tall));
  assert.equal(JSON.stringify(scene), before);
  const changed = reduceScene(scene, { type: 'youtube.backlight.configure', id: 'video', settings: { spread: .4, roomFill: 1, intensity: 1.4 } });
  equalQuad(manualAlignment(changed).corners, anchor.corners);
  const disabled = reduceScene(changed, { type: 'youtube.backlight', id: 'video', enabled: false });
  equalQuad(manualAlignment(disabled).corners, anchor.corners);
});

test('anchors preserve the current projection when entering alignment, including small videos', () => {
  for (const rect of [bounds, { x: .8, y: .1, w: 1 / 1920, h: 1 / 1920 }]) {
    const anchors = alignmentCorners(skew, rect);
    equalQuad(surfaceQuadFromAnchors(rect, anchors), skew);
  }
});

test('each corner changes the actual video corner while keeping the other three fixed', () => {
  for (let index = 0; index < 4; index++) {
    const before = alignmentCorners(skew, bounds);
    const target = { x: before[index].x + .02, y: before[index].y - .01 };
    const changed = moveAlignmentCorner(skew, bounds, index, target);
    assert.ok(changed);
    const expected = structuredClone(before); expected[index] = target;
    equalQuad(alignmentCorners(changed, bounds), expected);
  }
});

test('edge and multi-corner drags preserve selected spacing and leave other picture anchors fixed', () => {
  const original = JSON.stringify(skew), before = alignmentCorners(skew, bounds);
  for (const indices of [[0], [0, 1], [1, 2], [2, 3], [3, 0], [0, 2], [1, 3], [0, 1, 2], [0, 1, 2, 3], [0, 0, 1]]) {
    const moved = moveAlignmentCorners(skew, bounds, indices, { x: .02, y: -.015 });
    assert.ok(moved, `selection ${indices}`);
    equalQuad(alignmentCorners(moved, bounds), before.map((p, index) => indices.includes(index) ? { x: p.x + .02, y: p.y - .015 } : p) as Quad);
  }
  assert.equal(JSON.stringify(skew), original);
  equalQuad(moveAlignmentCorners(skew, bounds, [0, 1, 2, 3], { x: .02, y: -.015 })!, moveAlignment(skew, bounds, { x: .02, y: -.015 }));
});

test('selected corners stop together at the output boundary, including cropped video-sized output', () => {
  const rect: Quad = [{ x: .2, y: .2 }, { x: .8, y: .25 }, { x: .8, y: .75 }, { x: .2, y: .8 }];
  const fullBounds = { x: 0, y: 0, w: 1, h: 1 };
  for (const sourceBounds of [fullBounds, bounds]) {
    const quad = surfaceQuadFromAnchors(sourceBounds, rect);
    for (const [indices, delta, expectedShift] of [
      [[0, 1], { x: 0, y: -3 }, { x: 0, y: -.2 }],
      [[1, 2], { x: 3, y: 0 }, { x: .2, y: 0 }],
      [[2, 3], { x: 0, y: 3 }, { x: 0, y: .2 }],
      [[3, 0], { x: -3, y: 0 }, { x: -.2, y: 0 }],
    ] as const) {
      const moved = moveAlignmentCorners(quad, sourceBounds, indices, delta);
      assert.ok(moved);
      equalQuad(alignmentCorners(moved, sourceBounds), rect.map((p, index) => (indices as readonly number[]).includes(index) ? { x: p.x + expectedShift.x, y: p.y + expectedShift.y } : p) as Quad);
    }
  }
});

test('group movement rejects invalid selections, folded anchors and a horizon through the surface', () => {
  for (const indices of [[], [-1, 1], [0, 4], [0, .5], [NaN]]) assert.equal(moveAlignmentCorners(skew, bounds, indices, { x: .01, y: 0 }), null);
  assert.equal(moveAlignmentCorners(skew, bounds, [0, 1], { x: NaN, y: 0 }), null);
  assert.equal(moveAlignmentCorners(skew, bounds, [0, 1], { x: 0, y: Infinity }), null);
  assert.equal(moveAlignmentCorners(skew, bounds, [0, 1], { x: 0, y: 2 }), null);
  // An extreme perspective can keep the video convex while inverting its surrounding light.
  const rect: Quad = [{ x: .2, y: .2 }, { x: .8, y: .2 }, { x: .8, y: .8 }, { x: .2, y: .8 }];
  assert.equal(moveAlignmentCorners(surfaceQuadFromAnchors(bounds, rect), bounds, [0, 2], { x: -.18, y: -.18 }), null);
});

test('dragging the video translates it and its glow rigidly, stopping at video edges instead of glow edges', () => {
  const original = JSON.stringify(skew);
  for (const delta of [{ x: 3, y: 3 }, { x: -3, y: -3 }, { x: .02, y: -.03 }]) {
    const moved = moveAlignment(skew, bounds, delta);
    assert.ok(isValidProjectionQuad(moved));
    const dx = moved[0].x - skew[0].x, dy = moved[0].y - skew[0].y;
    for (const uv of [...FULL_QUAD, { x: .1, y: .1 }, { x: .5, y: .5 }, { x: .9, y: .8 }]) {
      const a = project(homography(skew), uv), b = project(homography(moved), uv);
      close(b.x - a.x, dx); close(b.y - a.y, dy);
    }
    const anchors = alignmentCorners(moved, bounds);
    if (delta.x > 1) { close(Math.max(...anchors.map(p => p.x)), 1); assert.ok(moved.some(p => p.x > 1)); }
    if (delta.x < -1) { close(Math.min(...anchors.map(p => p.x)), 0); assert.ok(moved.some(p => p.x < 0)); }
  }
  assert.equal(JSON.stringify(skew), original);
});

test('video-sized output can fill the projector while the surrounding surface is cropped and persists', () => {
  const scene = videoScene(), anchor = manualAlignment(scene);
  const quad = surfaceQuadFromAnchors(anchor.bounds, FULL_QUAD);
  assert.ok(quad.some(p => p.x < 0 || p.x > 1));
  const changed = reduceScene(scene, { type: 'calibration.set', quad });
  const restored = readScene(JSON.parse(JSON.stringify(changed)));
  equalQuad(manualAlignment(restored).corners, FULL_QUAD);
  assert.deepEqual(restored.contents, scene.contents);
  assert.deepEqual(restored.surfaces, scene.surfaces);
});

test('alignment follows the selected video on the output surface, with a full-surface fallback', () => {
  let scene = videoScene();
  scene = reduceScene(scene, { type: 'content.create', id: 'second', title: 'Second', surfaceId: 'wall', spec: { kind: 'youtube', config: { videoId: 'M7lc1UVf-VE', startSeconds: 0, backlight: false } } });
  assert.equal(manualAlignment(scene).video?.id, 'second');
  scene = reduceScene(scene, { type: 'content.select', id: 'video' });
  assert.equal(manualAlignment(scene).video?.id, 'video');
  scene = reduceScene(scene, { type: 'manual.target', surfaceId: 'tabletop' });
  assert.equal(manualAlignment(scene).video, undefined);
  equalQuad(manualAlignment(scene).corners, scene.manualOutput.quad);
});

test('rejects crossed anchors, nonfinite values, collapsed planes and a horizon through the surrounding surface', () => {
  const corners = alignmentCorners(skew, bounds);
  assert.equal(moveAlignmentCorner(skew, bounds, 0, corners[2]), null);
  assert.equal(moveAlignmentCorner(skew, bounds, 0, { x: NaN, y: .5 }), null);
  assert.equal(isValidProjectionQuad(FULL_QUAD.map(() => ({ x: .5, y: .5 }))), false);
  assert.equal(isValidProjectionQuad([{ x: Infinity, y: 0 }, ...FULL_QUAD.slice(1)]), false);
  const narrowTop: Quad = [{ x: .45, y: .2 }, { x: .55, y: .2 }, { x: .9, y: .8 }, { x: .1, y: .8 }];
  assert.throws(() => surfaceQuadFromAnchors(bounds, narrowTop), /perspective/);
});
