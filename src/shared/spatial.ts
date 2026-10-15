import { clamp, FULL_QUAD, type Bounds, type Point } from './geometry.js';

export type Vec3 = [number, number, number];
export interface Surface {
  id: string; name: string; kind: 'table' | 'wall'; provenance: 'simulated';
  origin: Vec3; u: Vec3; v: Vec3; width: number; height: number;
  boundary: Point[]; holes: Point[][];
}
export interface CameraPose { position: Vec3; target: Vec3; fov: number; aspect: number }
export interface Projector extends CameraPose { id: string; name: string; enabled: boolean; calibration: 'simulated'; color: string }
export interface Viewer extends CameraPose { id: string; mode: 'fixed'; provenance: 'simulated' }
export interface Coverage { id: string; surfaceId: string; projectorId: string; geometryRevision: number; status: 'simulated' | 'disabled' }
export interface SpatialScene { surfaces: Surface[]; projectors: Projector[]; geometryRevision: number }

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, b: number): Vec3 => [a[0] * b, a[1] * b, a[2] * b];
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const length = (a: Vec3) => Math.hypot(...a);
export const unit = (a: Vec3): Vec3 => { const l = length(a); if (l < 1e-8) throw new Error('Invalid zero-length direction.'); return scale(a, 1 / l); };
export const finiteVec = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every(n => Number.isFinite(n) && Math.abs(n) <= 100);

/** Recognize the old simulator notch when opening a saved room; it was never measured. */
export const LEGACY_WALL_BOUNDARY: Point[] = [{ x: 0, y: 0 }, { x: .88, y: 0 }, { x: 1, y: .18 }, { x: 1, y: 1 }, { x: 0, y: 1 }];

export const LEGACY_WALL_HOLES: Point[][] = [[{ x: .055, y: .5 }, { x: .21, y: .5 }, { x: .21, y: .88 }, { x: .055, y: .88 }]];

export function defaultSpatial() {
  const surfaces: Surface[] = [
    { id: 'tabletop', name: 'Tabletop', kind: 'table', provenance: 'simulated', origin: [-1.1, .8, -.45], u: [1, 0, 0], v: [0, 0, 1], width: 2.2, height: 1.35, boundary: structuredClone(FULL_QUAD), holes: [] },
    { id: 'wall', name: 'Back wall', kind: 'wall', provenance: 'simulated', origin: [-2.2, 2.6, -1.65], u: [1, 0, 0], v: [0, -1, 0], width: 4.4, height: 2.6,
      boundary: structuredClone(FULL_QUAD),
      holes: [] },
  ];
  const projectors: Projector[] = [
    { id: 'projector-a', name: 'Projector A', color: '#79d6bd', position: [-1.5, 2.85, 2.1], target: [-.45, 1, -.65], fov: 58, aspect: 16 / 9, enabled: true, calibration: 'simulated' },
    { id: 'projector-b', name: 'Projector B', color: '#f4bd77', position: [1.5, 2.85, 2.1], target: [.45, 1, -.65], fov: 58, aspect: 16 / 9, enabled: true, calibration: 'simulated' },
  ];
  const viewer: Viewer = { id: 'viewer', mode: 'fixed', provenance: 'simulated', position: [.25, 1.7, 4.2], target: [0, 1.05, -.5], fov: 57, aspect: 16 / 9 };
  return { surfaces, projectors, viewer };
}

/** Room frame: meters in the simulator, +Y up. UV has top-left origin and V down. */
export function surfacePoint(s: Surface, p: Point): Vec3 { return add(s.origin, add(scale(s.u, p.x * s.width), scale(s.v, p.y * s.height))); }
export function surfaceUV(s: Surface, p: Vec3): Point { const d = sub(p, s.origin); return { x: dot(d, s.u) / s.width, y: dot(d, s.v) / s.height }; }
export const surfaceNormal = (s: Surface): Vec3 => unit(cross(s.v, s.u));

function onSegment(p: Point, a: Point, b: Point) {
  return Math.abs((p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x)) < 1e-9 && p.x >= Math.min(a.x, b.x) - 1e-9 && p.x <= Math.max(a.x, b.x) + 1e-9 && p.y >= Math.min(a.y, b.y) - 1e-9 && p.y <= Math.max(a.y, b.y) + 1e-9;
}
export function inPolygon(p: Point, polygon: Point[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if (onSegment(p, a, b)) return true;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
export const inDomain = (s: Surface, p: Point) => inPolygon(p, s.boundary) && !s.holes.some(h => inPolygon(p, h));
function properIntersection(a: Point, b: Point, c: Point, d: Point) {
  const side = (a: Point, b: Point, p: Point) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  return side(a, b, c) * side(a, b, d) < -1e-12 && side(c, d, a) * side(c, d, b) < -1e-12;
}
export function boundsInDomain(s: Surface, b: Bounds) {
  const corners = [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y }, { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h }];
  if (!corners.every(p => inDomain(s, p))) return false;
  if (s.holes.some(h => h.some(p => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h))) return false;
  for (const polygon of [s.boundary, ...s.holes]) for (let i = 0; i < polygon.length; i++) for (let j = 0; j < 4; j++) {
    if (properIntersection(polygon[i], polygon[(i + 1) % polygon.length], corners[j], corners[(j + 1) % 4])) return false;
  }
  return true;
}
/** Find a deterministic free placement near the requested location; no model correction loop. */
export function fitBounds(s: Surface, b: Bounds): Bounds {
  if (boundsInDomain(s, b)) return b;
  let best: Bounds | null = null, distance = Infinity;
  for (let y = 0; y <= 40; y++) for (let x = 0; x <= 40; x++) {
    const candidate = { ...b, x: x / 40 * (1 - b.w), y: y / 40 * (1 - b.h) };
    const d = (candidate.x - b.x) ** 2 + (candidate.y - b.y) ** 2;
    if (d < distance && boundsInDomain(s, candidate)) { best = candidate; distance = d; }
  }
  if (!best) throw new Error('That panel is too large for this surface. Reduce its size first.');
  return best;
}

export function cameraBasis(camera: CameraPose) {
  const forward = unit(sub(camera.target, camera.position));
  const right = unit(cross(forward, [0, 1, 0]));
  return { forward, right, up: cross(right, forward) };
}
export function cameraPoint(camera: CameraPose, world: Vec3) {
  const { forward, right, up } = cameraBasis(camera), delta = sub(world, camera.position), depth = dot(delta, forward);
  const t = Math.tan(camera.fov * Math.PI / 360);
  return { x: .5 + dot(delta, right) / (2 * depth * t * camera.aspect), y: .5 - dot(delta, up) / (2 * depth * t), depth };
}
export function visibleFrom(scene: SpatialScene, s: Surface, uv: Point, projector: Projector): boolean {
  if (!projector.enabled || !inDomain(s, uv)) return false;
  const world = surfacePoint(s, uv), p = cameraPoint(projector, world);
  if (p.depth <= .05 || p.depth > 30 || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1 || dot(surfaceNormal(s), sub(projector.position, world)) <= 0) return false;
  const ray = sub(world, projector.position);
  for (const other of scene.surfaces) {
    if (other.id === s.id) continue;
    const normal = surfaceNormal(other), denominator = dot(normal, ray);
    if (Math.abs(denominator) < 1e-9) continue;
    const t = dot(normal, sub(other.origin, projector.position)) / denominator;
    // Excluded drawing regions are still physical occluders in this simulator.
    if (t > 1e-5 && t < 1 - 1e-5 && inPolygon(surfaceUV(other, add(projector.position, scale(ray, t))), other.boundary)) return false;
  }
  return true;
}
export function coverageWeights(scene: SpatialScene, s: Surface, uv: Point): number[] {
  const world = surfacePoint(s, uv);
  const raw = scene.projectors.map(p => {
    if (!visibleFrom(scene, s, uv, p)) return 0;
    const pos = cameraPoint(p, world);
    return clamp(Math.min(pos.x, 1 - pos.x, pos.y, 1 - pos.y) * 7, .005, 1);
  });
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map(w => sum ? w / sum : 0);
}
export function coverageRecords(scene: SpatialScene): Coverage[] {
  return scene.projectors.flatMap(p => scene.surfaces.map(s => ({ id: `${p.id}:${s.id}`, surfaceId: s.id, projectorId: p.id, geometryRevision: scene.geometryRevision, status: p.enabled ? 'simulated' : 'disabled' })));
}
export function surfaceClipPath(s: Surface, width: number, height: number) {
  const path = [s.boundary, ...s.holes].map(poly => `${poly.map((p, i) => `${i ? 'L' : 'M'}${p.x * width} ${p.y * height}`).join(' ')} Z`).join(' ');
  return `path(evenodd, "${path}")`;
}
