import type { Command, Scene } from './domain.js';
import type { HardwareStatus } from './studio.js';

/** Last-moment application guard. This cannot observe optical changes in the projector. */
export function assertPhysicalFill(scene: Scene, command: Command, hardware?: HardwareStatus) {
  if (command.type !== 'surface.fill' || command.color === null) return;
  const surface = scene.surfaces.find(s => s.id === command.id), measurement = surface?.measurement;
  if (measurement?.source !== 'sensor') return;
  const room = hardware?.roomModel;
  if (!hardware || hardware.provenance !== 'sensor' || hardware.mode !== 'live' || !hardware.canAcquire || hardware.busy ||
      room?.state !== 'ready' || !room.canMap || !measurement.roomReferenceId || room.referenceId !== measurement.roomReferenceId ||
      hardware.sensorId !== measurement.sensorId || room.sensorId !== measurement.sensorId || !hardware.validSurfaceIds?.includes(surface!.id)) {
    throw new Error('Fresh room and projector verification is required before coloring this physical surface. Open Hardware, capture the room and calibrate if needed. Existing content is retained.');
  }
}
