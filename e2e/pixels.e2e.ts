// Pixel-level checks of the output compositor using a four-color test image (red, green / blue, white).
import { expect, test } from '@playwright/test';
import { newSurface, type Surface } from '../src/core/model';
import { colors, expectColors, fullFrame, Hector, type Point, type Rgb } from './harness';
import { fixtures } from './fixtures';

const { red, green, blue, white, black, magenta } = colors;
const quadrants: Point[] = [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]];
/** Forward projective map from the unit square to a quad (the inverse of what the shader applies). */
function project(c: Surface['corners'], u: number, v: number): Point {
  const [a, b, d, e] = [c[0], c[1], c[2], c[3]];
  const dx1 = b[0] - d[0], dx2 = e[0] - d[0], dx3 = a[0] - b[0] + d[0] - e[0], dy1 = b[1] - d[1], dy2 = e[1] - d[1], dy3 = a[1] - b[1] + d[1] - e[1];
  const den = dx1 * dy2 - dx2 * dy1, g = (dx3 * dy2 - dx2 * dy3) / den, h = (dx1 * dy3 - dx3 * dy1) / den;
  const w = g * u + h * v + 1;
  return [((b[0] - a[0] + g * b[0]) * u + (e[0] - a[0] + h * e[0]) * v + a[0]) / w, ((b[1] - a[1] + g * b[1]) * u + (e[1] - a[1] + h * e[1]) * v + a[1]) / w];
}

test('warp, crop, mask, effects and layering match expected pixels', async () => {
  const h = await Hector.launch();
  try {
    await h.ok({ type: 'mode', mode: 'live' });
    const [image, solid] = await h.importFiles([fixtures.quadrants, fixtures.magenta]);
    const output = await h.openOutput();
    await h.updateSurface({ sourceId: image.id, corners: fullFrame });
    await expect.poll(async () => (await h.media(output, image.id))?.width ?? 0).toBe(640);
    const check = async (points: Point[], expected: Rgb[], tolerance = 40) => expectColors(await h.pixels(output, points), expected, tolerance);
    await check(quadrants, [red, green, blue, white]);

    // Crop trims the source before warping: [left, top, right, bottom].
    await h.updateSurface({ crop: [0.5, 0, 0, 0] }); await check(quadrants, [green, green, white, white]);
    await h.updateSurface({ crop: [0, 0.5, 0, 0] }); await check(quadrants, [blue, white, blue, white]);
    await h.updateSurface({ crop: [0, 0, 0.5, 0.5] }); await check(quadrants, [red, red, red, red]);
    await h.updateSurface({ crop: [0.25, 0, 0.25, 0] }); await check([[0.45, 0.25], [0.55, 0.25]], [red, green]);
    await h.updateSurface({ crop: [0, 0, 0, 0] });

    // Ellipse mask: inside keeps the image, the corners are black.
    await h.updateSurface({ mask: 'ellipse' });
    await check([[0.25, 0.25], [0.95, 0.4], [0.05, 0.05], [0.97, 0.1]], [red, green, black, black]);
    await h.updateSurface({ mask: 'none' });

    // Warp: an inner quad is surrounded by black, and a perspective quad maps each quadrant to its projected location.
    const inner: Surface['corners'] = [[0.25, 0.25], [0.75, 0.25], [0.75, 0.75], [0.25, 0.75]];
    await h.updateSurface({ corners: inner });
    await check([[0.1, 0.1], [0.35, 0.35], [0.65, 0.35], [0.35, 0.65], [0.65, 0.65], [0.9, 0.9]], [black, red, green, blue, white, black]);
    const perspective: Surface['corners'] = [[0.1, 0.1], [0.9, 0.2], [0.8, 0.9], [0.2, 0.8]];
    await h.updateSurface({ corners: perspective });
    await check([project(perspective, 0.25, 0.25), project(perspective, 0.75, 0.25), project(perspective, 0.25, 0.75), project(perspective, 0.75, 0.75), [0.03, 0.97]],
      [red, green, blue, white, black]);
    await h.updateSurface({ corners: fullFrame });

    // Effects composite over black.
    await h.updateSurface({ opacity: 0.5 }); await check([[0.25, 0.25]], [[128, 0, 0]], 30);
    await h.updateSurface({ opacity: 1, brightness: 0.5 }); await check([[0.25, 0.25], [0.75, 0.75]], [[128, 0, 0], [128, 128, 128]], 30);
    await h.updateSurface({ brightness: 1, saturation: 0 }); await check([[0.25, 0.25]], [[54, 54, 54]], 30);
    await h.updateSurface({ saturation: 1 });

    // Layering: later surfaces draw on top; reordering and visibility change what shows.
    await h.ok({ type: 'command', command: { type: 'surface.add', surface: { ...newSurface('left', 'Left', solid.id), corners: [[0, 0], [0.5, 0], [0.5, 1], [0, 1]] } } });
    await check([[0.25, 0.25], [0.75, 0.25]], [magenta, green]);
    await h.ok({ type: 'command', command: { type: 'surface.move', id: 'left', direction: -1 } });
    await check([[0.25, 0.25]], [red]);
    await h.updateSurface({ visible: false }); await check([[0.25, 0.25], [0.75, 0.25]], [magenta, black]);
    await h.updateSurface({ visible: true });

    // Preview & Apply: the studio preview shows the draft while output keeps the applied scene.
    await h.ok({ type: 'mode', mode: 'preview' });
    await h.updateSurface({ crop: [0.5, 0, 0, 0] });
    await h.ok({ type: 'command', command: { type: 'surface.remove', id: 'left' } });
    await output.waitForTimeout(300);
    expectColors(await h.pixels(h.studio, [[0.25, 0.25]]), [green]);
    await check([[0.25, 0.25]], [red]);
    await h.ok({ type: 'apply' });
    await check([[0.25, 0.25], [0.75, 0.75]], [green, white]);
    h.expectNoErrors();
  } finally { await h.close(); }
});
