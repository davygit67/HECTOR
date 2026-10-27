import { z } from 'zod';

const number = z.number().finite();
export const idSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const point = z.tuple([number.min(-2).max(3), number.min(-2).max(3)]);
export const sourceSchema = z.object({
  id: idSchema, name: z.string().min(1).max(160), kind: z.enum(['image', 'video', 'gradient', 'grid', 'clock']),
  assetId: idSchema.optional(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  loop: z.boolean(), speed: number.min(0.1).max(4), volume: number.min(0).max(1)
}).strict();
const surfaceFields = z.object({
  id: idSchema, name: z.string().min(1).max(160), sourceId: idSchema.nullable(),
  corners: z.tuple([point, point, point, point]), visible: z.boolean(), locked: z.boolean(),
  opacity: number.min(0).max(1), brightness: number.min(0).max(2), saturation: number.min(0).max(2),
  crop: z.tuple([number.min(0).max(0.95), number.min(0).max(0.95), number.min(0).max(0.95), number.min(0).max(0.95)]),
  mask: z.enum(['none', 'ellipse']), group: z.string().max(80)
}).strict();
export const surfaceSchema = surfaceFields.superRefine((s, ctx) => {
  if (s.crop[0] + s.crop[2] >= 0.99 || s.crop[1] + s.crop[3] >= 0.99) ctx.addIssue({ code: 'custom', message: 'Crop must leave a visible image.' });
  const crosses = s.corners.map((a, i) => {
    const b = s.corners[(i + 1) % 4], c = s.corners[(i + 2) % 4];
    return (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
  });
  if (!crosses.every(c => c > 0.00001)) ctx.addIssue({ code: 'custom', message: 'Corners must form a clockwise convex quadrilateral.' });
});
export const sceneSchema = z.object({
  version: z.literal(1), name: z.string().min(1).max(160),
  width: z.number().int().min(320).max(8192), height: z.number().int().min(240).max(8192),
  sources: z.array(sourceSchema).max(64), surfaces: z.array(surfaceSchema).max(128)
}).strict().superRefine((s, ctx) => {
  for (const list of [s.sources, s.surfaces]) if (new Set(list.map(x => x.id)).size !== list.length) ctx.addIssue({ code: 'custom', message: 'Duplicate IDs.' });
  for (const surface of s.surfaces) if (surface.sourceId && !s.sources.some(x => x.id === surface.sourceId)) ctx.addIssue({ code: 'custom', message: 'Unknown source.' });
  for (const source of s.sources) if (['image', 'video'].includes(source.kind) && !source.assetId) ctx.addIssue({ code: 'custom', message: 'Local media requires an asset.' });
});
export type Scene = z.infer<typeof sceneSchema>;
export type Source = z.infer<typeof sourceSchema>;
export type Surface = z.infer<typeof surfaceSchema>;
export type Point = [number, number];
export const commandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('surface.add'), surface: surfaceSchema }).strict(),
  z.object({ type: z.literal('surface.update'), id: idSchema, patch: surfaceFields.partial().omit({ id: true }) }).strict(),
  z.object({ type: z.literal('surface.remove'), id: idSchema }).strict(),
  z.object({ type: z.literal('surface.move'), id: idSchema, direction: z.union([z.literal(-1), z.literal(1)]) }).strict(),
  z.object({ type: z.literal('source.put'), source: sourceSchema }).strict(),
  z.object({ type: z.literal('source.remove'), id: idSchema }).strict(),
  z.object({ type: z.literal('scene.rename'), name: z.string().min(1).max(160) }).strict()
]);
export type Command = z.infer<typeof commandSchema>;
export function initialScene(): Scene {
  return { version: 1, name: 'Untitled setup', width: 1920, height: 1080,
    sources: [{ id: 'aurora', name: 'Aurora gradient', kind: 'gradient', color: '#8f72ff', loop: true, speed: 1, volume: 0 }],
    surfaces: [newSurface('surface-1', 'Surface 01', 'aurora')] };
}
export function newSurface(id: string, name: string, sourceId: string | null): Surface {
  return { id, name, sourceId, corners: [[0.15, 0.15], [0.85, 0.15], [0.85, 0.85], [0.15, 0.85]], visible: true, locked: false,
    opacity: 1, brightness: 1, saturation: 1, crop: [0, 0, 0, 0], mask: 'none', group: '' };
}
export function reduceScene(scene: Scene, raw: unknown): Scene {
  const command = commandSchema.parse(raw), next = structuredClone(scene);
  const surface = 'id' in command ? next.surfaces.find(s => s.id === command.id) : undefined;
  if (command.type.startsWith('surface.') && command.type !== 'surface.add' && !surface) throw new Error('Surface no longer exists.');
  switch (command.type) {
    case 'surface.add': next.surfaces.push(command.surface); break;
    case 'surface.update':
      if (surface!.locked && Object.keys(command.patch).some(k => k !== 'locked')) throw new Error('Unlock the surface before editing.');
      Object.assign(surface!, command.patch); break;
    case 'surface.remove':
      if (surface!.locked) throw new Error('Unlock the surface before deleting.');
      next.surfaces = next.surfaces.filter(s => s.id !== command.id); break;
    case 'surface.move': {
      if (surface!.locked) throw new Error('Unlock the surface before reordering.');
      const from = next.surfaces.indexOf(surface!), to = Math.max(0, Math.min(next.surfaces.length - 1, from + command.direction));
      next.surfaces.splice(from, 1); next.surfaces.splice(to, 0, surface!); break;
    }
    case 'source.put': {
      const i = next.sources.findIndex(s => s.id === command.source.id);
      if (i < 0) next.sources.push(command.source); else next.sources[i] = command.source;
      break;
    }
    case 'source.remove': next.sources = next.sources.filter(s => s.id !== command.id); next.surfaces.forEach(s => { if (s.sourceId === command.id) s.sourceId = null; }); break;
    case 'scene.rename': next.name = command.name; break;
  }
  return sceneSchema.parse(next);
}
export const equal = (a: Scene, b: Scene) => JSON.stringify(a) === JSON.stringify(b);
