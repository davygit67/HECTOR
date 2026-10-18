import type { SensorFrame } from './sensor.js';
import { cross, dot, length, scale, sub, unit, type Vec3 } from './spatial.js';

export const ROOM_SAMPLE_COUNT = 12;
export interface RoomTransform { right: Vec3; up: Vec3; forward: Vec3; heightOffset: number; floorAligned: boolean }
export interface RoomSample {
  descriptor: string; sensorId: string; source: 'sensor' | 'synthetic'; capturedAtMs: number; sequence: number;
  width: number; height: number; step: number; meters: number[]; xyz: number[]; rgb: number[];
  floor?: [number, number, number, number];
}
export interface RoomReference {
  version: 1; id: string; sensorId: string; descriptor: string; source: 'sensor' | 'synthetic'; createdAtMs: number;
  invalidated?: 'moved' | 'different-sensor';
  frames: number; spanMs: number; stableFraction: number; transform: RoomTransform;
  witness: { width: number; height: number; step: number; meters: number[] };
  positions: number[]; colors: number[];
}
export interface RoomModelStatus {
  state: 'empty' | 'collecting' | 'ready' | 'checking' | 'stale' | 'moved' | 'different-sensor';
  message: string; referenceId?: string; sensorId?: string; points: number; frames: number;
  stableFraction?: number; ageMs?: number; floorAligned: boolean; canMap: boolean;
}
export function roomTransform(floor?: readonly number[]): RoomTransform {
  const up: Vec3 = floor ? [floor[0], floor[1], floor[2]] : [0, 1, 0];
  let right = sub([-1, 0, 0], scale(up, dot([-1, 0, 0], up)));
  if (length(right) < .1) right = sub([0, 0, 1], scale(up, dot([0, 0, 1], up)));
  right = unit(right);
  return { right, up, forward: unit(cross(right, up)), heightOffset: floor?.[3] ?? 0, floorAligned: !!floor };
}
export function cameraToRoom(p: Vec3, t: RoomTransform, position = true): Vec3 {
  return [dot(p, t.right), dot(p, t.up) + (position ? t.heightOffset : 0), dot(p, t.forward)];
}
/** Bounded sampling before worker transfer; no whole RGB-D history or delayed frame queue. */
export function sampleRoomFrame(f: SensorFrame): RoomSample {
  if (!f.cameraPoints || f.device.colorRegistration !== 'depth') throw new Error('Update the Kinect helper: room capture needs registered RGB and measured XYZ.');
  const step = Math.max(1, Math.ceil(f.depth.length / 12000)), meters: number[] = [], xyz: number[] = [], rgb: number[] = [];
  for (let i = 0; i < f.depth.length; i += step) {
    const z = f.depth[i] * f.device.depthScaleMeters, p = Array.from(f.cameraPoints.subarray(i * 3, i * 3 + 3));
    const valid = z > .2 && z < 8 && p.every(Number.isFinite) && Math.abs(p[2] - z) < .04;
    meters.push(valid ? z : 0); xyz.push(...(valid ? p : [0, 0, 0])); rgb.push(...f.color.subarray(i * 3, i * 3 + 3));
  }
  return { descriptor: JSON.stringify(f.device), sensorId: f.device.id, source: f.device.kind === 'synthetic' ? 'synthetic' : 'sensor',
    capturedAtMs: f.capturedAtMs, sequence: f.sequence, width: f.device.depth.width, height: f.device.depth.height, step, meters, xyz, rgb, floor: f.floorPlane };
}
const median = (a: number[]) => { a.sort((x, y) => x - y); const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
/** Fixed sensor only. Temporal consensus never fills missing rays or registers a moved camera. */
export function aggregateRoom(samples: RoomSample[], id: string): RoomReference {
  if (samples.length !== ROOM_SAMPLE_COUNT) throw new Error('Collect twelve fresh room observations.');
  const first = samples[0], last = samples.at(-1)!;
  if (last.capturedAtMs - first.capturedAtMs < 1500 || last.capturedAtMs - first.capturedAtMs > 12000) throw new Error('Room observations need a continuous, stable capture of at least 1.5 seconds.');
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (s.descriptor !== first.descriptor || s.meters.length !== first.meters.length || s.meters.length > 12000 || s.xyz.length !== s.meters.length * 3 || s.rgb.length !== s.xyz.length ||
        i && (s.sequence <= samples[i - 1].sequence || s.capturedAtMs <= samples[i - 1].capturedAtMs)) throw new Error('The sensor changed during room capture. Start again with the rig still.');
  }
  const floors = samples.map(s => s.floor).filter((f): f is NonNullable<RoomSample['floor']> => !!f);
  let floor: number[] | undefined;
  if (floors.length >= 9) {
    floor = [0, 1, 2, 3].map(i => median(floors.map(f => f[i])));
    const n = Math.hypot(...floor.slice(0, 3)); floor = floor.map(v => v / n);
    if (floors.some(f => dot(f.slice(0, 3) as Vec3, floor!.slice(0, 3) as Vec3) < .9986 || Math.abs(f[3] - floor![3]) > .025)) throw new Error('Floor orientation changed. Keep the rig still and capture the room again.');
  }
  const transform = roomTransform(floor), meters = new Array(first.meters.length).fill(0), positions: number[] = [], colors: number[] = [];
  let observed = 0, stable = 0;
  for (let i = 0; i < meters.length; i++) {
    const valid = samples.filter(s => s.meters[i] > 0); if (valid.length) observed++;
    if (valid.length < 10) continue;
    const z = median(valid.map(s => s.meters[i]));
    const inliers = valid.filter(s => Math.abs(s.meters[i] - z) <= .015);
    if (inliers.length < 10) continue;
    const p = [0, 1, 2].map(axis => median(inliers.map(s => s.xyz[i * 3 + axis]))) as Vec3;
    if (inliers.some(s => Math.hypot(...p.map((v, a) => v - s.xyz[i * 3 + a])) > .035)) continue;
    meters[i] = z; stable++; positions.push(...cameraToRoom(p, transform));
    colors.push(...[0, 1, 2].map(axis => Math.round(median(inliers.map(s => s.rgb[i * 3 + axis])))));
  }
  if (stable < 300 || stable / Math.max(1, observed) < .65) throw new Error('Too little stable depth. Keep the rig and objects still, clear the view and retry.');
  const reference: RoomReference = { version: 1, id, sensorId: first.sensorId, descriptor: first.descriptor, source: first.source, createdAtMs: last.capturedAtMs,
    frames: samples.length, spanMs: last.capturedAtMs - first.capturedAtMs, stableFraction: stable / observed, transform,
    witness: { width: first.width, height: first.height, step: first.step, meters }, positions, colors };
  validateRoomReference(reference); return reference;
}
export function validateRoomReference(r: RoomReference) {
  if (r?.invalidated !== undefined && !['moved', 'different-sensor'].includes(r.invalidated)) throw new Error('Invalid saved room state.');
  if (!r || r.version !== 1 || typeof r.id !== 'string' || !r.id || r.id.length > 128 || typeof r.sensorId !== 'string' || r.sensorId.length > 128 ||
    typeof r.descriptor !== 'string' || r.descriptor.length > 16000 || !['sensor', 'synthetic'].includes(r.source) || !Number.isFinite(r.createdAtMs) ||
    r.frames !== ROOM_SAMPLE_COUNT || !Number.isFinite(r.spanMs) || r.spanMs < 1500 || r.spanMs > 12000 || !Number.isFinite(r.stableFraction) || r.stableFraction < .65 || r.stableFraction > 1 ||
    !Array.isArray(r.positions) || r.positions.length < 900 || r.positions.length > 36000 || r.positions.length % 3 || r.positions.some(n => !Number.isFinite(n) || Math.abs(n) > 100) ||
    !Array.isArray(r.colors) || r.colors.length !== r.positions.length || r.colors.some(n => !Number.isInteger(n) || n < 0 || n > 255)) throw new Error('Invalid saved room reference. Capture the room again.');
  const t = r.transform, w = r.witness;
  if (!t || typeof t.floorAligned !== 'boolean' || !Number.isFinite(t.heightOffset) || Math.abs(t.heightOffset) > 20 ||
    [t.right, t.up, t.forward].some(v => !Array.isArray(v) || v.length !== 3 || v.some(n => !Number.isFinite(n)) || Math.abs(length(v) - 1) > .001) ||
    Math.abs(dot(t.right, t.up)) > .001 || length(sub(cross(t.right, t.up), t.forward)) > .001 ||
    !w || ![w.width, w.height, w.step].every(n => Number.isInteger(n) && n > 0 && n <= 8192) || !Array.isArray(w.meters) || w.meters.length > 12000 ||
    w.meters.length !== Math.ceil(w.width * w.height / w.step) || w.meters.some(n => !Number.isFinite(n) || n < 0 || n > 8) || w.meters.filter(Boolean).length !== r.positions.length / 3) throw new Error('Invalid metric room frame. Capture the room again.');
}
export function roomMatchesFrame(r: RoomReference, f: SensorFrame): boolean {
  if (JSON.stringify(f.device) !== r.descriptor || !f.cameraPoints) return false;
  let count = 0, changed = 0, point = 0;
  for (let i = 0; i < r.witness.meters.length; i++) {
    const z = r.witness.meters[i]; if (!z) continue;
    const now = f.depth[i * r.witness.step] * f.device.depthScaleMeters; count++;
    const index = i * r.witness.step * 3;
    const measured = cameraToRoom([f.cameraPoints[index], f.cameraPoints[index + 1], f.cameraPoints[index + 2]], r.transform);
    if (!now || Math.abs(now - z) > .025 || Math.hypot(...measured.map((n, a) => n - r.positions[point + a])) > .035) changed++;
    point += 3;
  }
  return count >= 300 && changed / count <= .035;
}
export class RoomContinuity {
  reference: RoomReference | null = null;
  private matches = 0; private lastAt = 0; private lastCapture = -1; private generation = -1;
  private mismatch: 'moved' | 'different-sensor' | null = null;
  setReference(r: RoomReference | null) { if (r) validateRoomReference(r); this.reference = r; this.matches = 0; this.lastAt = 0; this.lastCapture = -1; this.generation = -1; this.mismatch = r?.invalidated ?? null; }
  disconnected() { this.matches = 0; this.lastAt = 0; this.lastCapture = -1; }
  observe(f: SensorFrame, now: number, generation: number) {
    const r = this.reference; if (!r) return;
    if (this.generation !== generation || now - this.lastAt > 2000) { this.matches = 0; this.lastCapture = -1; this.generation = generation; }
    if (f.capturedAtMs <= this.lastCapture || now - f.capturedAtMs > 2000 + f.clockUncertaintyMs || f.clockUncertaintyMs > 500) { this.matches = 0; return; }
    if (this.lastAt && now - this.lastAt < 150) return;
    this.lastCapture = f.capturedAtMs; this.lastAt = now;
    if (JSON.stringify(f.device) !== r.descriptor) { this.mismatch = 'different-sensor'; this.matches = 0; }
    else if (!roomMatchesFrame(r, f)) { this.mismatch = 'moved'; this.matches = 0; }
    else this.matches++;
  }
  status(now = Date.now()): RoomModelStatus {
    const r = this.reference;
    const state = !r ? 'empty' : this.mismatch ?? (!this.lastAt || now - this.lastAt > 2000 ? 'stale' : this.matches < 3 ? 'checking' : 'ready');
    const message = { empty: 'Capture a stable room reference before automatic mapping.', ready: 'Live depth agrees with the saved room. Ready for projector calibration.', checking: 'Checking returning frames against the saved room…', stale: 'Room retained. Waiting for fresh sensor observations before new mapping.', moved: 'The view changed. Capture a new room reference and recalibrate before mapping.', 'different-sensor': 'Sensor or camera mode changed. Capture a new reference and recalibrate.' }[state];
    return { state, message, referenceId: r?.id, sensorId: r?.sensorId, points: (r?.positions.length ?? 0) / 3, frames: r?.frames ?? 0,
      stableFraction: r?.stableFraction, ageMs: r ? Math.max(0, now - r.createdAtMs) : undefined, floorAligned: r?.transform.floorAligned ?? false, canMap: state === 'ready' && r?.source === 'sensor' };
  }
}
