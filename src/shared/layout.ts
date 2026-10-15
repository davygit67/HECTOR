import type { Bounds } from './geometry.js';
import { boundsInDomain, type Surface } from './spatial.js';
export const FULL_BOUNDS: Bounds = { x: 0, y: 0, w: 1, h: 1 };
export function overlaps(a: Bounds, b: Bounds, gap = .015) {
  return a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y;
}
/** Prefer free space for new panels; existing content is never a hard exclusion. */
export function placePanel(surface: Surface, requested: Bounds, occupied: Bounds[], allowShrink = false): Bounds {
  for (const factor of allowShrink ? [1, .85, .7, .55, .45] : [1]) {
    const b = { ...requested, w: Math.max(.28, requested.w * factor), h: Math.max(.24, requested.h * factor) };
    if (!allowShrink) { b.w = requested.w; b.h = requested.h; }
    const valid = (candidate: Bounds) => boundsInDomain(surface, candidate);
    const free = (candidate: Bounds) => valid(candidate) && !occupied.some(other => overlaps(candidate, other));
    if (free(b)) return b;
    let best: Bounds | null = null, distance = Infinity;
    let fallback: Bounds | null = valid(b) ? b : null, fallbackDistance = fallback ? 0 : Infinity;
    for (let y = 0; y <= 40; y++) for (let x = 0; x <= 40; x++) {
      const candidate = { ...b, x: x / 40 * (1 - b.w), y: y / 40 * (1 - b.h) };
      const d = (candidate.x - requested.x) ** 2 + (candidate.y - requested.y) ** 2;
      if (!valid(candidate)) continue;
      if (d < fallbackDistance) { fallback = candidate; fallbackDistance = d; }
      if (d < distance && free(candidate)) { best = candidate; distance = d; }
    }
    if (best) return best;
    if (fallback) return fallback;
  }
  throw new Error('This panel does not fit inside the surface boundary. Reduce its size or turn off the demo cutout. Overlapping other content is allowed.');
}
