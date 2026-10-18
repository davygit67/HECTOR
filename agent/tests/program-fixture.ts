import { createHash } from 'node:crypto';
import { newQuickJSWASMModuleFromVariant } from 'quickjs-emscripten-core';
import variant from '@jitl/quickjs-wasmfile-release-sync';
import type { QuickJSSyncVariant } from '@jitl/quickjs-ffi-types';
import { initialScene, reduceScene, type Command } from '../../src/shared/domain.js';
import { reduceBatch } from '../../src/shared/studioScene.js';
import { ProgramService } from '../../src/programService.js';
import { testProgram } from '../../src/programEngine.js';
import type { ProgramArtifact, ProgramDefinition, ProgramOperation } from '../../src/shared/program.js';
import type { StudioPort, StudioSnapshot } from '../../src/shared/studio.js';
import type { CanvasPort } from '../src/canvas.js';

/** Isolated adapter using the real interpreter, program service and scene reducers.
 * Artifacts are in memory; no browser, disk library or live projection is connected. */
export async function programFixture() {
  // Package CJS declaration wraps the default; its Node ESM export is the variant itself.
  const module = await newQuickJSWASMModuleFromVariant(variant as unknown as QuickJSSyncVariant);
  let scene = initialScene(1000), afterTest: (() => void) | undefined;
  const artifacts = new Map<string, ProgramArtifact>(), operations: ProgramOperation[] = [];
  const commands: Command[] = [];
  const dispatch: CanvasPort['dispatch'] = async command => {
    try { scene = reduceScene(scene, command, 1000); commands.push(command); return { ok: true, scene: structuredClone(scene) }; }
    catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'Rejected' }; }
  };
  const inspect = async (): Promise<StudioSnapshot> => ({
    roomId: 'isolated-program-test', sceneRevision: scene.revision, geometryRevision: scene.geometryRevision,
    ui: { page: 'studio', view: 'arrange', inspector: 'assistant', fullscreen: false },
    output: { open: false, fullscreen: false, displayId: null }, saveStatus: 'saved', saveError: null,
    media: [], assets: [], compositions: [], programs: [],
    hardware: { initialized: false, mode: 'demo', connection: 'off', message: 'Disconnected', provenance: 'unknown', busy: false, canAcquire: false, frames: 0, recording: false, capturing: false, sessions: [], geometrySolved: false },
    capabilities: { sceneBatch: true, observation: false, nativeMedia: false, nativeOutput: false, fileImportRequiresClick: true, physicalObservation: false },
  });
  const service = new ProgramService({
    scene: async () => structuredClone(scene),
    batch: async (batch, revision) => {
      try { scene = reduceBatch(scene, batch, revision, 1000); commands.push(...batch); return { ok: true, scene: structuredClone(scene) }; }
      catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'Rejected' }; }
    },
    test: async definition => { const report = testProgram(module, definition, { width: 4.6, height: 2.6, measured: false }); afterTest?.(); return report; },
    put: async (definition, report) => {
      const id = createHash('sha256').update(JSON.stringify(definition)).digest('hex');
      const artifact = { id, definition: structuredClone(definition), report: structuredClone(report), createdAt: 1000 };
      artifacts.set(id, artifact); return artifact;
    },
    get: async id => { const found = artifacts.get(id); if (!found) throw new Error('Missing test artifact'); return structuredClone(found); },
    runtime: () => null,
  });
  const studio: StudioPort = {
    inspect,
    execute: async operation => {
      if (!operation.type.startsWith('program.')) throw new Error('Only program operations are connected in this isolated fixture.');
      operations.push(operation as ProgramOperation); return service.execute(operation as ProgramOperation);
    },
    observe: async request => ({ kind: 'rendered-surface', physical: false, sceneRevision: scene.revision,
      geometryRevision: scene.geometryRevision, at: 1000, surfaceId: request.surfaceId ?? 'wall', stale: false,
      image: null, runtime: await inspect(), limitations: ['No renderer is connected to this isolated interpreter fixture.'] }),
  };
  const port: CanvasPort = { studio, dispatch,
    getSnapshot: async () => ({ scene: structuredClone(scene), saveStatus: 'saved', saveError: null, storage: 'browser', displays: [], output: { open: false, fullscreen: false, displayId: null } }) };
  return { port, service, artifacts, operations, commands, scene: () => structuredClone(scene),
    afterTest: (callback?: () => void) => { afterTest = callback; } };
}

export const clickingGarden: ProgramDefinition = {
  sdkVersion: 1, title: 'Clicking garden', description: 'A simple original click counter with a moving clover-colored circle.',
  parameters: [{ key: 'speed', label: 'Speed', min: .1, max: 3, step: .1, default: 1 }],
  source: `({
    init(ctx) { return {score:0, x:.5}; },
    update(state,ctx) { return {score:state.score+ctx.input.filter(e=>e.type==='pointerdown').length, x:.5+.3*Math.sin(ctx.time*ctx.params.speed)}; },
    draw(state,ctx) { return [{op:'ellipse',x:state.x,y:.5,rx:.08,ry:.08,fill:'#35ad55'}, {op:'text',x:.5,y:.8,text:String(state.score),size:.08,color:'#ffffff',align:'center'}]; }
  })`,
  tests: [{ name: 'Only pointer down scores', steps: [{ dt: .016, input: [{ type: 'pointermove', x: .5, y: .5 }, { type: 'pointerdown', x: .5, y: .5 }] }], assertions: [{ path: 'score', op: 'eq', value: 1 }] }],
};

export function toolDefinition(definition: ProgramDefinition = clickingGarden) {
  const copy = structuredClone(definition);
  return { ...copy, tests: copy.tests.map(t => ({ ...t, steps: t.steps.map(s => ({ ...s, input: s.input ?? null })) })) };
}
