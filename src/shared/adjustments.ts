import type { Command, Scene } from './domain.js';
import type { AdjustmentEvent } from './studio.js';

function detail(scene: Scene, command: Command): unknown {
  if ('id' in command) return scene.contents.find(c => c.id === command.id) ?? scene.timers.find(c => c.id === command.id)
    ?? scene.surfaces.find(c => c.id === command.id) ?? scene.projectors.find(c => c.id === command.id) ?? null;
  if (command.type.startsWith('calibration.') || command.type === 'manual.target') return scene.manualOutput;
  if (command.type === 'display.configure') return scene.display ?? null;
  if (command.type === 'viewer.update') return scene.viewer;
  if (command.type === 'grid.set') return scene.showGrid;
  if (command.type === 'output.view') return scene.outputView;
  return null;
}
export function adjustmentFor(command: Command, before: Scene, after: Scene, roomId: string, id: string, at = Date.now()): AdjustmentEvent | null {
  if (command.type.endsWith('.select') || command.type === 'game.hit' || command.type === 'effect.set') return null;
  const previous = detail(before, command), next = detail(after, command);
  if (JSON.stringify(previous) === JSON.stringify(next)) return null;
  const targetId = 'id' in command ? command.id : undefined;
  const target = [...after.contents, ...after.timers, ...before.contents, ...before.timers].find(c => c.id === targetId);
  const event: AdjustmentEvent = { id, actor: 'user', roomId, revision: after.revision, geometryRevision: after.geometryRevision, at,
    operation: command.type, targetId, surfaceId: target?.surfaceId ?? ('surfaceId' in command ? command.surfaceId : undefined), before: previous, after: next };
  return JSON.stringify(event).length <= 24000 ? event : null;
}
/** Sliders may commit on change. Keep the first before-state and the final accepted after-state. */
export function mergeAdjustment(previous: AdjustmentEvent, next: AdjustmentEvent): AdjustmentEvent {
  return { ...next, id: previous.id, before: previous.before };
}
