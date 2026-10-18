import { homography, type Quad, type Point, type Bounds } from './geometry.js';
/** Reverse the actual projection transform before mapping to an asset's 0..1 coordinates. */
export function programPoint(quad: Quad, point: Point, bounds: Bounds): Point | null {
  const h = homography(quad), a = h[0] - point.x * h[6], b = h[1] - point.x * h[7], c = point.x - h[2];
  const d = h[3] - point.y * h[6], e = h[4] - point.y * h[7], f = point.y - h[5], determinant = a * e - b * d;
  if (Math.abs(determinant) < 1e-10) return null;
  const x = ((c * e - b * f) / determinant - bounds.x) / bounds.w, y = ((a * f - c * d) / determinant - bounds.y) / bounds.h;
  return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
}
