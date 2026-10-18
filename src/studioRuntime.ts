import { programWorkshop } from './programWorkshop';
import { registerPhysicalStatus } from './physicalGuard';
import { programStatuses } from './programRuntime';
import { agentBatch, bridge } from './bridge';
import { roomId, recordAdjustment } from './manualEvents';
import { compositionCommands, makeComposition, type Composition } from './shared/studioScene';
import { getSurface } from './shared/domain';
import { getArtwork } from './SpatialView';
import { readMediaImage, readMediaState } from './nativeMedia';
import { localMediaSource } from './localMedia';
import { validateMediaCommand } from './shared/media';
import type { StudioPort, StudioUI, StudioOperation, StudioSnapshot, StudioResult, HardwareStatus, HardwareAction, CompositionSummary } from './shared/studio';

interface UIAdapter {
  state(): StudioUI;
  navigate(operation: Extract<StudioOperation, { type: 'ui.navigate' }>): void;
  configure(operation: Extract<StudioOperation, { type: 'ui.configure' }>): void;
  handoff(label: string, action: () => void): void;
  importAsset(): void;
  present(mode: 'align' | 'project' | 'exit'): void;
}
let ui: UIAdapter | undefined;
let hardware: { status(): HardwareStatus; execute(command: HardwareAction): Promise<string> } | undefined;
export function registerStudioUI(adapter: UIAdapter) { ui = adapter; return () => { if (ui === adapter) ui = undefined; }; }
export function registerHardware(adapter: NonNullable<typeof hardware>) { hardware = adapter; const unregister = registerPhysicalStatus(adapter.status); return () => { unregister(); if (hardware === adapter) hardware = undefined; }; }
const libraryKey = 'projection-mapper.compositions.v1';
declare global { interface Window { projectionLibrary?: { read(): Promise<Composition[]>; write(items: Composition[]): Promise<void> } } }
const listeners = new Set<() => void>();
export const subscribeCompositions = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
async function library(): Promise<Composition[]> {
  const raw = window.projectionLibrary ? null : localStorage.getItem(libraryKey);
  const items: unknown = window.projectionLibrary ? await window.projectionLibrary.read() : raw ? JSON.parse(raw) : [];
  if (!Array.isArray(items) || items.length > 20) throw new Error('The composition library could not be read.');
  return items as Composition[];
}
async function saveLibrary(items: Composition[]) { if (window.projectionLibrary) await window.projectionLibrary.write(items); else localStorage.setItem(libraryKey, JSON.stringify(items)); listeners.forEach(fn => fn()); }
export async function listCompositions(): Promise<CompositionSummary[]> { return (await library()).map(c => ({ id: c.id, name: c.name, updatedAt: c.updatedAt, assets: c.contents.length + c.timers.length })); }
const unavailableHardware: HardwareStatus = { initialized: false, mode: 'demo', connection: 'disconnected', message: 'Open Hardware setup to inspect or connect the sensor.', provenance: 'unknown', busy: false, canAcquire: false, frames: 0, recording: false, capturing: false, sessions: [], geometrySolved: false };
async function inspect(): Promise<StudioSnapshot> {
  const snapshot = await bridge.getSnapshot(), scene = snapshot.scene;
  return {
    roomId: roomId(), sceneRevision: scene.revision, geometryRevision: scene.geometryRevision,
    ui: ui?.state() ?? { page: 'studio', view: 'room', inspector: 'assistant', fullscreen: !!document.fullscreenElement },
    output: snapshot.output, saveStatus: snapshot.saveStatus, saveError: snapshot.saveError,
    media: scene.contents.flatMap(c => {
      if (c.kind === 'youtube') { const state = readMediaState(c.id); return [{ ...state, contentId: c.id, source: window.projectionMedia ? 'youtube-watch' : 'embed-fallback', ready: state?.ready ?? false, frameReady: !!readMediaImage(c.id), status: state?.status ?? 'Source status unavailable; playback has not been verified.' }]; }
      if (c.kind !== 'media') return [];
      const source = localMediaSource(c.id), video = source?.element instanceof HTMLVideoElement ? source.element : null;
      return [{ contentId: c.id, source: 'local-' + c.config.mediaType, ready: source?.ready ?? false, frameReady: source?.ready ?? false, status: source?.error || (source?.ready ? 'Ready' : 'Loading stored asset'), playing: video ? !video.paused : false, muted: video?.muted ?? true, currentTime: video?.currentTime ?? 0, duration: c.config.duration }];
    }),
    assets: [...scene.contents, ...scene.timers].map(c => ({ id: c.id, title: c.title, kind: 'kind' in c ? c.kind : 'timer', surfaceId: c.surfaceId })),
    programs: programStatuses(),
    compositions: await listCompositions(), hardware: hardware?.status() ?? unavailableHardware,
    capabilities: { sceneBatch: !!agentBatch, observation: true, nativeMedia: !!window.projectionMedia, nativeOutput: !!window.projection, fileImportRequiresClick: true, physicalObservation: false },
  };
}
export async function executeStudio(operation: StudioOperation, actor: 'user' | 'agent' = 'agent'): Promise<StudioResult> {
  const snapshot = await bridge.getSnapshot();
  const result = (outcome: StudioResult['outcome'], message: string, value?: unknown): StudioResult => ({ ok: outcome !== 'failed', outcome, message, sceneRevision: snapshot.scene.revision, value });
  const handoff = (label: string, action: () => void) => {
    if (!ui) return result('failed', 'Open the Studio control interface first.');
    ui.handoff(label, action); return result('handoff', label + ' — click the action shown in Studio to continue.');
  };
  try {
    if (!operation || typeof operation !== 'object' || JSON.stringify(operation).length > 200000) throw new Error('Invalid Studio operation.');
    if (operation.type.startsWith('program.')) return programWorkshop.execute(operation as import('./shared/program').ProgramOperation);
    switch (operation.type) {
      case 'ui.navigate':
        if (!ui || !['studio', 'hardware'].includes(operation.page) || operation.view && !['room', 'arrange', 'align'].includes(operation.view)
          || operation.inspector && !['assistant', 'surface', 'content', 'projectors', 'viewer'].includes(operation.inspector)) throw new Error('Choose an available Studio view.');
        ui.navigate(operation); return result('applied', 'Studio view selected.');
      case 'ui.configure':
        if (!ui) throw new Error('Open the Studio control interface first.');
        for (const key of ['coverage', 'previews', 'interact', 'resetView'] as const) if (operation[key] !== undefined && typeof operation[key] !== 'boolean') throw new Error('Invalid view setting.');
        if (operation.expandedAssetId != null && ![...snapshot.scene.contents, ...snapshot.scene.timers].some(c => c.id === operation.expandedAssetId)) throw new Error('That asset no longer exists.');
        ui.configure(operation); return result('applied', 'Studio view settings updated.');
      case 'asset.import': return handoff('Choose a video or image', () => ui?.importAsset());
      case 'presentation':
        if (!['align', 'project', 'exit'].includes(operation.mode)) throw new Error('Choose Align, Project or Exit.');
        if (operation.mode === 'exit') { ui?.present('exit'); return result('applied', 'Returned to Studio.'); }
        return handoff(operation.mode === 'align' ? 'Align fullscreen' : 'Project fullscreen', () => ui?.present(operation.mode));
      case 'output.command':
        if (!['open', 'fullscreen', 'windowed'].includes(operation.command?.action)) throw new Error('Choose an output action.');
        if (!window.projection) return handoff('Open projection window', () => bridge.output(operation.command));
        await bridge.output(operation.command); return result('applied', 'Output window command accepted. Inspect output status to verify.');
      case 'media.command': {
        validateMediaCommand(operation.command);
        if (!snapshot.scene.contents.some(c => c.id === operation.command.contentId && c.kind === 'youtube')) throw new Error('Select an existing YouTube source.');
        if (!window.projectionMedia) throw new Error('Normal YouTube controls require the local video renderer.');
        if (operation.command.action === 'play') await window.projectionMedia.command({ contentId: operation.command.contentId, action: 'mute' });
        await window.projectionMedia.command(operation.command);
        return result('applied', 'Player command accepted; inspect readiness to verify playback.');
      }
      case 'composition.save': {
        const entries = await library(); if (entries.length >= 20) throw new Error('The composition library is full. Remove one before saving another.');
        const value = makeComposition(snapshot.scene, operation.name, crypto.randomUUID()); await saveLibrary([value, ...entries]);
        return result('applied', 'Composition saved on this device. Recall keeps current room geometry and starts media paused and muted.', { id: value.id, name: value.name });
      }
      case 'composition.remove': { const entries = await library(); if (!entries.some(c => c.id === operation.id)) throw new Error('Composition not found.'); await saveLibrary(entries.filter(c => c.id !== operation.id)); return result('applied', 'Saved composition removed.'); }
      case 'composition.recall':
      case 'scene.batch': {
        if (!agentBatch) throw new Error('Restart the updated local Studio to enable atomic scene actions.');
        const saved = operation.type === 'composition.recall' ? (await library()).find(c => c.id === operation.id) : undefined;
        if (operation.type === 'composition.recall' && !saved) throw new Error('Composition not found.');
        const commands = saved ? compositionCommands(snapshot.scene, saved) : operation.type === 'scene.batch' ? operation.commands : [];
        const receipt = await agentBatch(commands, operation.type === 'scene.batch' ? operation.expectedRevision : snapshot.scene.revision);
        if (!receipt.ok) throw new Error(receipt.error);
        let playbackWarning = false;
        if (saved && window.projectionMedia) for (const c of receipt.scene.contents.filter(c => c.kind === 'youtube' && snapshot.scene.contents.some(old => old.id === c.id && old.kind === 'youtube'))) {
          // A same-ID player can survive scene replacement. Explicitly stop its old playback.
          try { await window.projectionMedia.command({ contentId: c.id, action: 'mute' }); await window.projectionMedia.command({ contentId: c.id, action: 'pause' }); }
          catch { playbackWarning = true; }
        }
        if (actor === 'user') recordAdjustment({ id: crypto.randomUUID(), actor, roomId: roomId(), at: Date.now(), revision: receipt.scene.revision, geometryRevision: receipt.scene.geometryRevision, operation: operation.type, before: { assets: snapshot.scene.contents.length + snapshot.scene.timers.length }, after: { compositionId: saved?.id, name: saved?.name } });
        return { ...result('applied', saved ? playbackWarning ? 'Composition recalled and calibration retained. The existing player did not acknowledge pause/mute; check its controls before projecting.' : 'Composition recalled. Current calibration retained; playback paused and muted.' : 'Scene actions applied together.'), sceneRevision: receipt.scene.revision };
      }
      case 'hardware.action':
        if (!hardware) { ui?.navigate({ type: 'ui.navigate', page: 'hardware' }); return result('handoff', 'Hardware setup opened. Inspect it again once initialized.'); }
        if (operation.command.action === 'import-session' || operation.command.action === 'download-session') return handoff(operation.command.action === 'import-session' ? 'Choose a sensor recording' : 'Download selected recording', () => hardware!.execute(operation.command).then(() => {}));
        return result('applied', await hardware.execute(operation.command));
      default: throw new Error('Unknown Studio operation.');
    }
  } catch (error) { return result('failed', error instanceof Error ? error.message : 'Studio operation failed.'); }
}
export const studioPort: StudioPort = {
  inspect, execute: executeStudio,
  observe: async request => {
    const { scene } = await bridge.getSnapshot(), surface = getSurface(scene, request.surfaceId ?? scene.selectedSurfaceId);
    if (request.maxWidth !== undefined && (!Number.isFinite(request.maxWidth) || request.maxWidth < 160 || request.maxWidth > 960)) throw new Error('Preview width must be 160–960 pixels.');
    const width = Math.round(request.maxWidth ?? 768), height = Math.round(width * 9 / 16), at = Date.now();
    const limitations = ['Rendered surface composition, not a camera view or measurement of physical projection.', 'Perspective calibration, optical focus, wall reflectance and projector brightness are not verified by this image.'];
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, width, height);
    if (!scene.display?.blackout) { ctx.filter = `brightness(${scene.display?.brightness ?? 1})`; ctx.drawImage(getArtwork(scene, surface, at, true, false, width).canvas, 0, 0, width, height); }
    let image: Awaited<ReturnType<StudioPort['observe']>>['image'] = null;
    try { image = { mimeType: 'image/png', data: canvas.toDataURL('image/png').split(',')[1], width, height }; }
    catch { limitations.push('Pixels could not be read in this browser. No visual success is inferred.'); }
    const runtime = await inspect();
    for (const media of runtime.media) if (!media.frameReady) limitations.push(`${media.contentId}: live source frame unavailable; any placeholder is not proof of video playback.`);
    return { sceneRevision: scene.revision, geometryRevision: scene.geometryRevision, at, kind: 'rendered-surface', physical: false, surfaceId: surface.id, image, runtime, limitations, stale: runtime.sceneRevision !== scene.revision };
  },
};
