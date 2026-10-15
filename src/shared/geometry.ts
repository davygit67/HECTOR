export interface Point { x: number; y: number }
/** Clockwise: top left, top right, bottom right, bottom left. Output-relative coordinates; a cropped plane may extend beyond 0–1. */
export type Quad = [Point, Point, Point, Point];
export interface Bounds { x: number; y: number; w: number; h: number }
export const WIDTH = 1920;
export const HEIGHT = 1080;
export const DEFAULT_QUAD: Quad = [{ x: .12, y: .15 }, { x: .88, y: .15 }, { x: .88, y: .85 }, { x: .12, y: .85 }];
export const FULL_QUAD: Quad = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Translate as one rigid shape, stopping at the output edge without squeezing corners. */
export function translateQuad(quad: Quad, delta: Point): Quad {
  if (!isValidQuad(quad) || !Number.isFinite(delta.x) || !Number.isFinite(delta.y)) throw new Error('Invalid projection movement.');
  const dx = clamp(delta.x, -Math.min(...quad.map(p => p.x)), 1 - Math.max(...quad.map(p => p.x)));
  const dy = clamp(delta.y, -Math.min(...quad.map(p => p.y)), 1 - Math.max(...quad.map(p => p.y)));
  return quad.map(p => ({ x: clamp(p.x + dx, 0, 1), y: clamp(p.y + dy, 0, 1) })) as Quad;
}

export function isValidQuad(value: unknown): value is Quad {
  if (!Array.isArray(value) || value.length !== 4) return false;
  if (!value.every(p => p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1)) return false;
  // Keep a convex clockwise polygon, with enough separation to solve the homography reliably.
  for (let i = 0; i < 4; i++) {
    const a = value[i], b = value[(i + 1) % 4], c = value[(i + 2) % 4];
    if ((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) < .002) return false;
    if (Math.hypot(b.x - a.x, b.y - a.y) < .04) return false;
  }
  const area = value.reduce((sum, p, i) => sum + p.x * value[(i + 1) % 4].y - p.y * value[(i + 1) % 4].x, 0) / 2;
  return area >= .02;
}

/** Convex render plane, including off-screen margins. Relative tolerance also permits small video anchors. */
export function isValidProjectionQuad(value: unknown): value is Quad {
  if (!Array.isArray(value) || value.length !== 4 || !value.every(p => p && Number.isFinite(p.x) && Number.isFinite(p.y) && Math.abs(p.x) <= 10000 && Math.abs(p.y) <= 10000)) return false;
  const span = Math.max(Math.max(...value.map(p => p.x)) - Math.min(...value.map(p => p.x)), Math.max(...value.map(p => p.y)) - Math.min(...value.map(p => p.y)));
  if (span < 1e-8) return false;
  return value.every((a, i) => {
    const b = value[(i + 1) % 4], c = value[(i + 2) % 4];
    return (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) > span * span * 1e-10;
  });
}

/** Solve a full projective transform, not an affine approximation. */
export function homography(quad: Quad): number[] {
  if (!isValidProjectionQuad(quad)) throw new Error('Corners must form a convex, non-collapsed surface.');
  const rows: number[][] = [];
  FULL_QUAD.forEach((p, i) => {
    const { x: u, y: v } = quad[i];
    rows.push([p.x, p.y, 1, 0, 0, 0, -u * p.x, -u * p.y, u]);
    rows.push([0, 0, 0, p.x, p.y, 1, -v * p.x, -v * p.y, v]);
  });
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let r = col + 1; r < 8; r++) if (Math.abs(rows[r][col]) > Math.abs(rows[pivot][col])) pivot = r;
    [rows[col], rows[pivot]] = [rows[pivot], rows[col]];
    const divisor = rows[col][col];
    if (Math.abs(divisor) < 1e-10) throw new Error('Surface is too narrow to calibrate.');
    rows[col] = rows[col].map(v => v / divisor);
    for (let r = 0; r < 8; r++) {
      if (r === col) continue;
      const multiplier = rows[r][col];
      rows[r] = rows[r].map((v, j) => v - multiplier * rows[col][j]);
    }
  }
  return [...rows.map(row => row[8]), 1];
}

export function project(h: number[], p: Point): Point {
  const z = h[6] * p.x + h[7] * p.y + h[8];
  return { x: (h[0] * p.x + h[1] * p.y + h[2]) / z, y: (h[3] * p.x + h[4] * p.y + h[5]) / z };
}

/** Convert normalized H into CSS's column-major, pixel-coordinate matrix. */
export function cssMatrix(quad: Quad): string {
  const h = homography(quad);
  return `matrix3d(${[
    h[0], h[3] * HEIGHT / WIDTH, 0, h[6] / WIDTH,
    h[1] * WIDTH / HEIGHT, h[4], 0, h[7] / HEIGHT,
    0, 0, 1, 0, h[2] * WIDTH, h[5] * HEIGHT, 0, 1,
  ].join(',')})`;
}

export function constrainBounds(b: Bounds, minimum = { w: .18, h: .18 }): Bounds {
  if (![b.x, b.y, b.w, b.h].every(Number.isFinite)) throw new Error('Position and size must be finite numbers.');
  const w = clamp(b.w, minimum.w, 1), h = clamp(b.h, minimum.h, 1);
  return { x: clamp(b.x, 0, 1 - w), y: clamp(b.y, 0, 1 - h), w, h };
}
