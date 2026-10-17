import { reduceScene, type Command, type Scene } from './domain.js';
import { isChatCommand } from './chat.js';
import { coverageRecords } from './spatial.js';
import { surfaceLayers } from './layers.js';
import type { ContentSpec } from './content.js';

/** Preflight everything against a private candidate. Publish exactly once, or not at all. */
export function reduceBatch(scene: Scene, commands: Command[], expectedRevision: number, now = Date.now()): Scene {
  if (expectedRevision !== scene.revision) throw new Error('The scene changed. Inspect it again before applying this arrangement.');
  if (!Array.isArray(commands) || !commands.length || commands.length > 160) throw new Error('Use 1–160 supported scene actions.');
  let next = scene;
  for (const command of commands) {
    if (!isChatCommand(command)) throw new Error('Unsupported scene action.');
    next = reduceScene(next, command, now);
  }
  next.revision = scene.revision + 1;
  if (next.geometryRevision !== scene.geometryRevision) {
    next.geometryRevision = scene.geometryRevision + 1; next.coverage = coverageRecords(next);
  }
  return next;
}
export interface Composition {
  id: string; name: string; updatedAt: number;
  surfaces: { id: string; width: number; height: number; boundary: unknown; holes: unknown }[];
  contents: Scene['contents']; timers: Scene['timers']; display: Scene['display'];
}
export function makeComposition(scene: Scene, name: string, id: string, now = Date.now()): Composition {
  if (typeof name !== 'string' || !name.trim() || name.length > 80) throw new Error('Give the composition a name of 1–80 characters.');
  return structuredClone({ id, name: name.trim(), updatedAt: now, surfaces: scene.surfaces.map(({ id, width, height, boundary, holes }) => ({ id, width, height, boundary, holes })), contents: scene.contents, timers: scene.timers, display: scene.display });
}
export function compositionCommands(scene: Scene, composition: Composition): Command[] {
  // An arrangement cannot silently transplant old calibration onto a different room.
  if (!composition || !Array.isArray(composition.contents) || !Array.isArray(composition.timers)) throw new Error('This composition is invalid.');
  const used = new Set([...composition.contents, ...composition.timers].map(c => c.surfaceId));
  for (const id of used) {
    const current = scene.surfaces.find(s => s.id === id), saved = composition.surfaces.find(s => s.id === id);
    if (!current || !saved || JSON.stringify([current.width, current.height, current.boundary, current.holes]) !== JSON.stringify([saved.width, saved.height, saved.boundary, saved.holes]))
      throw new Error('The surface shape changed. Rebuild this composition for the current room.');
  }
  const commands: Command[] = [...scene.timers.map(t => ({ type: 'timer.remove' as const, id: t.id })), ...scene.contents.map(c => ({ type: 'content.remove' as const, id: c.id }))];
  for (const item of composition.timers) commands.push({ type: 'timer.create', id: item.id, title: item.title, durationMs: item.durationMs, surfaceId: item.surfaceId }, { type: 'timer.move', id: item.id, bounds: item.bounds });
  for (const item of composition.contents) {
    const spec = { kind: item.kind, config: structuredClone(item.config) } as ContentSpec;
    if (spec.kind === 'media') spec.config.muted = true;
    commands.push({ type: 'content.create', id: item.id, title: item.title, surfaceId: item.surfaceId, spec });
    if (item.kind !== 'art') commands.push({ type: 'content.move', id: item.id, bounds: item.bounds });
    if (['art', 'game', 'media'].includes(item.kind)) commands.push({ type: 'content.action', id: item.id, action: 'pause' });
  }
  for (const surface of scene.surfaces) for (const item of surfaceLayers({ ...scene, contents: composition.contents, timers: composition.timers }, surface.id)) {
    if (!('kind' in item && item.kind === 'art')) commands.push({ type: 'layer.reorder', id: item.id, direction: 'front' });
    if (item.layer) { const { order: _, ...settings } = item.layer; commands.push({ type: 'layer.configure', id: item.id, settings }); }
  }
  if (composition.display) commands.push({ type: 'display.configure', settings: composition.display });
  return commands.length ? commands : [{ type: 'grid.set', visible: scene.showGrid }];
}
