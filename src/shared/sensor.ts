import { validatePattern, type CalibrationPattern } from './calibrationPatterns.js';

export const SENSOR_LIMITS = { maxPixels: 2_500_000, maxFrameBytes: 12 * 1024 * 1024, maxSessionBytes: 384 * 1024 * 1024, maxFrames: 300, maxHeaderBytes: 1024 * 1024 } as const;
export interface ImageSize { width: number; height: number }
export interface CameraIntrinsics extends ImageSize { fx: number; fy: number; cx: number; cy: number; distortion: number[] }
export interface SensorDevice {
  id: string; label: string; kind: 'synthetic' | 'kinect-v2' | 'rgbd';
  color: ImageSize; depth: ImageSize; depthScaleMeters: number;
  colorIntrinsics: CameraIntrinsics | null; depthIntrinsics: CameraIntrinsics | null;
  /** Row-major, meters: colorPoint = depthToColor * depthPoint. Null means unknown. */
  depthToColor: number[] | null;
}
export interface SensorFrame {
  device: SensorDevice;
  sequence: number;
  /** Bridge-normalized exposure midpoint in Unix milliseconds; never browser receipt time. */
  capturedAtMs: number;
  exposureMs: number | null;
  /** Bridge estimate for how uncertain the normalized capture clock is. */
  clockUncertaintyMs: number;
  color: Uint8Array; // tightly packed RGB8, top-left origin
  depth: Uint16Array; // row-major; zero is invalid; raw * depthScaleMeters = meters
}
export interface PatternPresentation {
  patternId: string; presentedAtMs: number; outputId: string;
  mode: 'synthetic' | 'output-window';
  viewport: { width: number; height: number; devicePixelRatio: number };
  /** Actual displayed raster rectangle in CSS pixels, relative to the output viewport. */
  rasterRect: { x: number; y: number; width: number; height: number };
}
export interface CaptureAssociation {
  frameIndex: number; pattern: CalibrationPattern; presentation: PatternPresentation;
  settleMs: number; receivedAtMs: number;
}
export interface SensorSession {
  version: 1; id: string; name: string; createdAtMs: number;
  kind: 'recording' | 'pattern-capture'; provenance: 'synthetic' | 'sensor';
  status: 'complete' | 'cancelled' | 'failed'; message: string;
  frames: SensorFrame[]; captures: CaptureAssociation[]; plannedPatterns: CalibrationPattern[];
}
const textEncoder = new TextEncoder(), textDecoder = new TextDecoder('utf-8', { fatal: true });
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function finite(value: unknown, min: number, max: number) { return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max; }
function size(value: unknown): value is ImageSize {
  if (!object(value)) return false;
  return Number.isInteger(value.width) && Number.isInteger(value.height) && finite(value.width, 1, 4096) && finite(value.height, 1, 2160) && Number(value.width) * Number(value.height) <= SENSOR_LIMITS.maxPixels;
}
function intrinsics(value: unknown, dimensions: ImageSize): boolean {
  if (value === null) return true;
  if (!object(value) || value.width !== dimensions.width || value.height !== dimensions.height) return false;
  return finite(value.fx, .001, 100000) && finite(value.fy, .001, 100000) && finite(value.cx, -100000, 100000) && finite(value.cy, -100000, 100000) &&
    Array.isArray(value.distortion) && value.distortion.length <= 14 && value.distortion.every(n => finite(n, -10000, 10000));
}
export function validateDevice(value: unknown): asserts value is SensorDevice {
  if (!object(value) || typeof value.id !== 'string' || !value.id || value.id.length > 128 || typeof value.label !== 'string' || value.label.length > 128 ||
    !['synthetic', 'kinect-v2', 'rgbd'].includes(String(value.kind)) || !size(value.color) || !size(value.depth) || !finite(value.depthScaleMeters, .000001, 1) ||
    !intrinsics(value.colorIntrinsics, value.color) || !intrinsics(value.depthIntrinsics, value.depth) ||
    !(value.depthToColor === null || Array.isArray(value.depthToColor) && value.depthToColor.length === 16 && value.depthToColor.every(n => finite(n, -10000, 10000)) &&
      value.depthToColor[12] === 0 && value.depthToColor[13] === 0 && value.depthToColor[14] === 0 && value.depthToColor[15] === 1)) {
    throw new Error('Invalid sensor dimensions, units or camera calibration.');
  }
}
export function validateFrame(frame: SensorFrame) {
  validateDevice(frame?.device);
  if (!Number.isSafeInteger(frame.sequence) || frame.sequence < 0 || !finite(frame.capturedAtMs, 0, 1e15) || !(frame.exposureMs === null || finite(frame.exposureMs, 0, 10000)) || !finite(frame.clockUncertaintyMs, 0, 60000) ||
    !(frame.color instanceof Uint8Array) || !(frame.depth instanceof Uint16Array) ||
    frame.color.length !== frame.device.color.width * frame.device.color.height * 3 || frame.depth.length !== frame.device.depth.width * frame.device.depth.height ||
    frameBytes(frame) > SENSOR_LIMITS.maxFrameBytes) throw new Error('Invalid RGB/depth frame.');
}
export function frameBytes(frame: SensorFrame) { return frame.color.byteLength + frame.depth.byteLength; }
export function copyFrame(frame: SensorFrame): SensorFrame { return { ...frame, device: structuredClone(frame.device), color: frame.color.slice(), depth: frame.depth.slice() }; }
export function sessionBytes(session: SensorSession) { return session.frames.reduce((sum, frame) => sum + frameBytes(frame), 0); }
export function canAppendFrame(frames: SensorFrame[], frame: SensorFrame) {
  return frames.length < SENSOR_LIMITS.maxFrames && frames.reduce((sum, f) => sum + frameBytes(f), 0) + frameBytes(frame) <= SENSOR_LIMITS.maxSessionBytes;
}

/** Portable binary envelope: 4 ASCII magic bytes, uint32 LE JSON length, JSON, payload. */
function envelope(magic: string, metadata: unknown, payloads: Uint8Array[]): Uint8Array {
  const json = textEncoder.encode(JSON.stringify(metadata));
  if (json.length > SENSOR_LIMITS.maxHeaderBytes) throw new Error('Recording metadata is too large.');
  const result = new Uint8Array(8 + json.length + payloads.reduce((n, p) => n + p.length, 0));
  result.set(textEncoder.encode(magic)); new DataView(result.buffer).setUint32(4, json.length, true); result.set(json, 8);
  let offset = 8 + json.length;
  for (const payload of payloads) { result.set(payload, offset); offset += payload.length; }
  return result;
}
function header(bytes: Uint8Array, magic: string) {
  if (bytes.length < 8 || textDecoder.decode(bytes.subarray(0, 4)) !== magic) throw new Error('This is not a Projection Mapper sensor file.');
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true);
  if (length > SENSOR_LIMITS.maxHeaderBytes || length > bytes.length - 8) throw new Error('Incomplete recording metadata.');
  const value: unknown = JSON.parse(textDecoder.decode(bytes.subarray(8, 8 + length)));
  if (!object(value)) throw new Error('Invalid recording metadata.');
  return { value, offset: 8 + length };
}
export function encodeSensorFrame(frame: SensorFrame): Uint8Array {
  validateFrame(frame);
  const { color, depth, ...meta } = frame;
  const depthBytes = new Uint8Array(depth.length * 2), view = new DataView(depthBytes.buffer);
  for (let i = 0; i < depth.length; i++) view.setUint16(i * 2, depth[i], true);
  return envelope('PMF1', meta, [color, depthBytes]);
}
export function decodeSensorFrame(bytes: Uint8Array): SensorFrame {
  if (bytes.length > SENSOR_LIMITS.maxFrameBytes + SENSOR_LIMITS.maxHeaderBytes) throw new Error('Sensor frame exceeds the size limit.');
  const { value, offset } = header(bytes, 'PMF1');
  validateDevice(value.device);
  const colorLength = value.device.color.width * value.device.color.height * 3, depthLength = value.device.depth.width * value.device.depth.height;
  if (bytes.length - offset !== colorLength + depthLength * 2) throw new Error('Incomplete or oversized sensor frame.');
  const depth = new Uint16Array(depthLength), view = new DataView(bytes.buffer, bytes.byteOffset + offset + colorLength, depthLength * 2);
  for (let i = 0; i < depthLength; i++) depth[i] = view.getUint16(i * 2, true);
  const result: SensorFrame = { device: value.device, sequence: value.sequence as number, capturedAtMs: value.capturedAtMs as number, exposureMs: value.exposureMs === undefined ? null : value.exposureMs as number | null, clockUncertaintyMs: value.clockUncertaintyMs as number,
    color: bytes.slice(offset, offset + colorLength), depth };
  validateFrame(result); return result;
}
export function validateSession(session: SensorSession) {
  if (!session || session.version !== 1 || typeof session.id !== 'string' || !session.id || session.id.length > 128 || typeof session.name !== 'string' || session.name.length > 160 ||
    !finite(session.createdAtMs, 0, 1e15) || !['recording', 'pattern-capture'].includes(session.kind) || !['synthetic', 'sensor'].includes(session.provenance) ||
    !['complete', 'cancelled', 'failed'].includes(session.status) || typeof session.message !== 'string' || session.message.length > 1000 ||
    !Array.isArray(session.frames) || !session.frames.length || session.frames.length > SENSOR_LIMITS.maxFrames || !Array.isArray(session.captures) ||
    !Array.isArray(session.plannedPatterns) || session.plannedPatterns.length > 64 || session.captures.length > session.frames.length) throw new Error('Invalid sensor session.');
  let bytes = 0;
  const clocks = new Map<string, { sequence: number; timestamp: number; device: string }>();
  for (const frame of session.frames) {
    validateFrame(frame); bytes += frameBytes(frame);
    const previous = clocks.get(frame.device.id), device = JSON.stringify(frame.device);
    if (previous && (frame.sequence <= previous.sequence || frame.capturedAtMs < previous.timestamp || device !== previous.device)) throw new Error('Recording frames must be ordered with a stable sensor mode.');
    if ((frame.device.kind === 'synthetic') !== (session.provenance === 'synthetic')) throw new Error('Recording source labels do not match its frames.');
    clocks.set(frame.device.id, { sequence: frame.sequence, timestamp: frame.capturedAtMs, device });
  }
  if (bytes > SENSOR_LIMITS.maxSessionBytes) throw new Error('Recording exceeds the memory limit.');
  const patterns = new Map<string, CalibrationPattern>();
  for (const p of session.plannedPatterns) { validatePattern(p); if (patterns.has(p.id)) throw new Error('Duplicate pattern identifier.'); patterns.set(p.id, p); }
  const seen = new Set<number>();
  for (const [captureIndex, c] of session.captures.entries()) {
    if (!c || !Number.isInteger(c.frameIndex) || c.frameIndex < 0 || c.frameIndex >= session.frames.length || seen.has(c.frameIndex)) throw new Error('Invalid captured frame association.');
    validatePattern(c.pattern); seen.add(c.frameIndex);
    const p = c.presentation;
    if (c.frameIndex !== captureIndex || session.plannedPatterns[captureIndex]?.id !== c.pattern.id || JSON.stringify(patterns.get(c.pattern.id)) !== JSON.stringify(c.pattern) || !p || p.patternId !== c.pattern.id || !finite(p.presentedAtMs, 0, 1e15) ||
      typeof p.outputId !== 'string' || p.outputId.length > 128 || !['synthetic', 'output-window'].includes(p.mode) || !p.viewport ||
      !finite(p.viewport.width, 1, 16384) || !finite(p.viewport.height, 1, 16384) || !finite(p.viewport.devicePixelRatio, .1, 8) ||
      !p.rasterRect || !finite(p.rasterRect.x, 0, p.viewport.width) || !finite(p.rasterRect.y, 0, p.viewport.height) ||
      !finite(p.rasterRect.width, 1, p.viewport.width) || !finite(p.rasterRect.height, 1, p.viewport.height) ||
      p.rasterRect.x + p.rasterRect.width > p.viewport.width + 1 || p.rasterRect.y + p.rasterRect.height > p.viewport.height + 1 ||
      !finite(c.settleMs, 0, 10000) || !finite(c.receivedAtMs, 0, 1e15)) throw new Error('Invalid pattern presentation metadata.');
    const frame = session.frames[c.frameIndex];
    if (session.provenance === 'sensor' && p.mode !== 'output-window' || frame.capturedAtMs - frame.clockUncertaintyMs - (frame.exposureMs ?? 0) / 2 < p.presentedAtMs + c.settleMs ||
      c.receivedAtMs < p.presentedAtMs + c.settleMs) throw new Error('A captured frame predates its settled pattern.');
  }
  if (session.kind === 'recording' && (session.captures.length || session.plannedPatterns.length) || session.kind === 'pattern-capture' &&
    (!session.plannedPatterns.length || session.captures.length !== session.frames.length || session.status === 'complete' && session.captures.length !== session.plannedPatterns.length)) {
    throw new Error('Incomplete pattern capture metadata.');
  }
}
export function encodeSensorSession(session: SensorSession): Uint8Array {
  validateSession(session);
  const { frames, ...metadata } = session;
  const payloads: Uint8Array[] = [];
  for (const frame of frames) {
    const encoded = encodeSensorFrame(frame), length = new Uint8Array(4);
    new DataView(length.buffer).setUint32(0, encoded.length, true); payloads.push(length, encoded);
  }
  return envelope('PMS1', { ...metadata, frameCount: frames.length }, payloads);
}
export function decodeSensorSession(bytes: Uint8Array): SensorSession {
  if (bytes.length > SENSOR_LIMITS.maxSessionBytes + 4 * SENSOR_LIMITS.maxHeaderBytes) throw new Error('Recording is too large to open.');
  const parsed = header(bytes, 'PMS1'), { frameCount, ...metadata } = parsed.value;
  if (!Number.isInteger(frameCount) || Number(frameCount) < 1 || Number(frameCount) > SENSOR_LIMITS.maxFrames) throw new Error('Invalid recording frame count.');
  const frames: SensorFrame[] = [];
  let offset = parsed.offset;
  for (let i = 0; i < Number(frameCount); i++) {
    if (offset + 4 > bytes.length) throw new Error('Recording ended before all frames were read.');
    const length = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true); offset += 4;
    if (length > bytes.length - offset) throw new Error('Recording contains an incomplete frame.');
    frames.push(decodeSensorFrame(bytes.subarray(offset, offset + length))); offset += length;
  }
  if (offset !== bytes.length) throw new Error('Recording has unexpected trailing data.');
  const session = { ...metadata, frames } as unknown as SensorSession;
  // Early synthetic recordings used a full virtual raster before explicit raster rectangles.
  if (Array.isArray(session.captures)) for (const capture of session.captures) {
    const p = capture?.presentation;
    if (p?.mode === 'synthetic' && !p.rasterRect && p.viewport) p.rasterRect = { x: 0, y: 0, width: p.viewport.width, height: p.viewport.height };
  }
  validateSession(session); return session;
}
