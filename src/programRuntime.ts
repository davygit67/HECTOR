import type { Scene } from './shared/domain';
import type { ProgramContent } from './shared/content';
import { programParameters, validateProgramInput, type ProgramContext, type ProgramInput, type ProgramRuntimeStatus } from './shared/program';
import { ProgramWorker } from './programClient';
import { getProgram } from './programStore';
import type { ProgramFrame } from './programEngine';

type Entry = { key: string; worker: ProgramWorker; input: ProgramInput[]; status: ProgramRuntimeStatus; frame?: ProgramFrame; busy: boolean; initialized: boolean; params: string; last: number };
type Checkpoint = { key: string; frame: ProgramFrame };
const entries = new Map<string, Entry>(), remote = new Map<string, { status: ProgramRuntimeStatus; frame?: ProgramFrame }>();
let scene: Scene | undefined, owner = false, started = false, control = false, stopped = false;
let channel: BroadcastChannel | undefined, release: (() => void) | undefined, checkpointAt = 0;
let persistenceWarning = '', lastSaved = '{}';
let checkpoints: Record<string, Checkpoint> = {};
const storageKey = 'projection-mapper.program-state.v1';
declare global { interface Window { projectionProgramState?: { read(): Promise<string | null>; write(value: string): Promise<void> } } }
const keyOf = (c: ProgramContent) => `${c.config.artifactId}:${c.state.epoch}`;
function publish(id: string, e: Entry) { if (!stopped) channel?.postMessage({ kind: 'frame', id, status: e.status, frame: e.frame }); }
export function readProgram(id: string) { return entries.get(id) ?? remote.get(id); }
export const programRevision = (id: string) => readProgram(id)?.status.revision ?? 0;
export const programStatuses = () => (scene?.contents ?? []).filter(c => c.kind === 'program').map(c => readProgram(c.id)?.status ?? { contentId: c.id, artifactId: c.config.artifactId, status: 'loading' as const, message: 'Waiting for the Studio program runtime.', revision: 0, time: 0, state: null, frameMs: 0 });
export function programInput(id: string, input: ProgramInput) {
  validateProgramInput(input);
  if (!owner) { channel?.postMessage({ kind: 'input', id, input }); return; }
  const e = entries.get(id), c = scene?.contents.find(c => c.id === id);
  if (!e || c?.kind !== 'program' || !c.state.clock.running || e.status.status === 'error') return;
  // Coalesce high-frequency motion without dropping discrete presses.
  if (input.type === 'pointermove' && e.input.at(-1)?.type === 'pointermove') e.input[e.input.length - 1] = input;
  else if (e.input.length < 32) e.input.push(input);
}
async function saveCheckpoints() {
  if (!owner) return;
  const value = JSON.stringify(Object.fromEntries([...entries].filter(([,e]) => e.frame).map(([id,e]) => [id, { key: e.key, frame: e.frame }])));
  if (value === lastSaved && !persistenceWarning) return;
  try { if (window.projectionProgramState) await window.projectionProgramState.write(value); else localStorage.setItem(storageKey, value); persistenceWarning = ''; lastSaved = value; }
  catch { persistenceWarning = ' · Progress could not be saved on this device.'; for (const [id,e] of entries) { if (!e.status.message.includes('could not be saved')) e.status.message += persistenceWarning; publish(id,e); } }
}
export function configurePrograms(next: Scene, isControl: boolean) {
  scene = next; control = isControl;
  if (!started) {
    started = true; channel = new BroadcastChannel('projection-mapper.program-runtime.v1');
    channel.onmessage = ({ data }) => {
      if (data.kind === 'frame' && !owner) remote.set(data.id, { status: data.status, frame: data.frame });
      if (data.kind === 'hello' && owner) entries.forEach((e,id) => publish(id,e));
      if (data.kind === 'input' && owner) { try { programInput(data.id, data.input); } catch { /* malformed input */ } }
    };
    channel.postMessage({ kind: 'hello' });
    if (control) void navigator.locks.request('projection-mapper.program-authority.v1', async () => {
      if (stopped) return;
      owner = true; remote.clear();
      try { checkpoints = JSON.parse((window.projectionProgramState ? await window.projectionProgramState.read() : localStorage.getItem(storageKey)) ?? '{}'); } catch { checkpoints = {}; }
      void tick();
      await new Promise<void>(resolve => { release = resolve; });
      owner = false;
    });
    window.addEventListener('pagehide', shutdown, { once: true });
  }
  for (const [id,e] of entries) if (!next.contents.some(c => c.id === id && c.kind === 'program' && keyOf(c) === e.key)) { e.worker.dispose(); entries.delete(id); }
}
async function step(c: ProgramContent, e: Entry) {
  if (e.busy || e.status.status === 'error' || !scene) return;
  const surface = scene.surfaces.find(s => s.id === c.surfaceId)!;
  const signature = JSON.stringify([c.config.parameters, surface.width, surface.height, c.bounds, c.state.clock.running]);
  if (e.initialized && !c.state.clock.running && e.params === signature) return;
  e.busy = true;
  try {
    const now = performance.now(), dt = e.initialized && c.state.clock.running ? Math.min(.05, (now - e.last) / 1000) : 0;
    const ctx: ProgramContext = { time: (e.frame?.time ?? 0) + dt, dt, params: c.config.parameters, seed: c.config.seed, input: e.input.splice(0,16), surface: { width: surface.width * c.bounds.w, height: surface.height * c.bounds.h, measured: surface.provenance === 'measured' } };
    let frame: ProgramFrame;
    if (!e.initialized) {
      const artifact = await getProgram(c.config.artifactId);
      ctx.params = programParameters(artifact.definition, c.config.parameters);
      const checkpoint = checkpoints[c.id];
      if (checkpoint?.key === e.key) ctx.time = checkpoint.frame.time;
      frame = await e.worker.init(artifact.definition, ctx, checkpoint?.key === e.key ? checkpoint.frame : undefined);
      e.initialized = true;
    } else frame = await e.worker.frame(ctx, c.state.clock.running);
    if (entries.get(c.id) !== e) return;
    e.frame = frame; e.params = signature; e.last = now;
    e.status = { contentId: c.id, artifactId: c.config.artifactId, status: c.state.clock.running ? 'running' : 'paused', message: (c.state.clock.running ? 'Running locally' : 'Paused') + persistenceWarning, revision: e.status.revision + 1, time: frame.time, state: frame.state, frameMs: frame.frameMs };
  } catch (error) {
    e.worker.dispose(); e.status = { ...e.status, status: 'error', message: error instanceof Error ? error.message : 'Program stopped.', revision: e.status.revision + 1 };
  } finally { e.busy = false; publish(c.id,e); }
}
async function tick() {
  if (!owner || stopped || !scene) return;
  for (const c of scene.contents) if (c.kind === 'program') {
    let e = entries.get(c.id);
    if (!e) { e = { key: keyOf(c), worker: new ProgramWorker(), input: [], busy: false, initialized: false, params: '', last: performance.now(), status: { contentId: c.id, artifactId: c.config.artifactId, status: 'loading', message: 'Loading tested program', revision: 0, time: 0, state: null, frameMs: 0 } }; entries.set(c.id, e); }
    void step(c,e);
  }
  if (performance.now() - checkpointAt > 1000) { checkpointAt = performance.now(); void saveCheckpoints(); }
  setTimeout(() => { void tick(); }, scene.contents.some(c => c.kind === 'program' && c.state.clock.running) ? 33 : 120);
}
function shutdown() { stopped = true; void saveCheckpoints(); entries.forEach(e => e.worker.dispose()); channel?.close(); release?.(); }
if (import.meta.hot) import.meta.hot.dispose(shutdown);
