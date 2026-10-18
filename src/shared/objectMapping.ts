import type { Vec3 } from './spatial.js';
import type { RoomReference } from './roomModel.js';

export interface TrackingRegion { x: number; y: number; w: number; h: number }
export interface ProjectorFit {
  id: string; roomReferenceId: string; sensorId: string; descriptor: string;
  matrix: number[]; bounds: { min: Vec3; max: Vec3 };
  rmsPx: number; p95Px: number; samples: number; heldOut: number;
  raster: { width: number; height: number };
  viewport: { width: number; height: number; devicePixelRatio: number };
  rasterRect: { x: number; y: number; width: number; height: number }; outputId: string;
}
export interface ObjectMappingStatus {
  state: 'uncalibrated' | 'ready' | 'tracking' | 'lost' | 'blocked'; message: string;
  calibrationId?: string; rmsPx?: number; ageMs?: number; canFill: boolean;
  object?: { id: string; name: string; points: number; speedMps: number; color: string | null };
}
export interface ObjectObservation {
  capturedAtMs: number; clockUncertaintyMs:number; sequence: number; region: TrackingRegion; points: number;
  center: Vec3; extent: Vec3; speedMps: number; positions: number[];
  mask: { width: number; height: number; bits: Uint8Array };
}
export interface ObjectPreview { roomReferenceId: string; positions: number[]; color: string; at: number; region:TrackingRegion }
export function projectCamera(matrix: number[], p: Vec3) {
  const value = (i: number) => matrix[i] * p[0] + matrix[i + 1] * p[1] + matrix[i + 2] * p[2] + matrix[i + 3];
  const depth = value(8);
  return { x: value(0) / depth, y: value(4) / depth, depth };
}
export function pointInFit(fit: ProjectorFit, p: Vec3) {
  return p.every((n, a) => n >= fit.bounds.min[a] - .02 && n <= fit.bounds.max[a] + .02);
}
export function validRegion(r: TrackingRegion) {
  return r && [r.x, r.y, r.w, r.h].every(Number.isFinite) && r.x >= 0 && r.y >= 0 && r.w >= .05 && r.h >= .05 && r.x + r.w <= 1.00001 && r.y + r.h <= 1.00001 && r.w * r.h <= .2;
}
export function regionContains(r: TrackingRegion, x: number, y: number) { return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h; }
export function fitMatchesRoom(fit: ProjectorFit, room: RoomReference | null) { return !!room && !room.invalidated && room.source === 'sensor' && fit.roomReferenceId === room.id && fit.descriptor === room.descriptor; }
