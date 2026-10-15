import test from 'node:test';
import assert from 'node:assert/strict';
import { cssMatrix, FULL_QUAD, HEIGHT, WIDTH, homography, project, isValidQuad, constrainBounds, translateQuad, type Quad } from '../src/shared/geometry.ts';

const trapezoid: Quad = [{ x: .25, y: .18 }, { x: .8, y: .25 }, { x: .92, y: .88 }, { x: .07, y: .75 }];
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test('whole-projection movement translates corners and interior pixels without resizing or distorting', () => {
  const before = JSON.stringify(trapezoid), moved = translateQuad(trapezoid, {x:.03,y:-.04});
  for (const uv of [...FULL_QUAD, {x:.3,y:.7}, {x:.5,y:.5}]) {
    const a=project(homography(trapezoid),uv), b=project(homography(moved),uv);
    close(b.x-a.x,.03); close(b.y-a.y,-.04);
  }
  assert.equal(JSON.stringify(trapezoid),before); assert.ok(isValidQuad(moved));
});
test('moving beyond any output edge stops the whole shape instead of clamping corners separately', () => {
  for (const delta of [{x:5,y:5},{x:-5,y:-5},{x:5,y:-5},{x:-5,y:5}]) {
    const moved=translateQuad(trapezoid,delta), dx=moved[0].x-trapezoid[0].x,dy=moved[0].y-trapezoid[0].y;
    moved.forEach((p,i)=>{close(p.x-trapezoid[i].x,dx);close(p.y-trapezoid[i].y,dy)});
    assert.ok(isValidQuad(moved));
    close(delta.x>0?Math.max(...moved.map(p=>p.x)):Math.min(...moved.map(p=>p.x)),delta.x>0?1:0);
    close(delta.y>0?Math.max(...moved.map(p=>p.y)):Math.min(...moved.map(p=>p.y)),delta.y>0?1:0);
  }
  assert.deepEqual(translateQuad(FULL_QUAD,{x:1,y:-1}),FULL_QUAD);
  assert.throws(()=>translateQuad(trapezoid,{x:NaN,y:0}));
});

test('perspective mapping puts every source corner on its destination', () => {
  const h = homography(trapezoid);
  FULL_QUAD.forEach((p, i) => { const result = project(h, p); close(result.x, trapezoid[i].x); close(result.y, trapezoid[i].y); });
});
test('center maps to the intersection of target diagonals, not the average of corners', () => {
  const q: Quad = [{ x: .25, y: .1 }, { x: .75, y: .1 }, { x: .95, y: .9 }, { x: .05, y: .9 }];
  const center = project(homography(q), { x: .5, y: .5 });
  close(center.x, .5); close(center.y, .1 + .8 * .5 / 1.4);
});
test('CSS pixel matrix agrees with normalized homography for corners and internal points', () => {
  const h = homography(trapezoid);
  const matrix = cssMatrix(trapezoid).slice('matrix3d('.length, -1).split(',').map(Number);
  for (const p of [...FULL_QUAD, { x: .5, y: .5 }, { x: .3, y: .8 }]) {
    const x = p.x * WIDTH, y = p.y * HEIGHT, z = matrix[3] * x + matrix[7] * y + matrix[15];
    const expected = project(h, p);
    close((matrix[0] * x + matrix[4] * y + matrix[12]) / z, expected.x * WIDTH);
    close((matrix[1] * x + matrix[5] * y + matrix[13]) / z, expected.y * HEIGHT);
  }
});
test('rejects crossed, collapsed, concave, reversed, and nonfinite quads', () => {
  for (const q of [
    [FULL_QUAD[0], FULL_QUAD[2], FULL_QUAD[1], FULL_QUAD[3]],
    FULL_QUAD.map(() => ({ x: .5, y: .5 })),
    [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: .1, y: .1 }, { x: 0, y: 1 }],
    [...FULL_QUAD].reverse(),
    [{ x: NaN, y: 0 }, ...FULL_QUAD.slice(1)],
  ]) assert.equal(isValidQuad(q), false);
});
test('widget bounds stay inside the surface at minimum and maximum sizes', () => {
  assert.deepEqual(constrainBounds({ x: -.5, y: .95, w: .5, h: .5 }), { x: 0, y: .5, w: .5, h: .5 });
  const edge = constrainBounds({ x: 1, y: 1, w: 2, h: 0 });
  close(edge.x, 0); close(edge.y, .82); close(edge.w, 1); close(edge.h, .18);
  assert.throws(() => constrainBounds({ x: NaN, y: 0, w: .5, h: .5 }));
});
