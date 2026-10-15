import { BACKLIGHT_DEFAULTS, validateBacklightSettings } from './backlight.js';
import { DEFAULT_QUAD, FULL_QUAD, constrainBounds, isValidQuad, isValidProjectionQuad, type Bounds, type Quad } from './geometry.js';
import { boundsInDomain, cameraBasis, coverageRecords, defaultSpatial, finiteVec, fitBounds, dot, length, LEGACY_WALL_BOUNDARY, LEGACY_WALL_HOLES, type Coverage, type Projector, type Surface, type Vec3, type Viewer } from './spatial.js';
import { applyContentAction, applyGameHit, createContent, validateSpec, validateContentState, CONTENT_LIMITS, type ContentCommand, type ContentInstance } from './content.js';
import { FULL_BOUNDS, placePanel } from './layout.js';
import { YOUTUBE_MIN_BOUNDS } from './youtube.js';
import { DISPLAY_DEFAULTS, reorderLayer, surfaceLayers, validateDisplay, validateLayer, type DisplaySettings, type LayerDirection, type LayerSettings } from './layers.js';
import { mediaTime } from './mediaContent.js';

export interface Timer {
  layer?: LayerSettings;
  id: string; title: string; durationMs: number; bounds: Bounds; surfaceId: string;
  status: 'idle' | 'running' | 'paused'; remainingMs: number; deadline: number | null;
}
export interface Scene {
  display?: DisplaySettings;
  schemaVersion: 3; revision: number; geometryRevision: number; showGrid: boolean;
  frame: { id: 'simulated-room'; units: 'meters'; provenance: 'simulated'; up: '+Y' };
  surfaces: Surface[]; projectors: Projector[]; viewer: Viewer; coverage: Coverage[];
  selectedSurfaceId: string; timers: Timer[]; selectedTimerId: string | null;
  contents: ContentInstance[]; selectedContentId: string | null;
  manualOutput: { surfaceId: string; quad: Quad; calibration: 'manual-2d' };
  outputView: 'manual' | 'projector-a' | 'projector-b';
  /** Retired demo state, retained only for compatibility with older saves. */
  effect: { enabled: boolean; running: boolean; startedAt: number; elapsedMs: number };
}
export type Command =
  | ContentCommand
  | { type: 'layer.configure'; id: string; settings: Partial<Omit<LayerSettings, 'order'>> }
  | { type: 'layer.reorder'; id: string; direction: LayerDirection }
  | { type: 'display.configure'; settings: Partial<DisplaySettings> }
  | { type: 'timer.create'; id: string; title: string; durationMs: number; surfaceId?: string }
  | { type: 'timer.select'; id: string }
  | { type: 'timer.update'; id: string; title?: string; durationMs?: number }
  | { type: 'timer.move'; id: string; bounds: Bounds }
  | { type: 'timer.action'; id: string; action: 'start' | 'pause' | 'reset' }
  | { type: 'timer.remove'; id: string }
  | { type: 'timer.attach'; id: string; surfaceId: string }
  | { type: 'calibration.set'; quad: Quad }
  | { type: 'calibration.reset' }
  | { type: 'grid.set'; visible: boolean }
  | { type: 'surface.select'; id: string }
  | { type: 'surface.move'; id: string; origin: Vec3 }
  | { type: 'surface.demo-exclusion'; id: string; enabled: boolean }
  | { type: 'projector.update'; id: string; position?: Vec3; target?: Vec3; enabled?: boolean }
  | { type: 'viewer.update'; position: Vec3 }
  | { type: 'effect.set'; enabled?: boolean; running?: boolean }
  | { type: 'output.view'; view: Scene['outputView'] }
  | { type: 'manual.target'; surfaceId: string };

export function initialScene(now = Date.now()): Scene {
  const spatial = defaultSpatial();
  return { schemaVersion: 3, revision: 0, geometryRevision: 0, showGrid: false,
    frame: { id: 'simulated-room', units: 'meters', provenance: 'simulated', up: '+Y' }, ...spatial,
    coverage: coverageRecords({ ...spatial, geometryRevision: 0 }), selectedSurfaceId: 'tabletop', timers: [], selectedTimerId: null, contents: [], selectedContentId: null,
    manualOutput: { surfaceId: 'tabletop', quad: structuredClone(DEFAULT_QUAD), calibration: 'manual-2d' }, outputView: 'manual',
    effect: { enabled: false, running: false, startedAt: now, elapsedMs: 0 } };
}
export function getSurface(scene: Scene, id = scene.selectedSurfaceId): Surface {
  const surface = scene.surfaces.find(s => s.id === id);
  if (!surface) throw new Error('That surface no longer exists.');
  return surface;
}
function moveWithinSurface(scene: Scene, id: string, bounds: Bounds, excludeId?: string, allowShrink = false, video = false) {
  const occupied = allowShrink ? [...scene.timers, ...scene.contents.filter(c => c.kind !== 'art')].filter(c => c.surfaceId === id && c.id !== excludeId).map(c => c.bounds) : [];
  return placePanel(getSurface(scene, id), constrainBounds(bounds, video ? YOUTUBE_MIN_BOUNDS : undefined), occupied, allowShrink);
}
export function surfaceAssetCount(scene: Scene, surfaceId: string) {
  return [...scene.timers, ...scene.contents].filter(item => item.surfaceId === surfaceId).length;
}
function checkSurfaceCapacity(scene: Scene, surfaceId: string, currentSurfaceId?: string) {
  const surface = getSurface(scene, surfaceId);
  if (surfaceId !== currentSurfaceId && surfaceAssetCount(scene, surfaceId) >= CONTENT_LIMITS.maxPerSurface)
    throw new Error(`${surface.name} has all ${CONTENT_LIMITS.maxPerSurface} asset slots filled. Edit an existing asset, remove one, or use the other surface.`);
}
function validId(id: string) { if (typeof id !== 'string' || !id || id.length > CONTENT_LIMITS.idLength) throw new Error('Invalid content ID.'); }
function checkBackground(scene: Scene, surfaceId: string, excludeId?: string) {
  if (scene.contents.some(c => c.kind === 'art' && c.surfaceId === surfaceId && c.id !== excludeId)) throw new Error('This surface already has artwork. Edit or remove it before adding another background.');
}
function checkPose(position: Vec3, target: Vec3) {
  if (!finiteVec(position) || !finiteVec(target)) throw new Error('Use finite room coordinates.');
  cameraBasis({ position, target, fov: 60, aspect: 16 / 9 });
}
export function remaining(timer: Timer, now = Date.now()): number {
  return Math.max(0, timer.status === 'running' ? (timer.deadline ?? now) - now : timer.remainingMs);
}
export function formatTime(ms: number): string {
  const seconds = Math.ceil(Math.max(0, ms) / 1000);
  const hours = Math.floor(seconds / 3600);
  return hours ? `${hours}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
    : `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
function validDuration(value: number) {
  if (!Number.isFinite(value) || value < 1000 || value > 86_400_000) throw new Error('Choose a duration between 1 second and 24 hours.');
}
function title(value: string) {
  if (typeof value !== 'string' || !value.trim() || value.length > 60) throw new Error('Use a title between 1 and 60 characters.');
  return value.trim();
}

/** One deterministic command path for UI now, voice and sensor input later. */
export function reduceScene(scene: Scene, command: Command, now = Date.now()): Scene {
  const next = structuredClone(scene);
  // Stale windows may still send a scene with the retired demo switched on.
  next.effect.enabled = false; next.effect.running = false;
  const timer = 'id' in command ? next.timers.find(t => t.id === command.id) : undefined;
  const content = 'id' in command ? next.contents.find(c => c.id === command.id) : undefined;
  if (command.type.startsWith('timer.') && command.type !== 'timer.create' && !timer) throw new Error('That timer no longer exists.');
  if ((command.type.startsWith('content.') && command.type !== 'content.create' || (command.type === 'game.hit' || command.type.startsWith('youtube.backlight'))) && !content) throw new Error('That content no longer exists.');
  switch (command.type) {
    case 'display.configure':
      validateDisplay(command.settings, true);
      next.display = { ...DISPLAY_DEFAULTS, ...next.display, ...command.settings }; break;
    case 'layer.reorder': reorderLayer(next, command.id, command.direction); break;
    case 'layer.configure': {
      const item = content ?? timer;
      if (!item) throw new Error('That layer no longer exists.');
      validateLayer(command.settings, true);
      if ('order' in command.settings) throw new Error('Use layer ordering controls.');
      // Resolve all defaults once so configuring opacity cannot move a layer accidentally.
      const layers = surfaceLayers(next, item.surfaceId);
      layers.forEach((entry, order) => { entry.layer = { visible: true, locked: false, opacity: 1, ...entry.layer, order }; });
      item.layer = { ...item.layer!, ...command.settings }; break;
    }
    case 'media.seek':
      if (content?.kind !== 'media' || content.config.mediaType !== 'video') throw new Error('Choose an uploaded video.');
      if (!Number.isFinite(command.seconds) || command.seconds < 0 || command.seconds > content.config.duration) throw new Error('Choose a position within the video.');
      content.state.clock = { ...content.state.clock, startedAt: now, elapsedMs: command.seconds * 1000 }; break;
    case 'content.create': {
      validId(command.id);
      if (timer) throw new Error('That ID already belongs to a timer.');
      if (content) {
        if (content.kind !== command.spec.kind) throw new Error('That ID already belongs to another content kind.');
        return scene;
      }
      if (next.contents.length >= CONTENT_LIMITS.maxInstances) throw new Error('This prototype supports up to 12 content instances.');
      validateSpec(command.spec); getSurface(next, command.surfaceId);
      checkSurfaceCapacity(next, command.surfaceId);
      if (command.spec.kind === 'art') checkBackground(next, command.surfaceId);
      const desired = command.spec.kind === 'note' ? { x: .06, y: .08, w: .42, h: .38 }
        : command.spec.kind === 'recipe' ? { x: .05, y: .12, w: .46, h: .7 } : { x: .2, y: .16, w: .6, h: .66 };
      const bounds = command.spec.kind === 'art' ? { ...FULL_BOUNDS } : moveWithinSurface(next, command.surfaceId, desired, undefined, true);
      next.contents.push(createContent({ id: command.id, title: title(command.title), surfaceId: command.surfaceId, bounds }, command.spec, now));
      next.selectedContentId = command.id; next.selectedTimerId = null; next.selectedSurfaceId = command.surfaceId; break;
    }
    case 'content.select':
      next.selectedContentId = content!.id; next.selectedTimerId = null; next.selectedSurfaceId = content!.surfaceId; break;
    case 'content.update': {
      if (command.title !== undefined) content!.title = title(command.title);
      if (command.spec) {
        validateSpec(command.spec);
        if (command.spec.kind !== content!.kind) throw new Error('Changing content kind requires a new instance.');
        if (content!.kind === 'media' && command.spec.kind === 'media' && command.spec.config.assetId === content!.config.assetId) {
          for (const key of ['mediaType', 'fileName', 'mimeType', 'width', 'height', 'duration'] as const) {
            if (command.spec.config[key] !== content!.config[key]) throw new Error('Replace the file to change source metadata.');
          }
        }
        if (content!.kind === 'game' && content!.state.status !== 'idle') throw new Error('Reset the game before changing its rules.');
        const updated = createContent({ id: content!.id, title: content!.title, surfaceId: content!.surfaceId, bounds: content!.bounds, ...(content!.layer ? { layer: content!.layer } : {}) }, command.spec, now);
        if (updated.kind === 'art' && content!.kind === 'art') updated.state = content!.state;
        if (updated.kind === 'media' && content!.kind === 'media' && updated.config.assetId === content!.config.assetId) updated.state.clock = { ...content!.state.clock, startedAt: now, elapsedMs: mediaTime(content!.config, content!.state.clock, now) * 1000 };
        next.contents[next.contents.indexOf(content!)] = updated;
      }
      break;
    }
    case 'content.move':
      if (content!.layer?.locked) throw new Error('Unlock this layer before moving it.');
      if (content!.kind === 'art') throw new Error('Artwork fills the native surface. Attach it to another surface instead.');
      content!.bounds = moveWithinSurface(next, content!.surfaceId, command.bounds, content!.id, false, content!.kind === 'youtube' || content!.kind === 'media'); break;
    case 'content.attach':
      getSurface(next, command.surfaceId);
      checkSurfaceCapacity(next, command.surfaceId, content!.surfaceId);
      if (content!.kind === 'art') checkBackground(next, command.surfaceId, content!.id);
      else content!.bounds = moveWithinSurface(next, command.surfaceId, content!.bounds, content!.id, false, content!.kind === 'youtube' || content!.kind === 'media');
      content!.surfaceId = command.surfaceId; next.selectedSurfaceId = command.surfaceId; next.selectedContentId = content!.id; next.selectedTimerId = null; break;
    case 'content.remove':
      next.contents = next.contents.filter(c => c.id !== command.id);
      if (next.selectedContentId === command.id) next.selectedContentId = next.contents.find(c => c.surfaceId === next.selectedSurfaceId)?.id ?? null; break;
    case 'content.action': applyContentAction(content!, command.action, now); break;
    case 'youtube.backlight':
      if (content!.kind !== 'youtube') throw new Error('Backlight control requires YouTube content.');
      if (typeof command.enabled !== 'boolean') throw new Error('Backlight must be on or off.');
      content!.config.backlight = command.enabled; break;
    case 'youtube.backlight.configure': {
      if (content!.kind !== 'youtube') throw new Error('Backlight control requires YouTube content.');
      if (command.enabled !== undefined && typeof command.enabled !== 'boolean') throw new Error('Backlight must be on or off.');
      if (command.settings !== undefined) validateBacklightSettings(command.settings, true);
      if (command.enabled === undefined && !Object.keys(command.settings ?? {}).length) throw new Error('Choose at least one backlight setting.');
      content!.config.backlightSettings = { ...BACKLIGHT_DEFAULTS, ...content!.config.backlightSettings, ...command.settings };
      if (command.enabled !== undefined) content!.config.backlight = command.enabled;
      break;
    }
    case 'game.hit':
      if (content!.kind !== 'game') throw new Error('Pointer input requires a game.');
      applyGameHit(content!, command.round, command.target, now); break;
    case 'timer.create':
      if (content) throw new Error('That ID already belongs to content.');
      if (timer) return scene; // A repeated request must not create a duplicate.
      if (typeof command.id !== 'string' || !command.id || command.id.length > 100) throw new Error('Invalid timer ID.');
      if (next.timers.length >= 8) throw new Error('This prototype supports up to eight timers.');
      validDuration(command.durationMs);
      const surfaceId = command.surfaceId ?? next.selectedSurfaceId;
      checkSurfaceCapacity(next, surfaceId);
      next.timers.push({ id: command.id, title: title(command.title), durationMs: command.durationMs,
        surfaceId, bounds: moveWithinSurface(next, surfaceId, { x: .23 + (next.timers.length % 3) * .04, y: .25 + (next.timers.length % 3) * .06, w: .54, h: .48 }, undefined, true),
        status: 'idle', remainingMs: command.durationMs, deadline: null });
      next.selectedTimerId = command.id;
      next.selectedContentId = null;
      next.selectedSurfaceId = surfaceId;
      break;
    case 'timer.select': next.selectedTimerId = command.id; next.selectedContentId = null; next.selectedSurfaceId = timer!.surfaceId; break;
    case 'timer.update':
      if (command.title !== undefined) timer!.title = title(command.title);
      if (command.durationMs !== undefined) {
        validDuration(command.durationMs);
        if (timer!.status !== 'idle') throw new Error('Reset the timer before changing its duration.');
        timer!.durationMs = command.durationMs; timer!.remainingMs = command.durationMs;
      }
      break;
    case 'timer.move':
      if (timer!.layer?.locked) throw new Error('Unlock this layer before moving it.');
      timer!.bounds = moveWithinSurface(next, timer!.surfaceId, command.bounds, timer!.id); break;
    case 'timer.attach':
      checkSurfaceCapacity(next, command.surfaceId, timer!.surfaceId);
      timer!.bounds = moveWithinSurface(next, command.surfaceId, timer!.bounds, timer!.id);
      next.selectedContentId = null;
      timer!.surfaceId = command.surfaceId; next.selectedSurfaceId = command.surfaceId; next.selectedTimerId = timer!.id; break;
    case 'timer.action':
      if (command.action === 'start') {
        if (timer!.status === 'running') return scene;
        if (timer!.remainingMs <= 0) throw new Error('Reset the timer before starting it again.');
        timer!.deadline = now + timer!.remainingMs; timer!.status = 'running';
      } else if (command.action === 'pause') {
        if (timer!.status !== 'running') return scene;
        timer!.remainingMs = remaining(timer!, now); timer!.deadline = null; timer!.status = 'paused';
      } else if (command.action === 'reset') {
        timer!.remainingMs = timer!.durationMs; timer!.deadline = null; timer!.status = 'idle';
      } else throw new Error('Unknown timer action.');
      break;
    case 'timer.remove':
      next.timers = next.timers.filter(t => t.id !== command.id);
      if (next.selectedTimerId === command.id) next.selectedTimerId = next.timers.at(-1)?.id ?? null;
      break;
    case 'calibration.set':
      if (!isValidProjectionQuad(command.quad)) throw new Error('Keep all four corners in order, with some space between them.');
      next.manualOutput.quad = structuredClone(command.quad); break;
    case 'calibration.reset': next.manualOutput.quad = structuredClone(DEFAULT_QUAD); break;
    case 'grid.set':
      if (typeof command.visible !== 'boolean') throw new Error('Invalid grid setting.');
      next.showGrid = command.visible; break;
    case 'surface.select':
      getSurface(next, command.id); next.selectedSurfaceId = command.id;
      next.selectedTimerId = next.timers.find(t => t.surfaceId === command.id)?.id ?? null;
      next.selectedContentId = next.selectedTimerId ? null : next.contents.find(c => c.surfaceId === command.id)?.id ?? null; break;
    case 'surface.move':
      if (!finiteVec(command.origin) || command.origin[1] < 0) throw new Error('Use finite coordinates above the room floor.');
      getSurface(next, command.id).origin = [...command.origin]; next.geometryRevision++; break;
    case 'surface.demo-exclusion': {
      const surface = getSurface(next, command.id);
      if (typeof command.enabled !== 'boolean' || command.enabled || surface.id !== 'wall') throw new Error('This surface has no demo cutout.');
      if (!surface.holes.length) return scene;
      surface.holes = []; next.geometryRevision++; break;
    }
    case 'projector.update': {
      const projector = next.projectors.find(p => p.id === command.id);
      if (!projector) throw new Error('Unknown projector.');
      if (command.position !== undefined) projector.position = [...command.position];
      if (command.target !== undefined) projector.target = [...command.target];
      if (command.enabled !== undefined) { if (typeof command.enabled !== 'boolean') throw new Error('Invalid projector state.'); projector.enabled = command.enabled; }
      checkPose(projector.position, projector.target); next.geometryRevision++; break;
    }
    case 'viewer.update': checkPose(command.position, next.viewer.target); next.viewer.position = [...command.position]; break;
    case 'effect.set':
      if (command.enabled !== undefined && typeof command.enabled !== 'boolean') throw new Error('Invalid effect state.');
      if (command.running !== undefined && typeof command.running !== 'boolean') throw new Error('Invalid effect clock.');
      if (command.enabled === true || command.running === true) throw new Error('The built-in ripple demo has been removed and cannot be enabled.');
      // Disabling is still safe for older clients; enabling/resuming is retired.
      break;
    case 'output.view':
      if (!['manual', 'projector-a', 'projector-b'].includes(command.view)) throw new Error('Unknown output view.');
      next.outputView = command.view; break;
    case 'manual.target':
      getSurface(next, command.surfaceId);
      if (next.manualOutput.surfaceId !== command.surfaceId) next.manualOutput = { surfaceId: command.surfaceId, quad: structuredClone(DEFAULT_QUAD), calibration: 'manual-2d' };
      break;
    default: throw new Error('Unknown command.');
  }
  next.revision++;
  if (next.geometryRevision !== scene.geometryRevision) next.coverage = coverageRecords(next);
  return next;
}

/** Reject incompatible/corrupt saves rather than feeding malformed values to the renderer. */
export function readScene(value: unknown): Scene {
  if (!value || typeof value !== 'object') throw new Error('Invalid saved scene.');
  const raw = value as Record<string, unknown>;
  let s: Scene;
  if (raw.schemaVersion === 1) {
    if (!isValidQuad(raw.quad) || !Array.isArray(raw.timers)) throw new Error('Invalid legacy scene.');
    s = { ...initialScene(), revision: raw.revision as number, showGrid: raw.showGrid as boolean,
      timers: raw.timers.map(t => ({ ...t, surfaceId: 'tabletop' })), selectedTimerId: raw.selectedTimerId as string | null,
      manualOutput: { surfaceId: 'tabletop', quad: structuredClone(raw.quad), calibration: 'manual-2d' } };
  } else if (raw.schemaVersion === 2) s = { ...structuredClone(raw), schemaVersion: 3, contents: [], selectedContentId: null } as unknown as Scene;
  else s = structuredClone(value) as Scene;
  if (s.schemaVersion !== 3 || !Number.isSafeInteger(s.revision) || s.revision < 0 || !isValidProjectionQuad(s.manualOutput?.quad)
    || typeof s.showGrid !== 'boolean' || !Array.isArray(s.timers) || s.timers.length > 8) throw new Error('Invalid saved scene.');
  const oldWall = Array.isArray(s.surfaces) && s.surfaces.find(surface => surface?.id === 'wall' && surface.provenance === 'simulated');
  if (oldWall) {
    let changed = false;
    if (JSON.stringify(oldWall.boundary) === JSON.stringify(LEGACY_WALL_BOUNDARY)) { oldWall.boundary = structuredClone(FULL_QUAD); changed = true; }
    if (JSON.stringify(oldWall.holes) === JSON.stringify(LEGACY_WALL_HOLES)) { oldWall.holes = []; changed = true; }
    if (changed) { s.geometryRevision++; s.revision++; }
  }
  validateSpatial(s);
  if (s.effect.enabled || s.effect.running) {
    s.effect.enabled = false; s.effect.running = false; s.revision++;
  }
  if (s.display !== undefined) validateDisplay(s.display);
  const ids = new Set<string>();
  for (const t of s.timers) {
    if (t?.layer !== undefined) validateLayer(t.layer);
    if (!t || typeof t.id !== 'string' || !t.id || t.id.length > 100 || ids.has(t.id)) throw new Error('Invalid saved timer.');
    ids.add(t.id); title(t.title); validDuration(t.durationMs);
    if (!['idle', 'running', 'paused'].includes(t.status) || !Number.isFinite(t.remainingMs) || t.remainingMs < 0 || t.remainingMs > t.durationMs
      || (t.status === 'running' ? !Number.isFinite(t.deadline) : t.deadline !== null)) throw new Error('Invalid timer clock.');
    const b = constrainBounds(t.bounds);
    if (Object.keys(b).some(k => Math.abs(b[k as keyof Bounds] - t.bounds[k as keyof Bounds]) > 1e-9)) throw new Error('Invalid timer bounds.');
    if (!boundsInDomain(getSurface(s, t.surfaceId), b)) throw new Error('Saved timer is outside its surface.');
  }
  if (s.selectedTimerId !== null && !ids.has(s.selectedTimerId)) throw new Error('Invalid timer selection.');
  if (!Array.isArray(s.contents) || s.contents.length > CONTENT_LIMITS.maxInstances) throw new Error('Invalid saved content.');
  const backgrounds = new Set<string>(), contentIds = new Set<string>();
  for (const c of s.contents) {
    if (c?.layer !== undefined) validateLayer(c.layer);
    if (!c) throw new Error('Invalid saved content.');
    validId(c.id); title(c.title);
    if (ids.has(c.id) || contentIds.has(c.id)) throw new Error('Duplicate content identity.');
    contentIds.add(c.id); const surface = getSurface(s, c.surfaceId); validateContentState(c);
    if (c.kind === 'art') {
      if (backgrounds.has(c.surfaceId) || (Object.keys(FULL_BOUNDS) as (keyof Bounds)[]).some(key => c.bounds[key] !== FULL_BOUNDS[key])) throw new Error('Invalid background placement.');
      backgrounds.add(c.surfaceId);
    } else {
      const bounds = constrainBounds(c.bounds, c.kind === 'youtube' || c.kind === 'media' ? YOUTUBE_MIN_BOUNDS : undefined);
      if (Object.keys(bounds).some(k => Math.abs(bounds[k as keyof Bounds] - c.bounds[k as keyof Bounds]) > 1e-9) || !boundsInDomain(surface, c.bounds)) throw new Error('Invalid content placement.');
    }
  }
  if (s.selectedContentId !== null && !contentIds.has(s.selectedContentId) || s.selectedContentId !== null && s.selectedTimerId !== null) throw new Error('Invalid content selection.');
  return structuredClone(s);
}

function validateSpatial(s: Scene) {
  if (s.frame?.id !== 'simulated-room' || s.frame.units !== 'meters' || s.frame.provenance !== 'simulated' || s.frame.up !== '+Y'
    || !Number.isSafeInteger(s.geometryRevision) || s.geometryRevision < 0 || !Array.isArray(s.surfaces) || s.surfaces.length !== 2
    || !Array.isArray(s.projectors) || s.projectors.length !== 2) throw new Error('Invalid spatial scene.');
  const ids = new Set<string>();
  for (const surface of s.surfaces) {
    if (!surface || !['tabletop', 'wall'].includes(surface.id) || ids.has(surface.id) || typeof surface.name !== 'string' || !['wall', 'table'].includes(surface.kind)
      || surface.provenance !== 'simulated' || !finiteVec(surface.origin) || !finiteVec(surface.u) || !finiteVec(surface.v)
      || Math.abs(length(surface.u) - 1) > 1e-6 || Math.abs(length(surface.v) - 1) > 1e-6 || Math.abs(dot(surface.u, surface.v)) > 1e-6
      || !Number.isFinite(surface.width) || surface.width <= 0 || surface.width > 30 || !Number.isFinite(surface.height) || surface.height <= 0 || surface.height > 30) throw new Error('Invalid saved surface.');
    ids.add(surface.id);
    // Accept the known demo domain with its optional cutout, including older v3 saves.
    const template = defaultSpatial().surfaces.find(t => t.id === surface.id)!;
    if (JSON.stringify(surface.boundary) !== JSON.stringify(template.boundary) || !Array.isArray(surface.holes)
      || surface.holes.length && JSON.stringify(surface.holes) !== JSON.stringify(template.holes)) throw new Error('Unrecognized surface boundary.');
  }
  getSurface(s); getSurface(s, s.manualOutput.surfaceId);
  if (s.manualOutput.calibration !== 'manual-2d' || !['manual', 'projector-a', 'projector-b'].includes(s.outputView)) throw new Error('Invalid output adapter.');
  const projectors = new Set<string>();
  for (const p of s.projectors) {
    if (!p || !['projector-a', 'projector-b'].includes(p.id) || projectors.has(p.id) || typeof p.enabled !== 'boolean' || p.calibration !== 'simulated'
      || !Number.isFinite(p.fov) || p.fov < 10 || p.fov > 120 || p.aspect !== 16 / 9 || typeof p.name !== 'string') throw new Error('Invalid saved projector.');
    checkPose(p.position, p.target); projectors.add(p.id);
  }
  if (!s.viewer || s.viewer.mode !== 'fixed' || s.viewer.provenance !== 'simulated' || !Number.isFinite(s.viewer.fov) || s.viewer.fov < 10 || s.viewer.fov > 120 || s.viewer.aspect !== 16 / 9) throw new Error('Invalid viewer.');
  checkPose(s.viewer.position, s.viewer.target);
  if (!s.effect || typeof s.effect.enabled !== 'boolean' || typeof s.effect.running !== 'boolean' || !Number.isFinite(s.effect.startedAt) || !Number.isFinite(s.effect.elapsedMs) || s.effect.elapsedMs < 0) throw new Error('Invalid shared clock.');
  // Coverage is derived; stale cached coverage must never override the current device poses.
  s.coverage = coverageRecords(s);
}
