import { patternSequence, patternValue } from '../../src/shared/calibrationPatterns.js';
import type { SensorSession, SensorFrame } from '../../src/shared/sensor.js';

/** Generated analytic test rig; never represents captured hardware evidence. */
export function measuredRoomFixture({ floor = true, clutter = true } = {}): SensorSession {
  const width = 96, height = 72, patterns = patternSequence(640, 360);
  const session: SensorSession = { version: 1, id: 'analytic-room-fixture', name: 'Analytic test only', createdAtMs: 1000,
    kind: 'pattern-capture', provenance: 'synthetic', status: 'complete', message: '', frames: [], captures: [], plannedPatterns: patterns };
  for (let f = 0; f < patterns.length; f++) {
    const color = new Uint8Array(width * height * 3), depth = new Uint16Array(width * height), cameraPoints = new Float32Array(width * height * 3);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (x < 5 || x >= width - 5 || y < 5 || y >= height - 5) continue;
      const i = y * width + x, z = clutter && x > 38 && x < 51 && y > 29 && y < 42 ? 1.6 : 2;
      const u = x / width, v = y / height;
      depth[i] = z * 1000; cameraPoints.set([(.5 - u) * 1.6, (.5 - v) * 1.2, z], i * 3);
      const px = (.12 + .7 * u + .05 * v) / (1 + .1 * u + .1 * v), py = (.1 + .01 * u + .75 * v) / (1 + .1 * u + .1 * v);
      const value = 15 + .85 * patternValue(patterns[f], px * 640, py * 360);
      color.fill(Math.round(value), i * 3, i * 3 + 3);
    }
    const frame: SensorFrame = { sequence: f, capturedAtMs: 2000 + f * 1000, exposureMs: 0, clockUncertaintyMs: 0, color, depth, cameraPoints,
      ...(floor ? { floorPlane: [0, 0, -1, 2.8] as [number, number, number, number] } : {}),
      device: { id: 'analytic-registered-camera', label: 'Generated calibration test', kind: 'synthetic', color: { width, height }, depth: { width, height },
        depthScaleMeters: .001, colorRegistration: 'depth', depthIntrinsics: null, colorIntrinsics: null, depthToColor: null } };
    session.frames.push(frame); session.captures.push({ frameIndex: f, pattern: patterns[f], settleMs: 750, receivedAtMs: frame.capturedAtMs,
      presentation: { patternId: patterns[f].id, presentedAtMs: frame.capturedAtMs - 900, outputId: 'analytic-projector', mode: 'synthetic', viewport: { width: 1920, height: 1080, devicePixelRatio: 1 }, rasterRect: { x: 0, y: 0, width: 1920, height: 1080 } } });
  }
  return session;
}
