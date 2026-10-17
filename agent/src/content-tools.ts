import { createHash } from 'node:crypto';
import { tool, type ToolExecutionOptions } from 'ai';
import { z } from 'zod';
import { ART_PRESETS, CONTENT_LIMITS as limits, CONTENT_REGISTRY, type ContentAction, type ContentSpec, type ContentInstance } from '../../src/shared/content.js';
import type { CommandReceipt } from '../../src/shared/bridge.js';
import type { Command } from '../../src/shared/domain.js';
import { parseYouTubeInput, YOUTUBE_ID, YOUTUBE_LIMITS } from '../../src/shared/youtube.js';
import { BACKLIGHT_DEFAULTS, BACKLIGHT_LIMITS, BACKLIGHT_TONE_PROFILES, type BacklightSettings } from '../../src/shared/backlight.js';
import { presentationContext } from './presentation.js';

interface ContentToolHost {
  turnId: string;
  surfaceId: z.ZodType<string>;
  dispatch(command: Command): Promise<CommandReceipt>;
  recordFailure(error: string): void;
  allowVideo?: (videoId: string) => boolean;
  getContents(): Promise<readonly ContentInstance[]>;
  once<T>(name: string, input: unknown, options: ToolExecutionOptions<unknown>, action: () => Promise<T>): Promise<T>;
}

const title = z.string().trim().min(1).max(limits.titleLength).describe('Display label only. A title does not add visual subjects, animation behavior or other capabilities.');
const contentId = z.string().min(1).max(limits.idLength).describe('Existing content ID from ROOM_DATA or a successful creation receipt.');
const nonempty = (max: number) => z.string().trim().min(1).max(max);
const noteConfig = z.strictObject({ text: nonempty(limits.noteLength), accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).describe('Six-digit hex color.') });
const recipeConfig = z.strictObject({
  ingredients: z.array(nonempty(limits.ingredientLength)).min(1).max(limits.recipeItems),
  steps: z.array(nonempty(limits.stepLength)).min(1).max(limits.recipeItems),
  source: z.string().max(limits.sourceLength).describe('Preserve a source supplied by the user, use AI-generated draft for a model-authored recipe, or leave empty. Never invent a retrieved source.'),
});
const artConfig = z.strictObject({
  preset: z.enum(limits.presets), palette: z.enum(limits.palettes),
  speed: z.number().min(limits.speed.min).max(limits.speed.max),
  seed: z.number().int().min(limits.seed.min).max(limits.seed.max),
});
const gameConfig = z.strictObject({
  rounds: z.number().int().min(limits.rounds.min).max(limits.rounds.max),
  seed: z.number().int().min(limits.seed.min).max(limits.seed.max),
});
const toneProfile = z.enum(BACKLIGHT_TONE_PROFILES).describe('cinema: balanced immersive light with restrained highlights; vivid: richer color; soft: gentler, subdued light; neutral: faithful source colors. This selects local adaptive tone mapping, not AI inference on each frame.');
const opacity = z.number().min(BACKLIGHT_LIMITS.opacity.min).max(BACKLIGHT_LIMITS.opacity.max).describe('Glow opacity: 0 is invisible, 1 is full strength. Separate from brightness. Convert a requested percentage to this fraction.');
const vibrance = z.number().min(BACKLIGHT_LIMITS.vibrance.min).max(BACKLIGHT_LIMITS.vibrance.max).describe('Color strength: 0 is grayscale, 1 retains the tone profile color, 2 boosts color. Convert a requested percentage to this multiplier.');
const roomFill = z.number().min(BACKLIGHT_LIMITS.roomFill.min).max(BACKLIGHT_LIMITS.roomFill.max).describe('Continuous room fill: 0 is a normal local backlight, 1 extends light across all room surfaces including wall and table. Intermediate values progressively expand the light. The renderer excludes timers and foreground panels including videos. No extra assets or placement changes. Convert a requested percentage to this fraction.');
const backlightSettings = z.strictObject({
  intensity: z.number().min(BACKLIGHT_LIMITS.intensity.min).max(BACKLIGHT_LIMITS.intensity.max).describe('Brightness multiplier; 1 is 100%.'),
  spread: z.number().min(BACKLIGHT_LIMITS.spread.min).max(BACKLIGHT_LIMITS.spread.max).describe('Glow spread in the runtime normalized units; higher reaches farther.'),
  smoothingMs: z.number().int().min(BACKLIGHT_LIMITS.smoothingMs.min).max(BACKLIGHT_LIMITS.smoothingMs.max).describe('Transition smoothing in milliseconds; lower reacts faster, higher changes more gently.'),
  toneProfile: toneProfile.nullable().describe('Retain the existing profile on full video replacement. null omits the profile for legacy/default settings (cinema).'),
  opacity: opacity.nullable().describe('Preserve on full video replacement; null omits the legacy/default field (1).'),
  vibrance: vibrance.nullable().describe('Preserve on full video replacement; null omits the legacy/default field (1).'),
  roomFill: roomFill.nullable().describe('Preserve on full video replacement; null omits the legacy/default field (0).'),
});
const youtubeConfig = z.strictObject({
  videoId: z.string().regex(YOUTUBE_ID).describe('Exact video ID from a user-supplied YouTube link, never an invented ID.'),
  startSeconds: z.number().int().min(0).max(YOUTUBE_LIMITS.maxStartSeconds),
  backlight: z.boolean(),
  backlightSettings: backlightSettings.nullable().describe('Preserve existing settings on replacement. null uses runtime defaults for an uncustomized/legacy player.'),
});
// Plain union emits nested anyOf, supported by OpenAI strict tool schemas.
// Literal kind fields still make each configuration branch unambiguous.
const spec = z.union([
  z.strictObject({ kind: z.literal('note'), config: noteConfig }),
  z.strictObject({ kind: z.literal('recipe'), config: recipeConfig }),
  z.strictObject({ kind: z.literal('art'), config: artConfig }),
  z.strictObject({ kind: z.literal('game'), config: gameConfig }),
  z.strictObject({ kind: z.literal('youtube'), config: youtubeConfig }),
]);
const actionIds = [...new Set(CONTENT_REGISTRY.flatMap(item => [...item.actions]))];
const actionSchema = z.enum(actionIds as [ContentAction, ...ContentAction[]]);

function canvasSpec(value: z.infer<typeof spec>): ContentSpec {
  if (value.kind !== 'youtube') return value;
  const { backlightSettings, ...config } = value.config;
  if (backlightSettings === null) return { kind: 'youtube', config };
  const { toneProfile, opacity, vibrance, roomFill, ...numeric } = backlightSettings;
  return { kind: 'youtube', config: { ...config, backlightSettings: { ...numeric,
    ...(toneProfile === null ? {} : { toneProfile }), ...(opacity === null ? {} : { opacity }),
    ...(vibrance === null ? {} : { vibrance }), ...(roomFill === null ? {} : { roomFill }),
  } } };
}

/** Model tools translate typed requests; content behavior remains in the canvas. */
export function createContentTools(host: ContentToolHost) {
  const { surfaceId } = host;
  const base = { surfaceId, title };
  function receiptFor(receipt: CommandReceipt, id: string) {
    if (!receipt.ok) return receipt;
    const content = receipt.scene.contents.find(c => c.id === id) ?? null;
    return { ok: true as const, revision: receipt.scene.revision, content,
      ...(content ? { presentation: presentationContext(receipt.scene, content) } : {}),
      ...(content?.kind === 'media' ? {
        assetAvailability: 'unverified' as const,
        playback: { verified: false, requestedRunning: content.state.clock.running,
          controls: 'File selection uses the interface handoff; configure_media controls presentation settings. A saved asset reference does not establish that the file is available in this browser or that playback is visible.' },
      } : {}),
      ...(content?.kind === 'art' ? { appearance: { preset: content.config.preset, ...ART_PRESETS[content.config.preset] } } : {}),
      ...(content?.kind === 'youtube' ? {
        playback: { verified: false, controls: 'New video sources default to paused and muted. Use operator/player controls when ready; playback and unmute are deliberate actions.', output: CONTENT_REGISTRY.find(entry => entry.kind === 'youtube')!.description },
        backlight: { enabled: content.config.backlight, settings: { ...BACKLIGHT_DEFAULTS, ...content.config.backlightSettings }, captureVerified: false, source: 'A connected native source supplies video frames without screen sharing, including through the local website worker. Only the browser iframe fallback requires sharing this studio tab. Check source status and visible output. Enabling the setting alone does not establish active frames or visible gradients.' },
      } : {}) };
  }
  async function create(input: { surfaceId: string; title: string }, contentSpec: ContentSpec, callId: string, startGame = false) {
    const id = `content-${createHash('sha256').update(`${host.turnId}:${callId}`).digest('hex').slice(0,24)}`;
    const created = await host.dispatch({ type: 'content.create', id, ...input, spec: contentSpec });
    if (!created.ok || !startGame) return receiptFor(created, id);
    const started = await host.dispatch({ type: 'content.action', id, action: 'start' });
    if (!started.ok) return { ok: false as const, error: started.error, partial: 'Game created; starting failed.', content: created.scene.contents.find(c => c.id === id) };
    return receiptFor(started, id);
  }

  return {
    create_note: tool({
      description: 'Create a plain-text note/checklist card on an existing surface. Canvas prefers open space but permits overlap with other assets, within surface boundaries/exclusions and the shared per-surface asset limit.',
      strict: true,
      inputSchema: z.strictObject({ ...base, ...noteConfig.shape }),
      execute: (input, options) => host.once('create_note', input, options, () => create(
        { surfaceId: input.surfaceId, title: input.title }, { kind: 'note', config: { text: input.text, accent: input.accent } }, options.toolCallId)),
    }),
    create_recipe: tool({
      description: 'Display a recipe with ingredients and step-by-step controls. Starts on ingredients. This tool does not search the web or verify a recipe source.',
      strict: true,
      inputSchema: z.strictObject({ ...base, ...recipeConfig.shape }),
      execute: (input, options) => host.once('create_recipe', input, options, () => create(
        { surfaceId: input.surfaceId, title: input.title }, { kind: 'recipe', config: { ingredients: input.ingredients, steps: input.steps, source: input.source } }, options.toolCallId)),
    }),
    create_artwork: tool({
      description: 'Set an implemented animated background on a surface. Reuse its existing artwork by updating the requested title/config while preserving ID, bounds and clock; otherwise create a running background. Preserve existing style values when the user did not ask to change them. Only one background per surface, clipped to native boundaries/exclusions. Match the actual preset description; never rename an unrelated preset to imply success. Does not generate animation code, images or video.',
      strict: true,
      inputSchema: z.strictObject({ ...base, ...artConfig.shape }),
      execute: (input, options) => host.once('create_artwork', input, options, async () => {
        const spec: ContentSpec = { kind: 'art', config: { preset: input.preset, palette: input.palette, speed: input.speed, seed: input.seed } };
        const existing = (await host.getContents()).find(content => content.kind === 'art' && content.surfaceId === input.surfaceId);
        if (existing) return receiptFor(await host.dispatch({ type: 'content.update', id: existing.id, title: input.title, spec }), existing.id);
        return create({ surfaceId: input.surfaceId, title: input.title }, spec, options.toolCallId);
      }),
    }),
    create_reaction_game: tool({
      description: 'Create a deterministic pointer reaction game; optionally start it. It is played with local pointer input. No Kinect, dance/motion scoring, custom game code or agent-generated hits.',
      strict: true,
      inputSchema: z.strictObject({ ...base, ...gameConfig.shape, start: z.boolean() }),
      execute: (input, options) => host.once('create_reaction_game', input, options, () => create(
        { surfaceId: input.surfaceId, title: input.title }, { kind: 'game', config: { rounds: input.rounds, seed: input.seed } }, options.toolCallId, input.start)),
    }),
    display_youtube: tool({
      description: 'Display a YouTube video from a user-supplied link/ID or exact search_youtube URL. By default reuse the only existing YouTube player on the target surface, preserving placement and lighting style; create if none exists. newPlayer=true explicitly requests an additional/separate player. Search topics first; never pass a topic as URL. New players default to backlight on. Placement does not confirm playback/capture.',
      strict: true,
      inputSchema: z.strictObject({
        surfaceId,
        video: z.string().trim().min(1).max(YOUTUBE_LIMITS.inputLength).describe('An exact URL from search_youtube or a YouTube link/11-character ID supplied by the user. Never a search topic or invented ID. Link timestamps are preserved.'),
        title: title.nullable().describe('Use candidate.displayTitle from search_youtube for a searched video (already within the title limit). For a supplied link null uses YouTube. Never invent a fetched title.'),
        backlight: z.boolean().nullable().describe('null preserves an existing player’s toggle or defaults true for a new player. Use true for an explicit request with backlight and false for no backlight.'),
        newPlayer: z.boolean().nullable().describe('null or false reuses the only existing YouTube player on this surface, or creates if none. true only when the user explicitly wants an additional/another/separate player.'),
      }),
      execute: (input, options) => host.once('display_youtube', input, options, async () => {
        let parsed: ReturnType<typeof parseYouTubeInput>;
        try { parsed = parseYouTubeInput(input.video); }
        catch (error) {
          const message = error instanceof Error ? error.message : 'Provide a valid YouTube video link or ID.';
          host.recordFailure(message);
          return { ok: false as const, error: message };
        }
        if (host.allowVideo && !host.allowVideo(parsed.videoId)) {
          const error = 'Use a video returned by search_youtube or a link/ID supplied in the conversation. Do not invent video IDs.';
          host.recordFailure(error); return { ok: false as const, error };
        }
        if (!input.newPlayer) {
          const existing = (await host.getContents()).filter(content => content.kind === 'youtube' && content.surfaceId === input.surfaceId);
          if (existing.length > 1) {
            const error = 'More than one YouTube player is on that surface. Specify which one to update, or request an additional player.';
            host.recordFailure(error); return { ok: false as const, error };
          }
          const player = existing[0];
          if (player?.kind === 'youtube') return receiptFor(await host.dispatch({ type: 'content.update', id: player.id,
            title: input.title ?? (parsed.videoId === player.config.videoId ? player.title : 'YouTube'),
            spec: { kind: 'youtube', config: { ...player.config, ...parsed, backlight: input.backlight ?? player.config.backlight } },
          }), player.id);
        }
        return create({ surfaceId: input.surfaceId, title: input.title ?? 'YouTube' },
          { kind: 'youtube', config: { ...parsed, backlight: input.backlight ?? true } }, options.toolCallId);
      }),
    }),
    set_youtube_backlight: tool({
      description: 'Enable or disable dynamic backlight for an existing YouTube panel. Preserves the video, placement, player and all lighting settings, including opacity, vibrance and room fill. Does not reload the video or prove capture is active. Use its content ID from the current room or a display_youtube receipt.',
      strict: true,
      inputSchema: z.strictObject({ contentId, enabled: z.boolean() }),
      execute: (input, options) => host.once('set_youtube_backlight', input, options, async () => receiptFor(
        await host.dispatch({ type: 'youtube.backlight', id: input.contentId, enabled: input.enabled }), input.contentId)),
    }),
    configure_video_backlight: tool({
      description: 'Tune video backlighting in one atomic edit: tone profile, brightness (intensity), opacity, vibrance, roomFill, spread or smoothing, optionally enable/disable. null preserves a setting. roomFill continuously extends light from a normal halo at 0 to all room surfaces at 1; percentages map to 0–1. The renderer protects timers and foreground panels automatically. Do not create more videos/artwork or move content to fill the room. Select soft for gentler light, cinema for balanced light, vivid for richer colors, neutral for faithful color. Explicit opacity/vibrance requests change those controls without switching profiles. Local algorithms continuously blend real video colors; no per-frame model calls. Requires available frames; does not control playback or capture permission.',
      strict: true,
      inputSchema: z.strictObject({
        contentId, enabled: z.boolean().nullable(),
        intensity: backlightSettings.shape.intensity.nullable(),
        spread: backlightSettings.shape.spread.nullable(),
        smoothingMs: backlightSettings.shape.smoothingMs.nullable(),
        toneProfile: toneProfile.nullable().describe('null preserves the current profile. Select the supported profile that best matches the requested look.'),
        opacity: opacity.nullable(), vibrance: vibrance.nullable(), roomFill: roomFill.nullable(),
      }),
      execute: (input, options) => host.once('configure_video_backlight', input, options, async () => {
        const settings: Partial<BacklightSettings> = {
          ...(input.intensity === null ? {} : { intensity: input.intensity }),
          ...(input.spread === null ? {} : { spread: input.spread }),
          ...(input.smoothingMs === null ? {} : { smoothingMs: input.smoothingMs }),
          ...(input.toneProfile === null ? {} : { toneProfile: input.toneProfile }),
          ...(input.opacity === null ? {} : { opacity: input.opacity }),
          ...(input.vibrance === null ? {} : { vibrance: input.vibrance }),
          ...(input.roomFill === null ? {} : { roomFill: input.roomFill }),
        };
        if (input.enabled === null && !Object.keys(settings).length) {
          const error = 'Choose at least one backlight setting.';
          host.recordFailure(error);
          return { ok: false as const, error };
        }
        return receiptFor(await host.dispatch({ type: 'youtube.backlight.configure', id: input.contentId,
          ...(Object.keys(settings).length ? { settings } : {}), ...(input.enabled === null ? {} : { enabled: input.enabled }) }), input.contentId);
      }),
    }),
    update_content: tool({
      description: 'Edit existing content. null preserves title/spec; non-null spec replaces the FULL config and must retain kind. Recipe config updates return to ingredients; artwork preserves its clock; game config requires idle (reset first only if the user wants to discard progress). YouTube video/start changes reload the player; use set_youtube_backlight for a lighting toggle or configure_video_backlight for lighting settings. Title-only edits preserve state. Uploaded media supports title-only edits here: keep spec null and use configure_media for presentation settings and operate_studio asset.import for a file-selection handoff.',
      strict: true,
      inputSchema: z.strictObject({ contentId, title: title.nullable(), spec: spec.nullable() }),
      execute: (input, options) => host.once('update_content', input, options, async () => {
        if (input.title === null && input.spec === null) return { ok: false as const, error: 'Specify a title or replacement configuration.' };
        if (input.spec?.kind === 'youtube' && host.allowVideo && !host.allowVideo(input.spec.config.videoId)) {
          const error = 'Search for the replacement video first, or use a link/ID supplied in the conversation.';
          host.recordFailure(error); return { ok: false as const, error };
        }
        const receipt = await host.dispatch({ type: 'content.update', id: input.contentId,
          ...(input.title === null ? {} : { title: input.title }), ...(input.spec === null ? {} : { spec: canvasSpec(input.spec) }) });
        return receiptFor(receipt, input.contentId);
      }),
    }),
    control_content: tool({
      description: 'Control existing content using an action allowed by its registry entry: recipe next/previous/reset; artwork, game and already-uploaded local video start/pause/reset. Recipe navigation clamps at ingredients/last step. Art/video reset pauses at elapsed zero; game reset discards progress and returns to idle. Local video actions preserve media settings including mute/volume and do not verify file availability or visible playback. Notes, uploaded images and YouTube have no runtime actions here; use YouTube player controls for playback.',
      strict: true,
      inputSchema: z.strictObject({ contentId, action: actionSchema }),
      execute: (input, options) => host.once('control_content', input, options, async () => receiptFor(
        await host.dispatch({ type: 'content.action', id: input.contentId, action: input.action }), input.contentId)),
    }),
    attach_content: tool({
      description: 'Attach existing content to a surface, preserving its recipe step/clock/game progress and panel size. Panels may overlap within boundaries/exclusions; transfers to a different surface require an available asset slot. Artwork fills the destination and fails if another artwork is already there. Same-surface attachment does not add an asset.',
      strict: true,
      inputSchema: z.strictObject({ contentId, surfaceId }),
      execute: (input, options) => host.once('attach_content', input, options, async () => receiptFor(
        await host.dispatch({ type: 'content.attach', id: input.contentId, surfaceId: input.surfaceId }), input.contentId)),
    }),
    remove_content: tool({
      description: 'Remove the specified content instance from the room. Use a current content ID; timer removal uses control_timer instead.',
      strict: true,
      inputSchema: z.strictObject({ contentId }),
      execute: (input, options) => host.once('remove_content', input, options, async () => {
        const receipt = await host.dispatch({ type: 'content.remove', id: input.contentId });
        if (!receipt.ok) return receipt;
        return { ok: true as const, revision: receipt.scene.revision, removedId: input.contentId };
      }),
    }),
  };
}
