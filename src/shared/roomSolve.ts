import { FULL_QUAD, isValidProjectionQuad, project, type Point, type Quad } from './geometry.js';
import { patternSequence } from './calibrationPatterns.js';
import { validateSession, type SensorFrame, type SensorSession } from './sensor.js';
import { add, sub, dot, cross, scale, unit, length, type Surface, type Vec3 } from './spatial.js';
import { captureDepthWitness, validateMeasurement, type SurfaceMeasurement } from './measured.js';
import { cameraToRoom, roomTransform, roomMatchesFrame, validateRoomReference, type RoomReference } from './roomModel.js';

export interface SurfaceCandidate {
  id: string; label: string; kind: 'table' | 'wall' | 'unknown';
  surface: Surface; rmsPx: number; samples: number; heightAboveFloor: number | null;
}
export interface RoomSolve { candidates: SurfaceCandidate[]; decodedPixels: number; message: string }
interface Sample { index: number; p: Vec3; target: Point }
const at = (f: SensorFrame, i: number): Vec3 => [f.cameraPoints![i * 3], f.cameraPoints![i * 3 + 1], f.cameraPoints![i * 3 + 2]];
const lum = (f: SensorFrame, i: number) => (f.color[i * 3] + f.color[i * 3 + 1] + f.color[i * 3 + 2]) / 3;
function random(seed = 7937) { return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }; }

/** Decode complementary Gray stripes only where every bit has measured contrast. */
export function decodeProjectorPixels(session: SensorSession): { reference: SensorFrame; pixels: (Point | null)[]; width: number; height: number } {
  validateSession(session);
  if (session.kind !== 'pattern-capture' || session.status !== 'complete') throw new Error('Finish a complete Gray-code capture before mapping surfaces.');
  const first = session.plannedPatterns[0], expected = patternSequence(first.width, first.height);
  if (JSON.stringify(expected) !== JSON.stringify(session.plannedPatterns)) throw new Error('Surface mapping needs the full Gray-code sequence, including both reference images.');
  const reference = session.frames[0], n = reference.depth.length;
  if (reference.device.colorRegistration !== 'depth' || !reference.cameraPoints) throw new Error('Update and restart the Kinect helper: mapping needs depth-registered color and SDK camera points.');
  const device = JSON.stringify(reference.device);
  // Timestamps and pattern IDs change; geometry and source identity must not.
  const outputGeometry = (i: number) => {
    const p = session.captures[i].presentation;
    return JSON.stringify([p.outputId, p.mode, p.viewport, p.rasterRect, p.fullscreen]);
  };
  for (let f = 0; f < session.frames.length; f++) {
    const frame = session.frames[f];
    if (JSON.stringify(frame.device) !== device || !frame.cameraPoints || outputGeometry(f) !== outputGeometry(0)) throw new Error('Sensor mode or output geometry changed during capture. Keep the rig fixed and capture again.');
    let compared = 0, moved = 0;
    for (let i = 0; i < n; i += 29) if (reference.depth[i] && frame.depth[i]) {
      compared++; if (Math.abs(reference.depth[i] - frame.depth[i]) * reference.device.depthScaleMeters > .025) moved++;
    }
    if (compared < 100 || moved / compared > .035) throw new Error('The sensor or scene moved during capture. Keep the Kinect, projector and table still, then retry.');
  }
  const pixels: (Point | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (!reference.depth[i] || reference.cameraPoints[i * 3 + 2] <= .1) continue;
    const contrast = lum(reference, i) - lum(session.frames[1], i);
    if (contrast < 28) continue;
    let gx = 0, gy = 0, valid = true;
    for (let f = 2; f < session.frames.length; f += 2) {
      const difference = lum(session.frames[f], i) - lum(session.frames[f + 1], i), p = expected[f];
      if (Math.abs(difference) < Math.max(9, contrast * .12)) { valid = false; break; }
      if (difference > 0) { if (p.axis === 'x') gx |= 1 << p.bit!; else gy |= 1 << p.bit!; }
    }
    if (!valid) continue;
    const binary = (g: number) => { let b = g; while ((g >>>= 1)) b ^= g; return b; };
    const x = binary(gx), y = binary(gy);
    if (x < first.width && y < first.height) pixels[i] = { x: (x + .5) / first.width, y: (y + .5) / first.height };
  }
  return { reference, pixels, width: first.width, height: first.height };
}

function linearSolve(rows: number[][]): number[] {
  const size = rows.length, a = rows.map(r => r.slice());
  for (let c = 0; c < size; c++) {
    let pivot = c; for (let r = c + 1; r < size; r++) if (Math.abs(a[r][c]) > Math.abs(a[pivot][c])) pivot = r;
    [a[c], a[pivot]] = [a[pivot], a[c]];
    if (Math.abs(a[c][c]) < 1e-10) throw new Error('Calibration samples are too narrow or collinear.');
    const divisor = a[c][c]; for (let j = c; j <= size; j++) a[c][j] /= divisor;
    for (let r = 0; r < size; r++) if (r !== c) { const k = a[r][c]; for (let j = c; j <= size; j++) a[r][j] -= k * a[c][j]; }
  }
  return a.map(r => r[size]);
}
function fitHomography(pairs: { uv: Point; target: Point }[]) {
  const normal = Array.from({ length: 8 }, () => new Array(9).fill(0));
  for (const { uv: { x, y }, target: { x: u, y: v } } of pairs) for (const row of [[x, y, 1, 0, 0, 0, -u * x, -u * y, u], [0, 0, 0, x, y, 1, -v * x, -v * y, v]]) {
    for (let i = 0; i < 8; i++) for (let j = 0; j <= 8; j++) normal[i][j] += row[i] * row[j];
  }
  return [...linearSolve(normal), 1];
}
function robustHomography(pairs: { uv: Point; target: Point }[], width: number, height: number) {
  const rand = random(), error = (h: number[], pair: typeof pairs[number]) => {
    const p = project(h, pair.uv); return Math.hypot((p.x - pair.target.x) * width, (p.y - pair.target.y) * height);
  };
  let best: typeof pairs = [];
  for (let iteration = 0; iteration < 110; iteration++) {
    try {
      const selected = new Set<number>(); while (selected.size < 4) selected.add(Math.floor(rand() * pairs.length));
      const h = fitHomography([...selected].map(i => pairs[i])), inliers = pairs.filter(p => error(h, p) < 3);
      if (inliers.length > best.length) best = inliers;
    } catch { /* A collinear sample is not a fit. */ }
  }
  if (best.length < 100 || best.length < pairs.length * .75) throw new Error('Not enough consistent projector matches on this plane.');
  const h = fitHomography(best), rms = Math.sqrt(best.reduce((sum, p) => sum + error(h, p) ** 2, 0) / best.length);
  if (rms > 2.5 || FULL_QUAD.some(p => h[6] * p.x + h[7] * p.y + 1 <= .05)) throw new Error('The plane fit is too uncertain.');
  // Full-resolution samples are checked separately below before coverage is accepted.
  return { h, rms, count: best.length, error };
}

/** Smallest covariance eigenvector gives a least-squares plane, not a screen rectangle. */
function refinePlane(points: Vec3[]) {
  const center = scale(points.reduce((sum, p) => add(sum, p), [0, 0, 0] as Vec3), 1 / points.length);
  const a = Array.from({ length: 3 }, () => [0, 0, 0]), eigen = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (const p of points) { const d = sub(p, center); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) a[i][j] += d[i] * d[j]; }
  for (let k = 0; k < 25; k++) {
    let p = 0, q = 1; for (const [i, j] of [[0, 2], [1, 2]]) if (Math.abs(a[i][j]) > Math.abs(a[p][q])) { p = i; q = j; }
    if (Math.abs(a[p][q]) < 1e-10) break;
    const angle = .5 * Math.atan2(2 * a[p][q], a[q][q] - a[p][p]), c = Math.cos(angle), s = Math.sin(angle);
    for (let i = 0; i < 3; i++) { const x = a[i][p], y = a[i][q]; a[i][p] = c * x - s * y; a[i][q] = s * x + c * y; }
    for (let i = 0; i < 3; i++) { const x = a[p][i], y = a[q][i]; a[p][i] = c * x - s * y; a[q][i] = s * x + c * y; const ex = eigen[i][p], ey = eigen[i][q]; eigen[i][p] = c * ex - s * ey; eigen[i][q] = s * ex + c * ey; }
  }
  let index = 0; for (let i = 1; i < 3; i++) if (a[i][i] < a[index][index]) index = i;
  const n = unit([eigen[0][index], eigen[1][index], eigen[2][index]]); return { n, d: -dot(n, center), center };
}
function planeRansac(samples: Sample[]) {
  const rand = random(), pool = samples.filter((_, i) => i % Math.max(1, Math.ceil(samples.length / 7000)) === 0);
  let best: Sample[] = [];
  for (let k = 0; k < 170; k++) {
    const a = pool[Math.floor(rand() * pool.length)].p, b = pool[Math.floor(rand() * pool.length)].p, c = pool[Math.floor(rand() * pool.length)].p;
    const normal = cross(sub(b, a), sub(c, a)); if (length(normal) < .002) continue;
    const n = unit(normal), d = -dot(n, a), inliers = pool.filter(p => Math.abs(dot(n, p.p) + d) < .012);
    if (inliers.length > best.length) best = inliers;
  }
  if (best.length < 100) return null;
  return refinePlane(best.map(p => p.p));
}
function largestComponent(indices: Set<number>, width: number): Set<number> {
  const remaining = new Set(indices); let best = new Set<number>();
  while (remaining.size) {
    const first = remaining.values().next().value!, queue = [first], component = new Set([first]); remaining.delete(first);
    for (let i = 0; i < queue.length; i++) {
      const p = queue[i];
      for (const next of [p - width, p + width, ...(p % width ? [p - 1] : []), ...(p % width < width - 1 ? [p + 1] : [])]) if (remaining.delete(next)) { component.add(next); queue.push(next); }
    }
    if (component.size > best.size) best = component;
  }
  return best;
}
function measuredMask(reference: SensorFrame, indices: Set<number>, uv: (p: Vec3) => Point) {
  const size = 96, grid = new Uint8Array(size * size), w = reference.device.depth.width;
  const triangle = (vertices: Point[]) => {
    const [a, b, c] = vertices.map(p => ({ x: p.x * size, y: p.y * size }));
    const edge = (a: Point, b: Point, x: number, y: number) => (x - a.x) * (b.y - a.y) - (y - a.y) * (b.x - a.x);
    const area = edge(a, b, c.x, c.y); if (Math.abs(area) < 1e-7) return;
    for (let y = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y))); y <= Math.min(size - 1, Math.ceil(Math.max(a.y, b.y, c.y))); y++)
      for (let x = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x))); x <= Math.min(size - 1, Math.ceil(Math.max(a.x, b.x, c.x))); x++)
        if (edge(a, b, x + .5, y + .5) * area >= 0 && edge(b, c, x + .5, y + .5) * area >= 0 && edge(c, a, x + .5, y + .5) * area >= 0) grid[y * size + x] = 1;
  };
  // Only neighboring measured samples fill a cell: no hull over unknown space or objects.
  for (const i of indices) if (i % w < w - 1 && indices.has(i + 1) && indices.has(i + w) && indices.has(i + w + 1)) {
    const p = [i, i + 1, i + w + 1, i + w].map(n => at(reference, n));
    if (p.some(q => length(sub(q, p[0])) > .08)) continue;
    const q = p.map(uv); triangle([q[0], q[1], q[2]]); triangle([q[0], q[2], q[3]]);
  }
  // One-cell inset avoids spraying onto depth-edge uncertainty.
  const bits = Array.from(grid, (value, i) => value && i % size > 0 && i % size < size - 1 && i >= size && i < size * (size - 1) && [-size, size, -1, 1].every(d => grid[i + d]) ? '1' : '0').join('');
  if (bits.split('1').length - 1 < size * size * .12) throw new Error('Too little continuous, visible surface remains after excluding unknown pixels.');
  return { width: size, height: size, bits };
}

export function solveRoomSurfaces(session: SensorSession, room?: RoomReference): RoomSolve {
  const decoded = decodeProjectorPixels(session), { reference, pixels, width, height } = decoded;
  if (room) {
    validateRoomReference(room);
    if (room.invalidated) throw new Error('The saved room was invalidated by movement or a sensor change. Capture a new room reference.');
    if (session.provenance !== room.source || !session.frames.every(frame => roomMatchesFrame(room, frame))) throw new Error('Capture does not match the saved room. Re-scan after fixing the rig.');
  }
  const samples: Sample[] = [];
  for (let i = 0; i < pixels.length; i++) if (pixels[i]) samples.push({ index: i, p: at(reference, i), target: pixels[i]! });
  if (samples.length < 300) throw new Error('Too few projector pixels were visible. Aim both devices at the same surface, dim the room and capture again.');
  const transform = room?.transform ?? roomTransform(reference.floorPlane), floor = transform.floorAligned, up = transform.up;
  const world = (p: Vec3, position = false): Vec3 => cameraToRoom(p, transform, position);
  let remaining = samples; const candidates: SurfaceCandidate[] = [], failures: string[] = [];
  for (let planeIndex = 0; planeIndex < 6 && remaining.length >= 300; planeIndex++) {
    const plane = planeRansac(remaining); if (!plane) break;
    const inliers = remaining.filter(p => Math.abs(dot(plane.n, p.p) + plane.d) < .015);
    const connected = largestComponent(new Set(inliers.map(p => p.index)), reference.device.depth.width);
    remaining = remaining.filter(p => !connected.has(p.index));
    if (connected.size < 250) continue;
    try {
      const points = inliers.filter(p => connected.has(p.index)), refined = refinePlane(points.map(p => p.p));
      let n = refined.n; if (n[2] < 0) n = scale(n, -1);
      let u = sub([-1, 0, 0], scale(n, dot([-1, 0, 0], n)));
      if (length(u) < .1) u = sub([0, 0, 1], scale(n, dot([0, 0, 1], n)));
      u = unit(u); const v = unit(cross(n, u)), center = refined.center;
      const coordinates = points.map(p => ({ x: dot(sub(p.p, center), u), y: dot(sub(p.p, center), v) }));
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const p of coordinates) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
      const sw = x1 - x0, sh = y1 - y0;
      if (sw < .18 || sh < .18 || sw * sh < .09) throw new Error('Patch is too small to map reliably.');
      const uv = (p: Vec3) => ({ x: (dot(sub(p, center), u) - x0) / sw, y: (dot(sub(p, center), v) - y0) / sh });
      const step = Math.max(1, Math.floor(points.length / 1200)), pairs = points.filter((_, i) => i % step === 0).map(p => ({ uv: uv(p.p), target: p.target }));
      const fit = robustHomography(pairs, width, height);
      const good = new Set(points.filter(p => fit.error(fit.h, { uv: uv(p.p), target: p.target }) < 4).map(p => p.index));
      const presentation = session.captures[0].presentation, viewport = presentation.viewport, rect = presentation.rasterRect;
      const stageW = Math.min(viewport.width, viewport.height * 16 / 9), stageH = stageW * 9 / 16;
      const quad = FULL_QUAD.map(p => { const pixel = project(fit.h, p); return { x: (rect.x + pixel.x * rect.width - (viewport.width - stageW) / 2) / stageW, y: (rect.y + pixel.y * rect.height - (viewport.height - stageH) / 2) / stageH }; }) as Quad;
      if (!isValidProjectionQuad(quad)) throw new Error('Surface projects with an unsupported orientation. Reposition the Kinect.');
      const elevation = floor ? dot(center, up) + transform.heightOffset : null, horizontal = Math.abs(dot(n, up));
      const kind = floor && horizontal > .94 && elevation! >= .35 && elevation! <= 1.5 ? 'table' : floor && horizontal < .25 ? 'wall' : 'unknown';
      const measurement: SurfaceMeasurement = { sessionId: session.id, sensorId: reference.device.id, capturedAtMs: reference.capturedAtMs, source: session.provenance,
        rmsPx: fit.rms, correspondences: good.size, quad, raster: { width, height }, viewport: { ...viewport }, mask: measuredMask(reference, good, uv), floorAligned: !!floor, depthWitness: captureDepthWitness(reference), ...(room ? { roomReferenceId: room.id } : {}) };
      validateMeasurement(measurement);
      const surface: Surface = { id: kind === 'wall' ? 'wall' : 'tabletop', name: kind === 'wall' ? 'Measured wall' : 'Measured tabletop', kind: kind === 'wall' ? 'wall' : 'table',
        provenance: session.provenance === 'sensor' ? 'measured' : 'simulated', origin: world(add(center, add(scale(u, x0), scale(v, y0))), true), u: world(u), v: world(v), width: sw, height: sh,
        boundary: structuredClone(FULL_QUAD), holes: [], measurement };
      candidates.push({ id: `plane-${planeIndex}`, kind, label: kind === 'table' ? 'Table-height horizontal surface' : kind === 'wall' ? 'Vertical surface' : 'Flat surface — choose its role', surface, rmsPx: fit.rms, samples: good.size, heightAboveFloor: elevation });
    } catch (e) { failures.push(e instanceof Error ? e.message : String(e)); }
  }
  if (!candidates.length) throw new Error('No reliable flat surface could be mapped. ' + (failures[0] ?? 'Keep the whole table in both devices’ view.'));
  return { candidates, decodedPixels: samples.length, message: `${candidates.length} flat surface${candidates.length === 1 ? '' : 's'} mapped. ${floor ? 'Table candidates use measured floor orientation and height; review the footprint.' : 'No reliable floor direction was supplied. Choose which detected plane is the table.'}` };
}
