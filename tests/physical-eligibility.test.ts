import test from 'node:test';
import assert from 'node:assert/strict';
import { initialScene, reduceScene } from '../src/shared/domain.js';
import { assertPhysicalFill } from '../src/shared/physicalEligibility.js';
import type { HardwareStatus } from '../src/shared/studio.js';
import { measuredRoomFixture } from './fixtures/measured-room.js';
import { solveRoomSurfaces } from '../src/shared/roomSolve.js';

test('physical mutation guard rechecks fresh room, sensor identity, reference and projector eligibility; clearing stays available', () => {
  const surface = solveRoomSurfaces(measuredRoomFixture()).candidates[0].surface;
  surface.provenance = 'measured'; surface.measurement!.source = 'sensor'; surface.measurement!.roomReferenceId = 'r';
  const scene = reduceScene(initialScene(), { type: 'surface.measure', surface });
  const command = { type: 'surface.fill' as const, id: surface.id, color: '#ff0000' };
  const status: HardwareStatus = { initialized: true, mode: 'live', connection: 'connected', message: '', provenance: 'sensor', busy: false, canAcquire: true,
    frames: 0, recording: false, capturing: false, sessions: [], geometrySolved: true, sensorId: surface.measurement!.sensorId, validSurfaceIds: [surface.id],
    roomModel: { state: 'ready', message: '', referenceId: 'r', sensorId: surface.measurement!.sensorId, points: 1000, frames: 12, floorAligned: true, canMap: true } };
  assert.doesNotThrow(() => assertPhysicalFill(scene, command, status));
  for (const patch of [{ busy: true }, { canAcquire: false }, { validSurfaceIds: [] }, { sensorId: 'other' }, { roomModel: { ...status.roomModel!, state: 'stale' as const, canMap: false } }, { roomModel: { ...status.roomModel!, referenceId: 'new-reference' } }]) assert.throws(() => assertPhysicalFill(scene, command, { ...status, ...patch }), /Fresh room/);
  assert.throws(() => assertPhysicalFill(scene, command), /Fresh room/);
  assert.doesNotThrow(() => assertPhysicalFill(scene, { ...command, color: null }));
  assert.doesNotThrow(() => assertPhysicalFill(initialScene(), command));
});
