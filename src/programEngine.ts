import type { QuickJSContext, QuickJSHandle, QuickJSWASMModule } from 'quickjs-emscripten-core';
import { PROGRAM_LIMITS, programParameters, validateProgramDefinition, validateProgramDraw, type ProgramContext, type ProgramDefinition, type ProgramDraw, type ProgramReport } from './shared/program.js';

export interface ProgramFrame { state: unknown; commands: ProgramDraw[]; time: number; frameMs: number; randomSeed: number }
/** QuickJS has no browser/Node bindings. We expose no host functions or module loader. */
export class ProgramEngine {
  private vm: QuickJSContext;
  private runner!: QuickJSHandle;
  private deadline = 0;
  private disposed = false;
  constructor(module: QuickJSWASMModule, readonly definition: ProgramDefinition, readonly seed = 42) {
    validateProgramDefinition(definition);
    this.vm = module.newContext();
    this.vm.runtime.setMemoryLimit(PROGRAM_LIMITS.heapBytes);
    this.vm.runtime.setMaxStackSize(256 * 1024);
    this.vm.runtime.setInterruptHandler(() => performance.now() > this.deadline);
    this.deadline = performance.now() + 100;
    const source = `(function(){
      'use strict';
      const stringify=JSON.stringify, parse=JSON.parse;
      let randomSeed=${seed}; Math.random=()=>{randomSeed=(Math.imul(randomSeed,1664525)+1013904223)>>>0;return randomSeed/4294967296};
      const program=(${definition.source});
      if(!program||typeof program.init!=='function'||typeof program.update!=='function'||typeof program.draw!=='function') throw new Error('Provide init, update and draw functions.');
      let state, initialized=false;
      return function(encoded){
        const request=parse(encoded), ctx=request.ctx;
        if(!initialized){state=request.restore===undefined?program.init(ctx):request.restore.state;if(request.restore)randomSeed=request.restore.randomSeed;initialized=true;}
        if(request.update)state=program.update(state,ctx);
        const stateJSON=stringify(state);
        if(typeof stateJSON!=='string'||stateJSON.length>${PROGRAM_LIMITS.stateBytes})throw new Error('State must be bounded JSON.');
        const commands=program.draw(parse(stateJSON),ctx);
        const output=stringify({state:parse(stateJSON),commands,randomSeed});
        if(output.length>${PROGRAM_LIMITS.frameBytes})throw new Error('Frame exceeds its size limit.');
        return output;
      };
    })()`;
    const built = this.vm.evalCode(source, 'generated-program.js');
    if (built.error) { const error = this.error(built.error); this.vm.dispose(); this.disposed = true; throw error; }
    this.runner = built.value;
  }
  private error(handle: QuickJSHandle): Error {
    // String conversion stays inside the interpreter and its interrupt boundary.
    let detail = 'Program failed or exceeded its CPU/memory limit.';
    try {
      const message = this.vm.getProp(handle, 'message');
      try { if (this.vm.typeof(message) === 'string') detail = this.vm.getString(message).slice(0, 260); } finally { message.dispose(); }
      const stack = this.vm.getProp(handle, 'stack');
      try { if (this.vm.typeof(stack) === 'string') detail += ' ' + this.vm.getString(stack).slice(0,140); } finally { stack.dispose(); }
    } catch { /* An exhausted interpreter may not permit reading error details. */ }
    handle.dispose(); return new Error(detail);
  }
  frame(ctx: ProgramContext, update = true, restore?: unknown): ProgramFrame {
    if (this.disposed) throw new Error('Program runner is stopped.');
    const start = performance.now(); this.deadline = start + PROGRAM_LIMITS.stepMs;
    const argument = this.vm.newString(JSON.stringify({ ctx, update, restore }));
    const result = this.vm.callFunction(this.runner, this.vm.undefined, argument); argument.dispose();
    if (result.error) throw this.error(result.error);
    let value: { state: unknown; commands: unknown; randomSeed: number };
    try {
      const raw = this.vm.getString(result.value);
      if (raw.length > PROGRAM_LIMITS.frameBytes) throw new Error('Program frame is too large.');
      value = JSON.parse(raw);
    } finally { result.value.dispose(); }
    const stateJSON = JSON.stringify(value.state);
    if (typeof stateJSON !== 'string' || stateJSON.length > PROGRAM_LIMITS.stateBytes || !Number.isInteger(value.randomSeed) || value.randomSeed < 0 || value.randomSeed > 4294967295) throw new Error('Invalid or oversized program state.');
    validateProgramDraw(value.commands);
    return { randomSeed: value.randomSeed, state: value.state, commands: value.commands, time: ctx.time, frameMs: performance.now() - start };
  }
  dispose() { if (!this.disposed) { this.disposed = true; this.runner.dispose(); this.vm.dispose(); } }
}

export function testProgram(module: QuickJSWASMModule, definition: ProgramDefinition, surface: ProgramContext['surface']): ProgramReport {
  const report: ProgramReport = { passed: false, checks: [], frames: 0, meanStepMs: 0, maxStepMs: 0, samples: [] };
  let total = 0; const deadline = performance.now() + 4500;
  const record = (frame: ProgramFrame) => { if (performance.now() > deadline) throw new Error('Test exceeded the total time budget.'); report.frames++; total += frame.frameMs; report.maxStepMs = Math.max(report.maxStepMs, frame.frameMs); };
  let engine: ProgramEngine | undefined;
  try {
    validateProgramDefinition(definition);
    const ctx: ProgramContext = { time: 0, dt: 0, params: programParameters(definition), seed: 42, input: [], surface };
    engine = new ProgramEngine(module, definition);
    for (let i = 0; i <= 30; i++) {
      const frame = engine.frame({ ...ctx, time: i / 30, dt: i ? 1 / 30 : 0 }, i > 0); record(frame);
      if ([0,15,30].includes(i)) report.samples.push({ time: frame.time, commands: frame.commands });
    }
    report.checks.push({ name: 'Runtime and frame limits', passed: true, message: '31 timed frames validated. CPU, state, drawing and memory limits enforced.' });
    engine.dispose(); engine = undefined;
    for (const test of definition.tests) {
      engine = new ProgramEngine(module, definition); let time = 0;
      let frame = engine.frame(ctx, false); record(frame);
      for (const step of test.steps) { time += step.dt; frame = engine.frame({ ...ctx, time, dt: step.dt, input: step.input ?? [] }); record(frame); }
      for (const assertion of test.assertions) {
        let actual = frame.state;
        for (const key of assertion.path.split('.')) actual = actual && typeof actual === 'object' && Object.hasOwn(actual, key) ? (actual as Record<string, unknown>)[key] : undefined;
        const passed = assertion.op === 'eq' ? actual === assertion.value : typeof actual === 'number' && typeof assertion.value === 'number' && (assertion.op === 'gte' ? actual >= assertion.value : actual <= assertion.value);
        report.checks.push({ name: test.name + ': ' + assertion.path, passed, message: `${assertion.op} ${JSON.stringify(assertion.value)}; observed ${JSON.stringify(actual)?.slice(0,120) ?? 'missing'}` + (actual === undefined ? `; assertion paths start at the returned state, whose root keys are ${frame.state && typeof frame.state === 'object' ? Object.keys(frame.state).slice(0,16).join(', ') : '(none)'}. Do not prefix state. Draw commands are not state.` : '') });
      }
      engine.dispose(); engine = undefined;
    }
    for (const parameter of definition.parameters) for (const value of [parameter.min, parameter.max]) {
      engine = new ProgramEngine(module, definition);
      const probe = { ...ctx, params: { ...ctx.params, [parameter.key]: value } };
      record(engine.frame(probe, false));
      for (let i=1; i<=3; i++) record(engine.frame({ ...probe, time: i / 30, dt: 1 / 30 }));
      engine.dispose(); engine = undefined;
    }
    if (definition.parameters.length) report.checks.push({ name: 'Parameter bounds', passed: true, message: 'Each declared minimum and maximum executes with valid bounded drawing.' });
    report.passed = report.checks.every(c => c.passed);
  } catch (error) { report.checks.push({ name: 'Execution', passed: false, message: error instanceof Error ? error.message : 'Program could not run.' }); }
  finally { engine?.dispose(); }
  report.meanStepMs = total / Math.max(1, report.frames);
  return report;
}
