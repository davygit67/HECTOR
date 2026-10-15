import { validateBacklightSettings, type BacklightSettings } from './backlight.js';
import { YOUTUBE_ID, YOUTUBE_LIMITS } from './youtube.js';
import type { Bounds } from './geometry.js';
import type { LayerSettings } from './layers.js';
import { mediaTime, validateMediaConfig, type MediaConfig } from './mediaContent.js';

export type ContentKind = 'note' | 'recipe' | 'art' | 'game' | 'youtube' | 'media';
/** Actual renderer capabilities. A title cannot change an artwork's appearance. */
export const ART_PRESETS = {
  aurora: { label: 'Aurora', description: 'Layers of translucent waving light ribbons. Abstract procedural animation, not objects or animals.' },
  stars: { label: 'Stars', description: 'A drifting, twinkling starfield with a soft halo. Procedural points of light, not generated space imagery.' },
  contours: { label: 'Flowing contours', description: 'Thin animated contour lines flowing across the surface. Abstract lines, not fish or other objects.' },
  fish: { label: 'Swimming fish', description: 'Stylized fish with visible eyes, fins and moving tails swim across the surface in both directions, with rising bubbles. Procedural animation, not generated video.' },
} as const;
export type ArtPreset = keyof typeof ART_PRESETS;
export type ArtPalette = 'lagoon' | 'ember' | 'violet';
export interface NoteConfig { text: string; accent: string }
export interface RecipeConfig { ingredients: string[]; steps: string[]; source: string }
export interface ArtConfig { preset: ArtPreset; palette: ArtPalette; speed: number; seed: number }
export interface YouTubeConfig { videoId: string; startSeconds: number; backlight: boolean; backlightSettings?: BacklightSettings }
export interface GameConfig { rounds: number; seed: number }
export type ContentSpec = { kind: 'note'; config: NoteConfig } | { kind: 'recipe'; config: RecipeConfig }
  | { kind: 'art'; config: ArtConfig } | { kind: 'game'; config: GameConfig } | { kind: 'youtube'; config: YouTubeConfig } | { kind: 'media'; config: MediaConfig };
export interface ClockState { running: boolean; startedAt: number; elapsedMs: number }
export interface ContentBase { id: string; title: string; surfaceId: string; bounds: Bounds; layer?: LayerSettings }
export type NoteContent = ContentBase & { kind: 'note'; config: NoteConfig; state: Record<string, never> };
export type RecipeContent = ContentBase & { kind: 'recipe'; config: RecipeConfig; state: { stepIndex: number } };
export type ArtContent = ContentBase & { kind: 'art'; config: ArtConfig; state: { clock: ClockState } };
export type GameContent = ContentBase & { kind: 'game'; config: GameConfig; state: {
  status: 'idle' | 'running' | 'paused' | 'finished'; round: number; score: number; misses: number; clock: ClockState; roundStartMs: number;
} };
export type YouTubeContent = ContentBase & { kind: 'youtube'; config: YouTubeConfig; state: Record<string, never> };
export type MediaContent = ContentBase & { kind: 'media'; config: MediaConfig; state: { clock: ClockState } };
export type ContentInstance = YouTubeContent | NoteContent | RecipeContent | ArtContent | GameContent | MediaContent;
export type ContentAction = 'start' | 'pause' | 'reset' | 'next' | 'previous';
export type ContentCommand =
  | { type: 'content.create'; id: string; surfaceId: string; title: string; spec: ContentSpec }
  | { type: 'content.update'; id: string; title?: string; spec?: ContentSpec }
  | { type: 'content.select'; id: string }
  | { type: 'content.move'; id: string; bounds: Bounds }
  | { type: 'content.attach'; id: string; surfaceId: string }
  | { type: 'content.remove'; id: string }
  | { type: 'content.action'; id: string; action: ContentAction }
  | { type: 'media.seek'; id: string; seconds: number }
  | { type: 'youtube.backlight'; id: string; enabled: boolean }
  | { type: 'youtube.backlight.configure'; id: string; settings?: Partial<BacklightSettings>; enabled?: boolean }
  | { type: 'game.hit'; id: string; round: number; target: number };

export const CONTENT_LIMITS = {
  maxInstances: 12, maxPerSurface: 5, idLength: 100, titleLength: 60, noteLength: 800, recipeItems: 12,
  ingredientLength: 100, stepLength: 400, sourceLength: 160,
  speed: { min: .1, max: 3 }, seed: { min: 1, max: 65535 }, rounds: { min: 3, max: 30 },
  presets: ['aurora', 'stars', 'contours', 'fish'], palettes: ['lagoon', 'ember', 'violet'],
} as const;
/** Serializable capabilities; these presets do not imply external asset generation. */
export const CONTENT_REGISTRY = [
  { kind: 'media', label: 'Upload media', symbol: '↥', description: 'Import a video or image from this computer.', layout: 'panel', actions: ['start', 'pause', 'reset'], input: 'controls', output: ['manual', 'spatial'], defaults: {} },
  { kind: 'note', label: 'Note', symbol: 'Aa', description: 'A message, checklist or idea.', layout: 'panel', actions: [], input: 'none', output: ['manual', 'spatial'], defaults: { text: 'Make room for an idea.\nEdit this note in the inspector.', accent: '#b8db90' } },
  { kind: 'recipe', label: 'Recipe', symbol: '≡', description: 'Ingredients and one step at a time.', layout: 'panel', actions: ['next', 'previous', 'reset'], input: 'controls', output: ['manual', 'spatial'], defaults: { ingredients: ['200 g pasta', '2 tbsp olive oil', '1 lemon', 'Salt and black pepper'], steps: ['Cook the pasta according to its package directions. Reserve a little cooking water.', 'Toss with olive oil, lemon zest and juice. Add cooking water as needed.', 'Season to taste and serve.'], source: 'Local example · lemon pasta' } },
  { kind: 'art', label: 'Living art', symbol: '≈', description: 'Aurora, stars, flowing contours or swimming fish.', presets: ART_PRESETS, layout: 'background', actions: ['start', 'pause', 'reset'], input: 'none', output: ['manual', 'spatial'], defaults: { preset: 'aurora', palette: 'lagoon', speed: 1, seed: 42 } },
  { kind: 'youtube', label: 'YouTube', symbol: '▶', description: 'Normal YouTube playback with live color backlight. The local renderer shares the video across all views without screen sharing. Videos start paused and muted. A static site without the local renderer uses a limited embed fallback.', layout: 'panel', actions: [], input: 'player', output: ['manual'], preview: 'placement-placeholder', defaults: { videoId: '', startSeconds: 0, backlight: true } },
  { kind: 'game', label: 'Target game', symbol: '◎', description: 'A scored pointer reaction game.', layout: 'panel', actions: ['start', 'pause', 'reset'], input: 'pointer', output: ['manual', 'spatial'], defaults: { rounds: 8, seed: 42 } },
] as const;
export const contentKinds: ContentKind[] = ['note', 'recipe', 'art', 'game', 'youtube', 'media'];
export function defaultSpec(kind: ContentKind): ContentSpec { if (kind === 'youtube') throw new Error('Provide a YouTube video URL or ID first.'); if (kind === 'media') throw new Error('Import a local media file first.'); return { kind, config: structuredClone(CONTENT_REGISTRY.find(x => x.kind === kind)!.defaults) } as ContentSpec; }
export function clockMs(clock: ClockState, now: number) { return clock.elapsedMs + (clock.running ? Math.max(0, now - clock.startedAt) : 0); }
export function changeClock(clock: ClockState, running: boolean, now: number) { clock.elapsedMs = clockMs(clock, now); clock.startedAt = now; clock.running = running; }
export function randomUnit(seed: number, index: number) {
  let n = Math.imul(seed ^ Math.imul(index + 1, 0x9e3779b9), 0x85ebca6b); n ^= n >>> 13; n = Math.imul(n, 0xc2b2ae35); return (n >>> 0) / 4294967296;
}
export function gameTarget(game: GameContent) { return Math.floor(randomUnit(game.config.seed, game.state.round) * 8); }
export const GAME_GRID = { x: .08, y: .3, w: .84, h: .5, columns: 4, rows: 2 } as const;
export function gameCellAt(x: number, y: number): number | null {
  const g = GAME_GRID;
  if (x < g.x || x >= g.x + g.w || y < g.y || y >= g.y + g.h) return null;
  return Math.floor((x - g.x) / g.w * g.columns) + Math.floor((y - g.y) / g.h * g.rows) * g.columns;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Content configuration must be an object.');
  return value as Record<string, unknown>;
}
function exactKeys(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).some(key => !keys.includes(key))) throw new Error('Unsupported content configuration field.');
}
function text(value: unknown, max: number, label: string, allowEmpty = false): asserts value is string {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim()) || value.length > max) throw new Error(label + ' must contain ' + (allowEmpty ? '0' : '1') + '–' + max + ' characters.');
}
function integer(value: unknown, min: number, max: number, label: string) {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) throw new Error(label + ' must be an integer from ' + min + ' to ' + max + '.');
}
export function validateSpec(spec: ContentSpec) {
  const root = object(spec); exactKeys(root, ['kind', 'config']); const c = object(root.config), l = CONTENT_LIMITS;
  switch (root.kind) {
    case 'media': validateMediaConfig(c); break;
    case 'note': exactKeys(c, ['text', 'accent']); text(c.text, l.noteLength, 'Note'); if (typeof c.accent !== 'string' || !/^#[0-9a-f]{6}$/i.test(c.accent)) throw new Error('Choose a six-digit hex accent color.'); break;
    case 'recipe':
      exactKeys(c, ['ingredients', 'steps', 'source']);
      for (const key of ['ingredients', 'steps'] as const) {
        if (!Array.isArray(c[key]) || !c[key].length || c[key].length > l.recipeItems) throw new Error('Use 1–' + l.recipeItems + ' ' + key + '.');
        c[key].forEach(line => text(line, key === 'ingredients' ? l.ingredientLength : l.stepLength, key));
      }
      text(c.source, l.sourceLength, 'Recipe source', true); break;
    case 'art':
      exactKeys(c, ['preset', 'palette', 'speed', 'seed']);
      if (!(l.presets as readonly unknown[]).includes(c.preset) || !(l.palettes as readonly unknown[]).includes(c.palette)) throw new Error('Choose a supported artwork preset and palette.');
      if (!Number.isFinite(c.speed) || (c.speed as number) < l.speed.min || (c.speed as number) > l.speed.max) throw new Error('Artwork speed must be 0.1–3.');
      integer(c.seed, l.seed.min, l.seed.max, 'Seed'); break;
    case 'youtube':
      exactKeys(c, ['videoId', 'startSeconds', 'backlight', 'backlightSettings']);
      if (typeof c.videoId !== 'string' || !YOUTUBE_ID.test(c.videoId)) throw new Error('Use an 11-character YouTube video ID.');
      integer(c.startSeconds, 0, YOUTUBE_LIMITS.maxStartSeconds, 'YouTube start time');
      if (typeof c.backlight !== 'boolean') throw new Error('YouTube backlight must be on or off.');
      if (c.backlightSettings !== undefined) validateBacklightSettings(c.backlightSettings);
      break;
    case 'game': exactKeys(c, ['rounds', 'seed']); integer(c.rounds, l.rounds.min, l.rounds.max, 'Rounds'); integer(c.seed, l.seed.min, l.seed.max, 'Seed'); break;
    default: throw new Error('Unsupported content kind.');
  }
}
export function createContent(base: ContentBase, spec: ContentSpec, now: number): ContentInstance {
  validateSpec(spec);
  const copy = structuredClone(spec);
  switch (copy.kind) {
    case 'media': return { ...base, ...copy, state: { clock: { running: false, startedAt: now, elapsedMs: 0 } } };
    case 'note': case 'youtube': return { ...base, ...copy, state: {} };
    case 'recipe': return { ...base, ...copy, state: { stepIndex: -1 } };
    case 'art': return { ...base, ...copy, state: { clock: { running: true, startedAt: now, elapsedMs: 0 } } };
    case 'game': return { ...base, ...copy, state: { status: 'idle', round: 0, score: 0, misses: 0, roundStartMs: 0, clock: { running: false, startedAt: now, elapsedMs: 0 } } };
  }
}
export function applyContentAction(content: ContentInstance, action: ContentAction, now: number) {
  const actions = CONTENT_REGISTRY.find(x => x.kind === content.kind)!.actions as readonly string[];
  if (!actions.includes(action)) throw new Error(action + ' is not supported by ' + content.kind + '.');
  if (content.kind === 'media') {
    if (content.config.mediaType !== 'video') throw new Error('Images have no video playback controls.');
    const elapsedMs = mediaTime(content.config, content.state.clock, now) * 1000;
    content.state.clock = { running: action === 'start', startedAt: now, elapsedMs: action === 'reset' || (action === 'start' && elapsedMs >= content.config.duration * 1000) ? 0 : elapsedMs };
  } else if (content.kind === 'recipe') {
    content.state.stepIndex = action === 'reset' ? -1 : Math.max(-1, Math.min(content.config.steps.length - 1, content.state.stepIndex + (action === 'next' ? 1 : -1)));
  } else if (content.kind === 'art') {
    if (action === 'reset') content.state.clock = { running: false, startedAt: now, elapsedMs: 0 };
    else changeClock(content.state.clock, action === 'start', now);
  } else if (content.kind === 'game') {
    if (action === 'reset') content.state = { status: 'idle', round: 0, score: 0, misses: 0, roundStartMs: 0, clock: { running: false, startedAt: now, elapsedMs: 0 } };
    else if (action === 'start') {
      if (content.state.status === 'finished') throw new Error('Reset the completed game before starting again.');
      changeClock(content.state.clock, true, now); content.state.status = 'running';
    } else if (content.state.status === 'running') { changeClock(content.state.clock, false, now); content.state.status = 'paused'; }
  }
}
export function applyGameHit(game: GameContent, round: number, target: number, now: number) {
  integer(target, 0, 7, 'Target'); integer(round, 0, CONTENT_LIMITS.rounds.max - 1, 'Round');
  if (game.state.status !== 'running') throw new Error('Start or resume the game to play.');
  if (round !== game.state.round) throw new Error('That target belongs to an earlier round.');
  if (target !== gameTarget(game)) { game.state.misses++; return; }
  const elapsed = clockMs(game.state.clock, now), response = Math.max(0, elapsed - game.state.roundStartMs);
  game.state.score += Math.max(10, 100 - Math.floor(response / 100)); game.state.round++; game.state.roundStartMs = elapsed;
  if (game.state.round === game.config.rounds) { game.state.status = 'finished'; changeClock(game.state.clock, false, now); }
}
export function validateContentState(content: ContentInstance) {
  validateSpec({ kind: content.kind, config: content.config } as ContentSpec); object(content.state);
  if (content.kind === 'youtube' && Object.keys(content.state).length) throw new Error('YouTube playback state belongs to its player.');
  if (content.kind === 'recipe') integer(content.state.stepIndex, -1, content.config.steps.length - 1, 'Recipe step');
  if (content.kind === 'art' || content.kind === 'game' || content.kind === 'media') {
    const clock = content.state.clock;
    if (!clock || typeof clock.running !== 'boolean' || !Number.isFinite(clock.startedAt) || !Number.isFinite(clock.elapsedMs) || clock.elapsedMs < 0) throw new Error('Invalid content clock.');
  }
  if (content.kind === 'media' && (content.state.clock.elapsedMs > content.config.duration * 1000 || (content.config.mediaType === 'image' && content.state.clock.running))) throw new Error('Invalid media clock.');
  if (content.kind === 'game') {
    const s = content.state;
    if (!['idle', 'running', 'paused', 'finished'].includes(s.status) || s.clock.running !== (s.status === 'running')) throw new Error('Invalid game status.');
    integer(s.round, 0, content.config.rounds, 'Game round'); integer(s.score, 0, s.round * 100, 'Score'); integer(s.misses, 0, 1000000, 'Misses');
    if ((s.status === 'finished') !== (s.round === content.config.rounds) || !Number.isFinite(s.roundStartMs) || s.roundStartMs < 0
      || (!s.clock.running && s.roundStartMs > s.clock.elapsedMs) || (s.status === 'idle' && (s.round || s.score || s.misses || s.clock.elapsedMs))) throw new Error('Invalid game progress.');
  }
}
