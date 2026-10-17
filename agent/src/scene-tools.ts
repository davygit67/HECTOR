import { tool, type ToolExecutionOptions } from 'ai';
import { z } from 'zod';
import type { Command, Scene } from '../../src/shared/domain.js';
import type { CommandReceipt } from '../../src/shared/bridge.js';
import type { CanvasPort } from './canvas.js';
import { presentationContext } from './presentation.js';

const id = z.string().min(1).max(100);
const point = z.strictObject({ x: z.number().finite(), y: z.number().finite() });
const vector = z.array(z.number().finite()).length(3);
const bounds = z.strictObject({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().positive().max(1), h: z.number().positive().max(1) });
const patch = z.union([
  z.strictObject({ type: z.enum(['timer.move', 'content.move']), id, bounds }),
  z.strictObject({ type: z.enum(['timer.select', 'content.select', 'surface.select']), id }),
  z.strictObject({ type: z.literal('timer.update'), id, title: z.string().min(1).max(60).nullable(), durationMs: z.number().int().min(1000).max(86400000).nullable() }),
  z.strictObject({ type: z.literal('layer.configure'), id, settings: z.strictObject({ visible: z.boolean().nullable(), locked: z.boolean().nullable(), opacity: z.number().min(0).max(1).nullable() }) }),
  z.strictObject({ type: z.literal('layer.reorder'), id, direction: z.enum(['up', 'down', 'front', 'back']) }),
  z.strictObject({ type: z.literal('display.configure'), settings: z.strictObject({ quality: z.enum(['fast', 'balanced', 'sharp']).nullable(), brightness: z.number().min(0).max(2).nullable(), blackout: z.boolean().nullable() }) }),
  z.strictObject({ type: z.literal('media.seek'), id, seconds: z.number().min(0).max(86400) }),
  z.strictObject({ type: z.literal('calibration.set'), quad: z.array(point).length(4) }),
  z.strictObject({ type: z.literal('calibration.reset') }),
  z.strictObject({ type: z.literal('manual.target'), surfaceId: id }),
  z.strictObject({ type: z.literal('output.view'), view: z.enum(['manual', 'projector-a', 'projector-b']) }),
  z.strictObject({ type: z.literal('surface.move'), id, origin: vector }),
  z.strictObject({ type: z.literal('surface.demo-exclusion'), id, enabled: z.literal(false) }),
  z.strictObject({ type: z.literal('projector.update'), id, position: vector.nullable(), target: vector.nullable(), enabled: z.boolean().nullable() }),
  z.strictObject({ type: z.literal('viewer.update'), position: vector }),
]);
const mediaSettings = z.strictObject({
  fit: z.enum(['contain', 'cover', 'stretch']).nullable(), loop: z.boolean().nullable(), playbackRate: z.number().min(.25).max(4).nullable(),
  volume: z.number().min(0).max(1).nullable(), muted: z.boolean().nullable(), rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).nullable(),
  flipX: z.boolean().nullable(), flipY: z.boolean().nullable(), brightness: z.number().min(0).max(2).nullable(), contrast: z.number().min(0).max(2).nullable(), saturation: z.number().min(0).max(3).nullable(),
});
function omitNull(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(omitNull);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null).map(([k, v]) => [k, omitNull(v)]));
  return value;
}
export interface SceneToolHost {
  canvas: CanvasPort;
  dispatch(command: Command): Promise<CommandReceipt>;
  once<T>(name: string, input: unknown, options: ToolExecutionOptions<unknown>, action: () => Promise<T>): Promise<T>;
}
function receipt(received: CommandReceipt, itemId?: string) {
  if (!received.ok) return received;
  const s = received.scene;
  const item = [...s.contents, ...s.timers].find(i => i.id === itemId);
  return { ok: true, revision: s.revision, geometryRevision: s.geometryRevision,
    ...(item ? { item, presentation: presentationContext(s, item) } : { display: s.display, manualOutput: s.manualOutput, outputView: s.outputView,
      selectedSurfaceId: s.selectedSurfaceId }), physicallyVerified: false };
}
export function createSceneTools(host: SceneToolHost) {
  return {
    edit_scene: tool({
      description: 'Use the same scene controls as the interface: exact normalized panel move/resize, selection, timer settings, layer visibility/lock/opacity/order, display/blackout, local-video seek, manual corners/target, simulated surface/projector/viewer pose. Null patch values preserve current settings. Inspect first. Calibration/geometry edits require the user’s setup intent, never change them to improve an ordinary composition. Coordinates are accepted only through the canonical surface constraints. Does not prove physical alignment.',
      strict: true, inputSchema: z.strictObject({ command: patch }),
      execute: (input, options) => host.once('edit_scene', input, options, async () => {
        const command = omitNull(input.command) as Command;
        return receipt(await host.dispatch(command), 'id' in command ? command.id : undefined);
      }),
    }),
    arrange_panel: tool({
      description: 'Place or resize an existing timer/content with a semantic anchor in its own surface. Width/height are normalized fractions; null preserves size. Native boundaries/exclusions and layer locks still apply. Returns actual accepted bounds, which may differ to fit the calibrated domain. Art remains a full-surface background.',
      strict: true, inputSchema: z.strictObject({ id, anchor: z.enum(['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right']),
        width: z.number().positive().max(1).nullable(), height: z.number().positive().max(1).nullable(), margin: z.number().min(0).max(.2) }),
      execute: (input, options) => host.once('arrange_panel', input, options, async () => {
        const s: Scene = (await host.canvas.getSnapshot()).scene;
        const timer = s.timers.find(i => i.id === input.id); const item = timer ?? s.contents.find(i => i.id === input.id);
        if (!item) return { ok: false, error: 'That panel no longer exists.' };
        const w = input.width ?? item.bounds.w, h = input.height ?? item.bounds.h;
        const x = input.anchor.includes('left') ? input.margin : input.anchor.includes('right') ? 1 - w - input.margin : (1 - w) / 2;
        const y = input.anchor.startsWith('top') ? input.margin : input.anchor.startsWith('bottom') ? 1 - h - input.margin : (1 - h) / 2;
        return receipt(await host.dispatch({ type: timer ? 'timer.move' : 'content.move', id: item.id, bounds: { x, y, w, h } }), item.id);
      }),
    }),
    configure_media: tool({
      description: 'Adjust an existing imported image/video with the same fit, loop, speed, sound, rotation, flip and color controls as its inspector. Null leaves a field unchanged. Preserves source identity, panel bounds, playback position and running/paused state. Does not import/replace a file.',
      strict: true, inputSchema: z.strictObject({ id, settings: mediaSettings }),
      execute: (input, options) => host.once('configure_media', input, options, async () => {
        const item = (await host.canvas.getSnapshot()).scene.contents.find(c => c.id === input.id);
        if (item?.kind !== 'media') return { ok: false, error: 'Choose an existing imported image or video.' };
        return receipt(await host.dispatch({ type: 'content.update', id: item.id, spec: { kind: 'media', config: { ...item.config, ...omitNull(input.settings) as object } } }), item.id);
      }),
    }),
  };
}
