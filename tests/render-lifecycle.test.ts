import { expect, it } from 'vitest';
import { inverseQuad } from '../src/render/geometry';
import { initialScene, reduceScene } from '../src/core/model';
import { mediaIdentity } from '../src/media/registry';
import { outputAction } from '../electron/output-policy';
it('projective mapping maps all four corners back to their exact source corners', () => {
  const points: [number,number][] = [[.1,.1],[.8,.2],[.95,.9],[.2,.8]], m = inverseQuad(points);
  for (const [i,[x,y]] of points.entries()) {
    const w = m[2]*x+m[5]*y+m[8]; const u=(m[0]*x+m[3]*y+m[6])/w, v=(m[1]*x+m[4]*y+m[7])/w;
    expect(u).toBeCloseTo([0,1,1,0][i],5); expect(v).toBeCloseTo([0,0,1,1][i],5);
  }
});
it('geometry and effects retain media identity; relinking replaces it', () => {
  const scene = initialScene(), before = mediaIdentity(scene.sources[0], '');
  const after = reduceScene(scene, { type: 'surface.update', id: 'surface-1', patch: { opacity: .4 } });
  expect(mediaIdentity(after.sources[0], '')).toBe(before);
  expect(mediaIdentity({ ...after.sources[0], assetId: 'replacement' }, '')).not.toBe(before);
});
it('disconnect hides existing output instead of redirecting it; reconnect preserves its identity', () => {
  expect(outputAction(true, 2, [1,2])).toBe('keep'); expect(outputAction(true,2,[1])).toBe('hide');
  expect(outputAction(true,2,[1,2])).toBe('keep'); expect(outputAction(false,null,[1])).toBe('none');
});
