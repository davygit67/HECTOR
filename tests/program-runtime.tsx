import generatedLeprechauns from './fixtures/generated-leprechauns.json';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { initialScene, reduceScene } from '../src/shared/domain';
import { reduceBatch } from '../src/shared/studioScene';
import type { Snapshot } from '../src/shared/bridge';
import type { ProgramApplyValue, ProgramTestValue, ProgramDefinition } from '../src/shared/program';
import { orbit, ribbons, game } from './program-fixtures';
import '../src/styles.css';

// Isolated URL + fake scene bridge: no live room, video player or agent calls.
let scene = initialScene(), all: ((s: Snapshot) => void)[] = [];
const snapshot = (): Snapshot => ({ scene: structuredClone(scene), storage: 'browser', saveStatus: 'saved', saveError: null, displays: [], output: { open: false, fullscreen: false, displayId: null } });
window.projection = { getSnapshot: async () => snapshot(), subscribe: fn => { all.push(fn); return () => { all = all.filter(x=>x!==fn); }; }, output: async () => {}, dispatch: async c => { try { scene=reduceScene(scene,c); all.forEach(fn=>fn(snapshot())); return {ok:true,scene}; } catch(e) {return {ok:false,error:String(e)};} }, batch: async (commands,rev) => { try {scene=reduceBatch(scene,commands,rev); all.forEach(fn=>fn(snapshot())); return {ok:true,scene};} catch(e) {return {ok:false,error:String(e)};} } };
window.projectionChat = { getState: async()=>({ready:true,busy:false,configurationError:null,progress:null,messages:[]}),send:async()=>{},cancel:async()=>{},clear:async()=>{},subscribe:()=>()=>{},memory:async()=>({entries:[],events:[],enabled:false}) };
const library = new Map<string, import('../src/shared/program').ProgramArtifact>();
window.projectionPrograms = {read:async()=>[...library.values()],put:async a=>{library.set(a.id,a);}};
let progress:string|null=null;
window.projectionProgramState={read:async()=>progress,write:async value=>{progress=value;}};
const { SpatialStudio }=await import('../src/SpatialStudio');
const { studioPort }=await import('../src/studioRuntime');
const { readProgram, programInput }=await import('../src/programRuntime');
createRoot(document.getElementById('root')!).render(<SpatialStudio/>);
const checks=document.getElementById('checks')!;checks.style.cssText='padding:20px;background:#101827;color:white';
const button=document.createElement('button');button.textContent='Run generated program checks';checks.append(button);
const report=document.createElement('pre');report.id='check-results';checks.append(report);
const assert=(ok:unknown,label:string)=>{if(!ok)throw new Error(label);report.textContent+='PASS '+label+'\n';};
const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function until(fn:()=>boolean){for(let i=0;i<60;i++){if(fn())return;await wait(100);}throw new Error('Runtime did not become ready.');}
button.onclick=async()=>{button.disabled=true;report.textContent='';try{
  let id='';
  for(const definition of [orbit,ribbons,generatedLeprechauns as ProgramDefinition,game]){
    const revision=scene.revision;const tested=await studioPort.execute({type:'program.test',definition,surfaceId:'wall'});
    assert(tested.ok,definition.title+' executes in browser WASM worker: '+tested.message);
    const value=tested.value as ProgramTestValue;assert(value.preview?.data&&scene.revision===revision,'test returns real preview without modifying live scene');
    const image=document.createElement('img');image.src='data:image/png;base64,'+value.preview!.data;image.width=384;image.alt=definition.title+' offstage frames';checks.append(image);
    const applied=await studioPort.execute({type:'program.apply',testId:value.testId!,surfaceId:'wall',expectedRevision:revision});assert(applied.ok,'passing program applies');id=(applied.value as ProgramApplyValue).contentId;
    await until(()=>!!readProgram(id)?.frame);assert(readProgram(id)?.status.status==='paused','program is paused with a real initial frame');
  }
  await studioPort.execute({type:'ui.navigate',page:'studio',view:'arrange',inspector:'content'});
  await studioPort.execute({type:'ui.configure',expandedAssetId:id,interact:true});
  await window.projection!.dispatch({type:'surface.select',id:'wall'});
  await window.projection!.dispatch({type:'content.action',id,action:'start'});
  await wait(200);programInput(id,{type:'pointerdown',x:.2,y:.5});await until(()=>((readProgram(id)?.frame?.state as {score:number})?.score??0)===2);
  assert(true,'pointer event reaches custom game and changes its score');
  const configured=await studioPort.execute({type:'program.configure',contentId:id,parameters:{points:5}});assert(configured.ok,'live parameter change accepted');
  await wait(200);programInput(id,{type:'pointerdown',x:.2,y:.5});await until(()=>((readProgram(id)?.frame?.state as {score:number})?.score??0)===7);assert(true,'parameter change retains game progress');
  const observer=document.createElement('iframe');observer.title='Shared program output';observer.style.cssText='width:500px;height:340px;border:0';
  let followerScore=-1,observerReady=false;
  const receive=(event:MessageEvent)=>{if(event.origin!==location.origin||event.source!==observer.contentWindow)return;if(event.data.kind==='observer-ready'){observerReady=true;observer.contentWindow!.postMessage({kind:'scene',scene,id},location.origin);}if(event.data.kind==='observer-frame')followerScore=event.data.state.score;};
  window.addEventListener('message',receive);observer.src='./program-observer.html';checks.append(observer);
  await until(()=>observerReady&&followerScore===7);assert(true,'projection consumer receives the same game state without running a second simulation');
  observer.contentWindow!.postMessage({kind:'input'},location.origin);await until(()=>followerScore===12);assert((readProgram(id)?.frame?.state as {score:number}).score===12,'input from projection consumer scores once in the authoritative runtime');
  observer.remove();window.removeEventListener('message',receive);
  await window.projection!.dispatch({type:'content.action',id,action:'pause'});await wait(150);const t=readProgram(id)!.frame!.time;await wait(200);assert(readProgram(id)!.frame!.time===t,'pause freezes state and clock');
  const failed=await studioPort.execute({type:'program.test',surfaceId:'wall',definition:{...game,source:'({init:()=>{while(true){}},update:s=>s,draw:()=>[]})'}});assert(!failed.ok,'infinite code is stopped offstage');
  assert((readProgram(id)?.frame?.state as {score:number}).score===12,'failed candidate leaves current game untouched');
  const revision=scene.revision;const tested=await studioPort.execute({type:'program.test',surfaceId:'wall',definition:{...game,title:'Color gate revised'}});
  const applied=await studioPort.execute({type:'program.apply',testId:(tested.value as ProgramTestValue).testId!,surfaceId:'wall',contentId:id,expectedRevision:revision});assert(applied.ok,'tested revision replaces same asset');
  assert(scene.contents.length===4&&scene.contents.find(c=>c.id===id)?.config.parameters.points===5,'revision preserves other assets and compatible parameters');
  const rollback=await studioPort.execute({type:'program.rollback',contentId:id});assert(rollback.ok,'previous tested version restores');
  await until(()=>readProgram(id)?.status.status==='paused');
  const observation=await studioPort.observe({surfaceId:'wall',maxWidth:480});assert(!!observation.image&&observation.image.data.length>3000,'integrated surface renderer produces visible program pixels');
  report.textContent+='ALL CHECKS PASSED\n';
}catch(e){report.textContent+='FAIL '+String(e)+'\n';}finally{button.disabled=false;}};
