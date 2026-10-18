import { newQuickJSWASMModuleFromVariant, newVariant, type QuickJSWASMModule } from 'quickjs-emscripten-core';
import variant from '@jitl/quickjs-wasmfile-release-sync';
import wasmURL from '@jitl/quickjs-wasmfile-release-sync/wasm?url';
import { ProgramEngine, testProgram } from './programEngine';
import type { ProgramContext, ProgramDefinition } from './shared/program';

const modulePromise: Promise<QuickJSWASMModule> = newQuickJSWASMModuleFromVariant(newVariant(variant, { wasmLocation: wasmURL }));
let engine: ProgramEngine | undefined;
self.onmessage = async ({ data }: MessageEvent<{ id: number; action: 'test' | 'init' | 'frame'; definition?: ProgramDefinition; ctx: ProgramContext; restore?: unknown; update?: boolean }>) => {
  try {
    const module = await modulePromise;
    if (data.action === 'test') { self.postMessage({ id: data.id, value: testProgram(module, data.definition!, data.ctx.surface) }); return; }
    if (data.action === 'init') { engine?.dispose(); engine = new ProgramEngine(module, data.definition!, data.ctx.seed); }
    if (!engine) throw new Error('Initialize the program first.');
    self.postMessage({ id: data.id, value: engine.frame(data.ctx, data.action === 'init' ? false : data.update, data.restore) });
  } catch (error) { self.postMessage({ id: data.id, error: error instanceof Error ? error.message.slice(0, 400) : 'Program runner failed.' }); }
};
