import { isValidProjectionQuad, type Quad } from './geometry.js';
import type { SensorFrame } from './sensor.js';

/** A fixed-rig, one-plane calibration. It is not a solved 3D projector pose. */
export interface SurfaceMeasurement {
  sessionId: string; sensorId: string; capturedAtMs: number; source: 'sensor' | 'synthetic';
  rmsPx: number; correspondences: number; quad: Quad;
  raster: { width: number; height: number };
  viewport: { width: number; height: number; devicePixelRatio: number };
  mask: { width: number; height: number; bits: string };
  floorAligned: boolean;
  /** Frozen metric frame used by this calibration; new room captures retire this fit. */
  roomReferenceId?: string;
  depthWitness?: { width: number; height: number; step: number; meters: number[] };
}
export function validateMeasurement(m: SurfaceMeasurement) {
  if (m?.roomReferenceId !== undefined && (typeof m.roomReferenceId !== 'string' || !m.roomReferenceId || m.roomReferenceId.length > 128)) throw new Error('Invalid room reference.');
  if (!m || !['sensor', 'synthetic'].includes(m.source) || typeof m.sessionId !== 'string' || !m.sessionId || m.sessionId.length > 128 ||
      typeof m.sensorId !== 'string' || !m.sensorId || m.sensorId.length > 128 || !Number.isFinite(m.capturedAtMs) || m.capturedAtMs < 0 ||
      !Number.isFinite(m.rmsPx) || m.rmsPx < 0 || m.rmsPx > 3 || !Number.isSafeInteger(m.correspondences) || m.correspondences < 100 ||
      m.correspondences > 2_500_000 || !isValidProjectionQuad(m.quad) || m.quad.some(p => Math.abs(p.x) > 4 || Math.abs(p.y) > 4) ||
      typeof m.floorAligned !== 'boolean') throw new Error('Invalid measured surface calibration.');
  for (const s of [m.raster, m.viewport]) if (!s || !Number.isFinite(s.width) || !Number.isFinite(s.height) || s.width < 16 || s.height < 16 || s.width > 16384 || s.height > 16384) throw new Error('Invalid calibration raster.');
  if (!Number.isFinite(m.viewport.devicePixelRatio) || m.viewport.devicePixelRatio < .1 || m.viewport.devicePixelRatio > 8 ||
      !m.mask || !Number.isInteger(m.mask.width) || !Number.isInteger(m.mask.height) || m.mask.width < 8 || m.mask.height < 8 || m.mask.width > 128 || m.mask.height > 128 ||
      typeof m.mask.bits !== 'string' || m.mask.bits.length !== m.mask.width * m.mask.height || /[^01]/.test(m.mask.bits) || !m.mask.bits.includes('1')) throw new Error('Invalid measured coverage mask.');
  const w = m.depthWitness;
  if (w && (![w.width, w.height, w.step].every(n => Number.isInteger(n) && n > 0 && n <= 8192) || !Array.isArray(w.meters) || w.meters.length > 4096 || w.meters.length !== Math.ceil(w.width * w.height / w.step) || w.meters.some(n => !Number.isFinite(n) || n < 0 || n > 100))) throw new Error('Invalid calibration depth witness.');
}

export function captureDepthWitness(frame: SensorFrame): NonNullable<SurfaceMeasurement['depthWitness']> {
  const step = Math.max(1, Math.ceil(frame.depth.length / 2000));
  return { width: frame.device.depth.width, height: frame.device.depth.height, step,
    meters: Array.from({ length: Math.ceil(frame.depth.length / step) }, (_, i) => frame.depth[i * step] * frame.device.depthScaleMeters) };
}
/** A conservative stale-view check, not tracking and not proof that the projector stayed still. */
export function measurementMatchesFrame(m: SurfaceMeasurement, frame: SensorFrame): boolean {
  const w = m.depthWitness;
  if (!w || m.sensorId !== frame.device.id || w.width !== frame.device.depth.width || w.height !== frame.device.depth.height) return false;
  let valid = 0, changed = 0;
  w.meters.forEach((meters, i) => { if (!meters) return; valid++; const now = frame.depth[i * w.step] * frame.device.depthScaleMeters; if (!now || Math.abs(meters - now) > .025) changed++; });
  return valid >= 100 && changed / valid <= .035;
}

/** Runs, rather than thousands of independent pixels, keep the clip cheap. */
export function measuredMaskPath(mask: SurfaceMeasurement['mask'], width: number, height: number): string {
  const path: string[] = [], sx = width / mask.width, sy = height / mask.height;
  for (let y = 0; y < mask.height; y++) for (let x = 0; x < mask.width;) {
    if (mask.bits[y * mask.width + x] !== '1') { x++; continue; }
    const start = x; while (x < mask.width && mask.bits[y * mask.width + x] === '1') x++;
    path.push(`M${start * sx} ${y * sy}h${(x - start) * sx}v${sy}h${-(x - start) * sx}Z`);
  }
  return path.join('');
}
const cssCache = new WeakMap<SurfaceMeasurement, string>();
export function measuredMaskCSS(m?: SurfaceMeasurement): string | undefined {
  if (!m) return undefined;
  let value = cssCache.get(m);
  if (!value) { value = `path("${measuredMaskPath(m.mask, 1920, 1080)}")`; cssCache.set(m, value); }
  return value;
}
