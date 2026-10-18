/** Versioned, data-only contract. Generated source executes only in the isolated interpreter. */
export interface ProgramParameter { key: string; label: string; min: number; max: number; step: number; default: number }
export interface ProgramInput { type: 'pointerdown' | 'pointermove' | 'pointerup' | 'keydown' | 'keyup'; x?: number; y?: number; key?: string }
export interface ProgramContext { time: number; dt: number; params: Record<string, number>; seed: number; input: ProgramInput[]; surface: { width: number; height: number; measured: boolean } }
export interface ProgramAssertion { path: string; op: 'eq' | 'gte' | 'lte'; value: number | string | boolean }
export interface ProgramTest { name: string; steps: { dt: number; input?: ProgramInput[] }[]; assertions: ProgramAssertion[] }
export interface ProgramDefinition { sdkVersion: 1; title: string; description: string; source: string; parameters: ProgramParameter[]; tests: ProgramTest[] }
export type ProgramDraw =
  | { op: 'rect'; x: number; y: number; w: number; h: number; fill: string; alpha?: number }
  | { op: 'ellipse'; x: number; y: number; rx: number; ry: number; fill: string; alpha?: number }
  | { op: 'line'; x: number; y: number; x2: number; y2: number; width: number; color: string; alpha?: number }
  | { op: 'polygon' | 'polyline'; points: number[][]; color: string; width?: number; alpha?: number }
  | { op: 'text'; x: number; y: number; text: string; size: number; color: string; align?: 'left' | 'center' | 'right'; alpha?: number };
export interface ProgramVersion { artifactId: string; parameters: Record<string, number>; seed: number }
export interface ProgramConfig extends ProgramVersion { previous?: ProgramVersion[] }
export interface ProgramCheck { name: string; passed: boolean; message: string }
export interface ProgramReport { passed: boolean; checks: ProgramCheck[]; frames: number; meanStepMs: number; maxStepMs: number; samples: { time: number; commands: ProgramDraw[] }[] }
export interface ProgramArtifact { id: string; definition: ProgramDefinition; report: ProgramReport; createdAt: number }
export interface ProgramRuntimeStatus { contentId: string; artifactId: string; status: 'loading' | 'running' | 'paused' | 'error'; message: string; revision: number; time: number; state: unknown; frameMs: number }
export type ProgramOperation =
  | { type: 'program.test'; definition: ProgramDefinition; surfaceId: string }
  | { type: 'program.apply'; testId: string; surfaceId: string; contentId?: string; expectedRevision: number }
  | { type: 'program.inspect'; contentId: string }
  | { type: 'program.configure'; contentId: string; parameters: Record<string, number> }
  | { type: 'program.rollback'; contentId: string };
export const PROGRAM_LIMITS = { source: 24000, parameters: 12, tests: 6, steps: 90, commands: 400, points: 128, stateBytes: 32768, frameBytes: 180000, heapBytes: 16 * 1024 * 1024, stepMs: 25, artifacts: 30 } as const;
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const safeKey = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(v) && !['constructor', 'prototype', '__proto__'].includes(v);
function finite(v: unknown, min: number, max: number): asserts v is number { if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new Error(`Expected a finite number between ${min} and ${max}.`); }
function str(v: unknown, max: number): asserts v is string { if (typeof v !== 'string' || !v.trim() || v.length > max) throw new Error(`Expected text of 1–${max} characters.`); }
export function validateProgramInput(v: unknown): asserts v is ProgramInput {
  if (!obj(v) || !['pointerdown','pointermove','pointerup','keydown','keyup'].includes(String(v.type))) throw new Error('Unsupported program input.');
  if (String(v.type).startsWith('pointer')) { finite(v.x, 0, 1); finite(v.y, 0, 1); }
  else if (typeof v.key !== 'string' || !/^[a-zA-Z0-9 _-]{1,24}$/.test(v.key)) throw new Error('Invalid key input.');
}
export function validateProgramDefinition(v: unknown): asserts v is ProgramDefinition {
  if (!obj(v) || v.sdkVersion !== 1) throw new Error('Use Projection SDK version 1.');
  str(v.title, 60); str(v.description, 800); str(v.source, PROGRAM_LIMITS.source);
  if (!Array.isArray(v.parameters) || v.parameters.length > PROGRAM_LIMITS.parameters || !Array.isArray(v.tests) || v.tests.length > PROGRAM_LIMITS.tests) throw new Error('Program parameter/test limit exceeded.');
  const keys = new Set<string>();
  for (const p of v.parameters) {
    if (!obj(p) || !safeKey(p.key) || keys.has(p.key)) throw new Error('Use unique, simple parameter keys.');
    keys.add(p.key); str(p.label, 60); finite(p.min, -100000, 100000); finite(p.max, p.min, 100000); finite(p.step, .00001, 100000); finite(p.default, p.min, p.max);
  }
  for (const test of v.tests) {
    if (!obj(test)) throw new Error('Invalid test.'); str(test.name, 80);
    if (!Array.isArray(test.steps) || !test.steps.length || test.steps.length > PROGRAM_LIMITS.steps || !Array.isArray(test.assertions) || !test.assertions.length || test.assertions.length > 12) throw new Error('Tests need 1–90 steps and 1–12 assertions.');
    for (const s of test.steps) {
      if (!obj(s)) throw new Error('Invalid test step.'); finite(s.dt, 0, .25);
      if (s.input !== undefined) { if (!Array.isArray(s.input) || s.input.length > 16) throw new Error('Too many input events.'); s.input.forEach(validateProgramInput); }
    }
    for (const a of test.assertions) {
      if (!obj(a) || typeof a.path !== 'string' || a.path.length > 120 || !a.path.split('.').every(safeKey) || !['eq','gte','lte'].includes(String(a.op)) || !['string','number','boolean'].includes(typeof a.value)) throw new Error('Invalid state assertion.');
      if (typeof a.value === 'number') finite(a.value, -1e9, 1e9);
      if (typeof a.value === 'string' && a.value.length > 200) throw new Error('Assertion text is too long.');
      if (a.op !== 'eq' && typeof a.value !== 'number') throw new Error('Ordered assertions require a number.');
    }
  }
}
export function programParameters(def: ProgramDefinition, values: unknown = {}): Record<string, number> {
  if (!obj(values) || Object.keys(values).some(k => !def.parameters.some(p => p.key === k))) throw new Error('Unknown program parameter.');
  return Object.fromEntries(def.parameters.map(p => { const value = values[p.key] ?? p.default; finite(value, p.min, p.max); return [p.key, value]; }));
}
export function validateProgramConfig(v: unknown): asserts v is ProgramConfig {
  const version = (x: unknown) => {
    if (!obj(x) || typeof x.artifactId !== 'string' || !/^[a-f0-9]{64}$/.test(x.artifactId) || !obj(x.parameters) || Object.keys(x.parameters).length > PROGRAM_LIMITS.parameters) throw new Error('Choose a tested generated program.');
    for (const [key, value] of Object.entries(x.parameters)) { if (!safeKey(key)) throw new Error('Invalid parameter.'); finite(value, -100000, 100000); }
    if (Object.keys(x).some(k => !['artifactId','parameters','seed','previous'].includes(k))) throw new Error('Unsupported program version field.');
    finite(x.seed, 1, 65535); if (!Number.isInteger(x.seed)) throw new Error('Use an integer seed.');
  };
  if (!obj(v) || Object.keys(v).some(k => !['artifactId','parameters','seed','previous'].includes(k))) throw new Error('Program config contains only an artifact reference, parameters and version history.');
  version(v); const previous = (v as unknown as ProgramConfig).previous;
  if (previous !== undefined) { if (!Array.isArray(previous) || previous.length > 5) throw new Error('Keep at most five prior versions.'); previous.forEach(version); }
}
export function validateProgramDraw(value: unknown): asserts value is ProgramDraw[] {
  if (!Array.isArray(value) || value.length > PROGRAM_LIMITS.commands) throw new Error('Draw at most 400 primitives per frame.');
  let pointCount = 0;
  const color = (s: unknown) => { if (typeof s !== 'string' || !/^#(?:[a-f0-9]{3}|[a-f0-9]{6}|[a-f0-9]{8})$/i.test(s)) throw new Error('Use hex colors such as #88ccff.'); };
  for (const c of value) {
    if (!obj(c)) throw new Error('Invalid drawing command.');
    if (c.alpha !== undefined) finite(c.alpha, 0, 1);
    if (c.op === 'polygon' || c.op === 'polyline') {
      if (!Array.isArray(c.points) || c.points.length < 2 || c.points.length > PROGRAM_LIMITS.points) throw new Error('Paths need 2–128 points.');
      pointCount += c.points.length; if (pointCount > 8000) throw new Error('Frame path budget exceeded.');
      c.points.forEach(p => { if (!Array.isArray(p) || p.length !== 2) throw new Error('Use [x,y] points.'); p.forEach(n => finite(n, -4, 5)); });
      color(c.color); if (c.width !== undefined) finite(c.width, .0001, .2); continue;
    }
    finite(c.x, -4, 5); finite(c.y, -4, 5);
    switch (c.op) {
      case 'rect': finite(c.w, 0, 5); finite(c.h, 0, 5); color(c.fill); break;
      case 'ellipse': finite(c.rx, 0, 5); finite(c.ry, 0, 5); color(c.fill); break;
      case 'line': finite(c.x2, -4, 5); finite(c.y2, -4, 5); finite(c.width, .0001, .2); color(c.color); break;
      case 'text': if (typeof c.text !== 'string' || c.text.length > 200) throw new Error('Use at most 200 characters per label.'); finite(c.size, .005, .5); color(c.color); if (c.align !== undefined && !['left','center','right'].includes(String(c.align))) throw new Error('Invalid text alignment.'); break;
      default: throw new Error('Unsupported drawing command.');
    }
  }
}
export const PROGRAM_SDK_DOCUMENTATION = `Projection SDK 1: Create ORIGINAL local 2D animation or game code, not a preset. source is a JS expression evaluating to ({ init(ctx){ return JSONstate; }, update(state,ctx){ return JSONstate; }, draw(state,ctx){ return commands; } }). No imports or exports. No async, DOM, canvas, Node, fetch, files, timers, audio, assets or privileged APIs. Math/JSON/arrays/objects are available. Math.random is seeded. ctx={time:seconds,dt:seconds,params:{numeric values},seed,input:[events],surface:{width:meters,height:meters,measured:boolean}}. update MUST return state. draw MUST return an array. Use ctx.time for animation, ctx.dt for simulation, and JSON state for all persistent scores/entities; do not keep mutable game state in closures because only JSON state is saved. Runtime calls draw even while paused; don't mutate state in draw. Input is per-tick, not held-key state: maintain key/pointer state yourself. pointerdown/pointermove/pointerup carry x,y normalized to the content rectangle; keydown/keyup carry key (e.g. ArrowLeft or a). Draw coordinate origin is top-left, 0..1 spans this asset; shapes clip to the asset and surface. Colors MUST be hex (#rgb,#rrggbb,#rrggbbaa). Optional alpha 0..1. Commands: {op:'rect',x,y,w,h,fill,alpha?}; {op:'ellipse',x,y,rx,ry,fill,alpha?}; {op:'line',x,y,x2,y2,width,color,alpha?}; {op:'polygon'|'polyline',points:[[x,y],...],color,width?,alpha?}; {op:'text',x,y,text,size,color,align?:'left'|'center'|'right',alpha?}. Width/size normalized to content height; ellipses rx/ry normalized to width/height. Polygon filled, polyline stroked. Approximate curves with points. Background defaults transparent: explicitly draw a rect for opaque background. Max 400 commands, 128 points/path, 8000 total points, 200 chars/text, source 24000 chars, JSON state 32768 chars, 16MB heap, 25ms/call. Parameters: up to12 {key,label,min,max,step,default}. Tests: up to6 {name,steps:[{dt:0..0.25,input?:events[]}],assertions:[{path:'score' or 'player.score',op:'eq'|'gte'|'lte',value:number|string|boolean}]}; 1..90 steps,1..12 assertions each, fresh init per test; each test starts at time=0 with DEFAULT parameter values. Time accumulates by dt per step. There is no parameter-change field in test steps: never assert a changed parameter that no input/rule actually changes. For pointer hit tests, use dt=0 and the exact initialized target position to avoid moving the target before clicking. Assertion paths are relative to the JSON state returned by init/update: for {score:2} use path='score', NEVER 'state.score'. Draw commands are a separate return value, NOT available to state assertions: do not assert 'commands.length'. For animation-only smoke tests you may use tests:[]; runtime and drawing validation still run automatically. For an interactive game supply meaningful input replay and state assertions (not just a screenshot). Test on the intended surface; passing token binds current scene and geometry, and apply fails if changed. New/revised programs apply PAUSED. Start explicitly with content.action start when requested. Parameter changes preserve state; new source/rollback resets program state and pauses. No image/video generation, external textures, shaders, 3D or physical Kinect interactions in SDK1. Don't call static cutout translation rigged character animation. Test failures are data for repair, not fulfilled requests.`;

export interface ProgramTestValue { testId?: string; report: ProgramReport; sceneRevision: number; geometryRevision: number; surfaceId: string; preview?: { mimeType: 'image/png'; data: string; width: number; height: number } }
export interface ProgramInspectValue { definition: ProgramDefinition; artifactId: string; parameters: Record<string, number>; canRollback: boolean; runtime: ProgramRuntimeStatus | null }
export interface ProgramApplyValue { contentId: string; artifactId: string; version: string; paused: boolean; parameters: Record<string, number> }
