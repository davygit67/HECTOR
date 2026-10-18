import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { getQuickJS } from 'quickjs-emscripten';
import { ProgramEngine, testProgram } from '../src/programEngine.ts';
import { programParameters, validateProgramDefinition, validateProgramDraw, type ProgramContext } from '../src/shared/program.ts';
import { orbit, ribbons, game } from './program-fixtures.ts';
import { programPoint } from '../src/shared/programInput.ts';
import { homography, project, type Quad } from '../src/shared/geometry.ts';
const modelAnimation = JSON.parse(readFileSync(new URL('./fixtures/generated-leprechauns.json',import.meta.url),'utf8'));
const module = await getQuickJS();
const ctx: ProgramContext = { time: 0, dt: 0, seed: 42, params: {}, input: [], surface: { width: 2, height: 1, measured: false } };
test('two original animations and a new game mechanic execute real QuickJS tests', () => {
  for (const definition of [orbit,ribbons,modelAnimation,game]) { const report = testProgram(module,definition,ctx.surface); assert.equal(report.passed,true,JSON.stringify(report.checks)); assert.equal(report.samples.length,3); assert.ok(report.frames >= 31); }
  const report = testProgram(module,orbit,ctx.surface); assert.notDeepEqual(report.samples[0].commands,report.samples[2].commands);
});
test('VM exposes no network, DOM, process, imports or bridge', () => {
  const definition = { ...game, source: `({init:()=>({types:[typeof fetch,typeof window,typeof document,typeof process,typeof require,typeof bridge,typeof WebSocket].join(',')}),update:s=>s,draw:()=>[]})` };
  const e = new ProgramEngine(module,definition); try { assert.deepEqual(e.frame(ctx,false).state,{types:Array(7).fill('undefined').join(',')}); } finally { e.dispose(); }
});
test('infinite init/update/draw, heap abuse and malformed drawing fail without poisoning later programs', () => {
  for (const source of [
    `(()=>{while(true){} })()`,
    `({init:()=>{while(true){}},update:s=>s,draw:()=>[]})`,
    `({init:()=>({}),update:s=>{while(true){}},draw:()=>[]})`,
    `({init:()=>({}),update:s=>s,draw:()=>{while(true){}}})`,
    `({init:()=>({x:new Array(4000000).fill('longlonglong')}),update:s=>s,draw:()=>[]})`,
    `({init:()=>({}),update:s=>s,draw:()=>Array(401).fill({op:'rect',x:0,y:0,w:1,h:1,fill:'#000'})})`,
    `({init:()=>({}),update:s=>s,draw:()=>[{op:'image',url:'https://example.com'}]})`,
    `({init:()=>({x:'x'.repeat(40000)}),update:s=>s,draw:()=>[]})`,
  ]) assert.equal(testProgram(module,{...game,source},ctx.surface).passed,false);
  assert.equal(testProgram(module,game,ctx.surface).passed,true);
});
test('pause/draw and parameter updates preserve score, checkpoints preserve random sequence', () => {
  const e = new ProgramEngine(module,game); const c = {...ctx,params:programParameters(game)};
  e.frame(c,false); const scored = e.frame({...c,input:[{type:'pointerdown',x:.2,y:.5}]});
  assert.equal((scored.state as {score:number}).score,2);
  assert.equal((e.frame({...c,params:{points:5}},false).state as {score:number}).score,2);
  assert.equal((e.frame({...c,params:{points:5},input:[{type:'pointerdown',x:.2,y:.5}]}).state as {score:number}).score,7);
  e.dispose();
  const def = {...game,source:`({init:()=>({n:Math.random()}),update:s=>({n:Math.random()}),draw:()=>[]})`};
  const a=new ProgramEngine(module,def),b=new ProgramEngine(module,def);a.frame(ctx,false);const saved=a.frame(ctx);b.frame(ctx,false,saved);assert.deepEqual(a.frame(ctx).state,b.frame(ctx).state);a.dispose();b.dispose();
});
test('failed behavioral assertions return actionable observed values', () => {
  const bad=structuredClone(game);bad.tests[0].assertions[0].value=99;const r=testProgram(module,bad,ctx.surface);assert.equal(r.passed,false);assert.match(r.checks.find(c=>!c.passed)!.message,/observed 2/);
});
test('schema rejects unbounded input, invalid colors and hostile assertion paths', () => {
  assert.throws(()=>validateProgramDefinition({...game,source:'x'.repeat(24001)}));
  assert.throws(()=>validateProgramDefinition({...game,tests:[{name:'bad',steps:[{dt:.1}],assertions:[{path:'__proto__.x',op:'eq',value:0}]}]}));
  assert.throws(()=>validateProgramDraw([{op:'rect',x:0,y:0,w:1,h:1,fill:'url(https://example.com)'}]));
  assert.throws(()=>programParameters(game,{points:100}));assert.throws(()=>programParameters(game,{unknown:1}));
});
test('pointer coordinates reverse a skewed projector transform into the asset coordinates',()=>{
  const quad:Quad=[{x:.1,y:.15},{x:.91,y:.08},{x:.8,y:.9},{x:.2,y:.85}], bounds={x:.2,y:.2,w:.6,h:.5};
  for(const p of [{x:.2,y:.4},{x:.8,y:.6}]) {const screen=project(homography(quad),{x:bounds.x+p.x*bounds.w,y:bounds.y+p.y*bounds.h});const actual=programPoint(quad,screen,bounds)!;assert.ok(Math.abs(actual.x-p.x)<1e-8);assert.ok(Math.abs(actual.y-p.y)<1e-8);}
});
