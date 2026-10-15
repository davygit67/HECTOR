import { analyzeColors } from '../src/shared/backlight';
import { updateBacklight, clearBacklight } from '../src/backlightField';
import { paintYouTubeBacklight } from '../src/contentPainter';
import type { YouTubeContent } from '../src/shared/content';

const canvas = document.querySelector('canvas')!, ctx = canvas.getContext('2d')!;
const video: YouTubeContent = { id: 'visual-check', kind: 'youtube', title: 'Synthetic image', surfaceId: 'tabletop', bounds: { x: .2, y: .2, w: .6, h: .6 }, config: { videoId: 'M7lc1UVf-VE', startSeconds: 0, backlight: true }, state: {} };
const data = new Uint8ClampedArray(96 * 54 * 4);
for (let y = 0; y < 54; y++) for (let x = 0; x < 96; x++) data.set(x < 48 ? [0, 64, 255, 255] : [255, 80, 0, 255], (y * 96 + x) * 4);
const draw = (enabled: boolean) => {
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 768, 432);
  paintYouTubeBacklight(ctx, { ...video, config: { ...video.config, backlight: enabled } }, 768, 432, 1000);
  ctx.fillStyle = '#0040ff'; ctx.fillRect(153.6, 86.4, 230.4, 259.2);
  ctx.fillStyle = '#ff5000'; ctx.fillRect(384, 86.4, 230.4, 259.2);
};
const outside = () => {
  const pixels = ctx.getImageData(0, 0, 768, 432).data;
  const left = [0, 0, 0], right = [0, 0, 0]; let lit = 0;
  for (let y = 0; y < 432; y++) for (let x = 0; x < 768; x++) {
    if (x >= 150 && x <= 618 && y >= 83 && y <= 349) continue;
    const index = (y * 768 + x) * 4, sum = x < 384 ? left : right;
    for (let c = 0; c < 3; c++) sum[c] += pixels[index + c];
    if (Math.max(pixels[index], pixels[index + 1], pixels[index + 2]) > 20) lit++;
  }
  return { left, right, lit };
};
updateBacklight(video.id, { colors: analyzeColors({ width: 96, height: 54, data }), sampledAt: 1000, costMs: 0, dark: false }, 0);
draw(false); const off = outside();
draw(true); const on = outside();
const passed = off.lit === 0 && on.lit > 10000 && on.left[2] > on.left[0] * 5 && on.right[0] > on.right[2] * 5;
document.querySelector('#results')!.textContent = JSON.stringify({ passed, off, on }, null, 2);
clearBacklight(video.id);
