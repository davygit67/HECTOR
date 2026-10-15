import { FULL_PICTURE, type ActivePicture } from './activePicture.js';
import type { Scene } from './domain.js';
import { clamp, FULL_QUAD, homography, isValidProjectionQuad, project, type Bounds, type Point, type Quad } from './geometry.js';
import { youtubePictureBounds } from './youtube.js';
import { mediaBounds } from './mediaContent.js';
import { layerVisible } from './layers.js';

const surfaceBounds: Bounds = { x: 0, y: 0, w: 1, h: 1 };
const boundsCorners = (bounds: Bounds): Quad => FULL_QUAD.map(p => ({ x: bounds.x + p.x * bounds.w, y: bounds.y + p.y * bounds.h })) as Quad;

/** Same actual picture rectangle as the painter. Backlight spread never changes these anchors. */
export function videoAlignmentBounds(bounds: Bounds, picture: ActivePicture = FULL_PICTURE): Bounds {
  return youtubePictureBounds(bounds, picture);
}

export function alignmentCorners(quad: Quad, bounds: Bounds): Quad {
  const h = homography(quad);
  return boundsCorners(bounds).map(p => project(h, p)) as Quad;
}

/** Selecting a video changes only the editing anchors, never the saved projection or content. */
export function manualAlignment(scene: Scene, pictureFor: (id: string) => ActivePicture = () => FULL_PICTURE) {
  const videos = scene.contents.filter(c => (c.kind === 'youtube' || c.kind === 'media') && c.surfaceId === scene.manualOutput.surfaceId && layerVisible(c));
  const video = videos.find(c => c.id === scene.selectedContentId) ?? videos[0];
  const bounds = video ? video.kind === 'media' ? mediaBounds(video.bounds, video.config) : videoAlignmentBounds(video.bounds, pictureFor(video.id)) : surfaceBounds;
  return { video, bounds, corners: alignmentCorners(scene.manualOutput.quad, bounds) };
}

/** Expand the video mapping back to the shared surface so its light follows the identical transform. */
export function surfaceQuadFromAnchors(bounds: Bounds, corners: Quad): Quad {
  if (![bounds.x, bounds.y, bounds.w, bounds.h].every(Number.isFinite) || bounds.w <= 0 || bounds.h <= 0) throw new Error('Invalid alignment bounds.');
  const h = homography(corners);
  const source = FULL_QUAD.map(p => ({ x: (p.x - bounds.x) / bounds.w, y: (p.y - bounds.y) / bounds.h }));
  // Reject a projective horizon crossing the surface, which would flip/invert its surrounding light.
  if (source.some(p => h[6] * p.x + h[7] * p.y + h[8] <= 1e-7)) throw new Error('Keep the corners in a usable perspective.');
  const result = source.map(p => project(h, p)) as Quad;
  if (!isValidProjectionQuad(result)) throw new Error('Keep the corners in a usable perspective.');
  return result;
}

export function moveAlignmentCorner(quad: Quad, bounds: Bounds, index: number, point: Point): Quad | null {
  if (!Number.isInteger(index) || index < 0 || index > 3 || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  try {
    const corners = alignmentCorners(quad, bounds);
    corners[index] = { x: clamp(point.x, 0, 1), y: clamp(point.y, 0, 1) };
    return surfaceQuadFromAnchors(bounds, corners);
  } catch { return null; }
}

/** Clamp movement to the video, allowing its surrounding glow to be cropped at the output edge. */
export function moveAlignment(quad: Quad, bounds: Bounds, delta: Point): Quad {
  if (!Number.isFinite(delta.x) || !Number.isFinite(delta.y)) throw new Error('Invalid projection movement.');
  const corners = alignmentCorners(quad, bounds);
  const shift = (axis: 'x' | 'y') => clamp(delta[axis], Math.min(0, -Math.min(...corners.map(p => p[axis]))), Math.max(0, 1 - Math.max(...corners.map(p => p[axis]))));
  const dx = shift('x'), dy = shift('y');
  const result = quad.map(p => ({ x: p.x + dx, y: p.y + dy })) as Quad;
  if (!isValidProjectionQuad(result)) throw new Error('Invalid projection movement.');
  return result;
}
