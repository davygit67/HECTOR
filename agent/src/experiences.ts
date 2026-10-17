import { createHash } from 'node:crypto';
import { tool } from 'ai';
import { z } from 'zod';
import { reduceScene, type Command, type Scene } from '../../src/shared/domain.js';
import type { ContentSpec } from '../../src/shared/content.js';
import type { StudioPort } from '../../src/shared/studio.js';
import type { SceneToolHost } from './scene-tools.js';

export const EXPERIENCES = [
  { id: 'underwater', name: 'Underwater room', description: 'Slow lagoon fish on the main surface, optional gentle lagoon aurora on a second surface. Uses implemented animations; no generated video.' },
  { id: 'ambient-art', name: 'Quiet gallery', description: 'Slow violet aurora with optional lagoon stars on another surface. Preserves foreground panels.' },
  { id: 'cinema', name: 'Immersive cinema', description: 'An existing YouTube source with smooth cinema light filling the room. Preserves video, placement and playback; requires an existing source.' },
  { id: 'music', name: 'Music room', description: 'An existing YouTube source with richer room-filling light. Pixel-driven color, not beat detection. Search/place music first if no source exists; playback stays deliberate.' },
  { id: 'cooking', name: 'Cooking station', description: 'A readable tabletop cooking checklist beside existing timers/recipes. Does not invent a recipe or start a timer without a requested duration.' },
  { id: 'tabletop-game', name: 'Tabletop target game', description: 'A ready, paused 10-round pointer reaction game. No Kinect touch/body tracking is implied.' },
] as const;
export type ExperienceId = typeof EXPERIENCES[number]['id'];
export interface ExperienceRequest { experience: ExperienceId; primarySurfaceId: string; secondarySurfaceId: string | null; sourceContentId: string | null }

/** A recipe compiles to canonical operations, never pixels, a second renderer, or speculative assets. */
export function experienceCommands(scene: Scene, input: ExperienceRequest, seed: string): Command[] {
  const commands: Command[] = [];
  const surface = (id: string) => { if (!scene.surfaces.some(s => s.id === id)) throw new Error('Choose an existing surface.'); return id; };
  surface(input.primarySurfaceId);
  if (input.secondarySurfaceId) surface(input.secondarySurfaceId);
  const makeId = (role: string) => `experience-${createHash('sha256').update(`${seed}:${role}`).digest('hex').slice(0, 24)}`;
  const addArt = (surfaceId: string, preset: 'fish' | 'aurora' | 'stars', palette: 'lagoon' | 'violet', speed: number) => {
    const existing = scene.contents.find(c => c.surfaceId === surfaceId && c.kind === 'art');
    const spec: ContentSpec = { kind: 'art', config: { preset, palette, speed, seed: existing?.kind === 'art' ? existing.config.seed : 42 } };
    commands.push(existing ? { type: 'content.update', id: existing.id, spec } : { type: 'content.create', id: makeId(surfaceId), surfaceId, title: preset === 'fish' ? 'Underwater' : 'Quiet gallery', spec });
  };
  if (input.experience === 'underwater' || input.experience === 'ambient-art') {
    addArt(input.primarySurfaceId, input.experience === 'underwater' ? 'fish' : 'aurora', input.experience === 'underwater' ? 'lagoon' : 'violet', .4);
    if (input.secondarySurfaceId && input.secondarySurfaceId !== input.primarySurfaceId) addArt(input.secondarySurfaceId, input.experience === 'underwater' ? 'aurora' : 'stars', 'lagoon', .25);
  } else if (input.experience === 'cinema' || input.experience === 'music') {
    const candidates = scene.contents.filter(c => c.kind === 'youtube' && c.surfaceId === input.primarySurfaceId);
    const source = input.sourceContentId ? scene.contents.find(c => c.id === input.sourceContentId && c.kind === 'youtube') : candidates.length === 1 ? candidates[0] : undefined;
    if (!source) throw new Error('Choose one existing YouTube source, or search and place the requested video first.');
    commands.push({ type: 'youtube.backlight.configure', id: source.id, enabled: true, settings: {
      toneProfile: input.experience === 'cinema' ? 'cinema' : 'vivid', roomFill: 1, opacity: .9, vibrance: input.experience === 'cinema' ? 1 : 1.25,
      intensity: 1, smoothingMs: 280, spread: .25,
    } });
  } else if (input.experience === 'cooking') {
    const existing = scene.contents.find(c => c.kind === 'note' && c.surfaceId === input.primarySurfaceId && c.title === 'Cooking station');
    const spec: ContentSpec = { kind: 'note', config: { text: 'Cooking station\n1. Choose your recipe\n2. Gather ingredients\n3. Ask me to start a timer when needed', accent: '#e6d9ad' } };
    commands.push(existing ? { type: 'content.update', id: existing.id, spec } : { type: 'content.create', id: makeId('note'), surfaceId: input.primarySurfaceId, title: 'Cooking station', spec });
  } else {
    const existing = scene.contents.find(c => c.kind === 'game' && c.surfaceId === input.primarySurfaceId);
    if (existing) throw new Error('A game already exists there. Use its controls; replacing rules would discard its progress.');
    commands.push({ type: 'content.create', id: makeId('game'), surfaceId: input.primarySurfaceId, title: 'Tabletop targets', spec: { kind: 'game', config: { rounds: 10, seed: 42 } } });
  }
  // Same reducer as UI: reject capacity/domain failures before any mutation.
  let preview = scene;
  for (const command of commands) preview = reduceScene(preview, command);
  return commands;
}
export function createExperienceTools(host: SceneToolHost, studio: StudioPort | undefined, report: (message: string) => void) {
  return {
    list_experiences: tool({ description: 'Read adaptable built-in scene recipes and their real capabilities. To keep a custom result, use composition.save. Apply only a requested experience; preserve unrelated user content.', strict: true,
      inputSchema: z.strictObject({}), execute: async () => ({ experiences: EXPERIENCES, canApplyAtomically: !!studio }) }),
    ...(studio ? { apply_experience: tool({
      description: 'Apply a requested experience atomically using existing surface/content handles. Reuses art backgrounds and preserves foregrounds/calibration/playback. Fails without partial edits if capacity or scene revision changed. Cinema/music require a grounded existing YouTube player. Cooking creates a checklist, not a recipe. Observe the result, then use normal tools to adapt it to the user’s preferences.',
      strict: true, inputSchema: z.strictObject({ experience: z.enum(['underwater', 'ambient-art', 'cinema', 'music', 'cooking', 'tabletop-game']),
        primarySurfaceId: z.string().min(1).max(100), secondarySurfaceId: z.string().min(1).max(100).nullable(), sourceContentId: z.string().min(1).max(100).nullable() }),
      execute: (input, options) => host.once('apply_experience', input, options, async () => {
        try {
          const scene = (await host.canvas.getSnapshot()).scene;
          const commands = experienceCommands(scene, input, options.toolCallId);
          const result = await studio.execute({ type: 'scene.batch', commands, expectedRevision: scene.revision });
          report(result.ok ? `Applied ${EXPERIENCES.find(e => e.id === input.experience)!.name}. ${result.message}` : `Could not apply experience: ${result.message}`);
          return { ...result, commandsApplied: result.ok ? commands.length : 0, physicalOutputVerified: false };
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Experience could not be applied.';
          report(`Could not apply experience: ${message}`); return { ok: false, error: message };
        }
      }),
    }) } : {}),
  };
}
