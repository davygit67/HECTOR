import { patternValue, type CalibrationPattern } from './calibrationPatterns.js';
import type { SensorDevice, SensorFrame } from './sensor.js';

export const DEMO_SENSOR: SensorDevice = {
  id: 'demo-rgbd-1', label: 'Demo RGB + depth sensor', kind: 'synthetic',
  color: { width: 320, height: 180 }, depth: { width: 160, height: 90 }, depthScaleMeters: .001,
  colorIntrinsics: { width: 320, height: 180, fx: 250, fy: 250, cx: 160, cy: 90, distortion: [] },
  depthIntrinsics: { width: 160, height: 90, fx: 125, fy: 125, cx: 80, cy: 45, distortion: [] },
  depthToColor: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
};

/** Deterministic tilted plane, same camera for RGB/depth; virtual projector is 22 cm right. */
export function syntheticFrame(sequence: number, capturedAtMs: number, pattern: CalibrationPattern | null = null): SensorFrame {
  const device = DEMO_SENSOR, color = new Uint8Array(320 * 180 * 3), depth = new Uint16Array(160 * 90);
  for (let y = 0; y < 180; y++) for (let x = 0; x < 320; x++) {
    const rx = (x - 160) / 250, ry = (y - 90) / 250, z = 2.2 / (1 - .25 * rx);
    const px = pattern ? pattern.width * .9 * (rx - .22 / z) + pattern.width / 2 : 0;
    const py = pattern ? pattern.width * .9 * ry + pattern.height / 2 : 0;
    const lit = pattern ? patternValue(pattern, Math.floor(px), Math.floor(py)) : null;
    const index = (y * 320 + x) * 3;
    if (lit !== null) { const value = Math.round(12 + lit * .9); color[index] = value; color[index + 1] = value; color[index + 2] = value; }
    else {
      const tile = ((Math.floor(x / 40) + Math.floor(y / 30)) % 2) * 18;
      color[index] = 36 + tile + Math.round(x / 5); color[index + 1] = 68 + tile + Math.round(y / 4); color[index + 2] = 92 + tile;
      if ((x - (40 + sequence % 240)) ** 2 + (y - 90) ** 2 < 90) { color[index] = 211; color[index + 1] = 225; color[index + 2] = 160; }
    }
  }
  for (let y = 0; y < 90; y++) for (let x = 0; x < 160; x++) {
    depth[y * 160 + x] = x < 3 || y < 3 ? 0 : Math.round(2200 / (1 - .25 * ((x - 80) / 125)));
  }
  return { device, sequence, capturedAtMs, exposureMs: 0, clockUncertaintyMs: 0, color, depth };
}
