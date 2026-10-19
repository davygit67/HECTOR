import React,{useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {MappingWorkshop} from '../src/mappingWorkshop';
import {MappingWorkshopPanel} from '../src/MappingWorkshopPanel';
import {ObjectRuntime} from '../src/objectRuntime';
import {ObjectProjection} from '../src/ObjectProjection';
import {RoomContinuity} from '../src/shared/roomModel';
import {curvedFixture,curvedFrame} from './fixtures/curved-object';
import type {SensorFrame} from '../src/shared/sensor';
import '../src/styles.css';import '../src/hardware.css';import '../src/projection-output.css';
if(location.port!=='5175')throw new Error('Use only isolated5175 for analytic geometry tests.');
const simulated=new URLSearchParams(location.search).has('virtualFullscreen');
if(simulated)Object.defineProperty(document,'fullscreenElement',{configurable:true,get:()=>document.documentElement});
const fixture=curvedFixture(),continuity=new RoomContinuity();continuity.setReference(fixture.room);
const delay=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function until(fn:()=>boolean){for(let n=0;n<100;n++){if(fn())return;await delay(50);}throw new Error('State did not settle');}
function App(){
  const runtime=useRef<ObjectRuntime|null>(null),workshop=useRef<MappingWorkshop|null>(null),frame=useRef(curvedFrame()),feed=useRef(true),live=useRef(true),shift=useRef(0),waiters=useRef<((f:SensorFrame)=>void)[]>([]);
  const [,refresh]=useState(0),[result,setResult]=useState('Ready'),[busy,setBusy]=useState(false);const checks=useRef<string[]>([]);
  useEffect(()=>{
    runtime.current=new ObjectRuntime(()=>({room:fixture.room,live:live.current,ready:continuity.status().canMap,busy:false,outputs:[{outputId:'fixture-output',visible:true,fullscreen:!!document.fullscreenElement,width:innerWidth,height:innerHeight,devicePixelRatio,atMs:Date.now(),activeOwner:null,patternId:null}],nativeFullscreen:false}),r=>{continuity.trackingRegion=r;},()=>refresh(n=>n+1));
    workshop.current=new MappingWorkshop(()=>({runtime:runtime.current!,room:fixture.room,surface:fixture.surface,generation:0,live:live.current,ready:continuity.status().canMap,busy:false}),()=>new Promise(resolve=>waiters.current.push(resolve)),()=>refresh(n=>n+1));
    let sequence=0;const timer=setInterval(()=>{if(!feed.current)return;const f=curvedFrame(shift.current,sequence++,Date.now());f.clockUncertaintyMs=250;frame.current=f;continuity.observe(f,Date.now(),0);runtime.current?.observe(f,0);for(const resolve of waiters.current.splice(0))resolve(f);},200);
    return()=>{clearInterval(timer);workshop.current?.dispose();runtime.current?.dispose();};
  },[]);
  async function prepare(){shift.current=0;feed.current=true;live.current=true;if(!simulated)await document.documentElement.requestFullscreen();await delay(350);const fit=structuredClone(fixture.fit);fit.viewport={width:innerWidth,height:innerHeight,devicePixelRatio};fit.rasterRect={x:0,y:0,width:innerWidth,height:innerHeight};runtime.current!.setFit(fit);await until(()=>continuity.status().canMap);}
  async function inspectFixture(){setBusy(true);try{await prepare();await workshop.current!.observe();setResult('Analytic fixture ready for manual inspection. No physical sensor.');}catch(e){setResult(String(e));}finally{setBusy(false);}}
  async function run(){setBusy(true);checks.current=[];const check=(condition:unknown,label:string)=>{if(!condition)throw new Error(label);checks.current.push('PASS '+label);setResult(checks.current.join('\n'));};
    try{
      await prepare();
      const first=await workshop.current!.observe();check(first.candidates.length===1&&first.candidates[0].selectable,'Paired camera/depth discovers one selectable measured candidate');
      check(!!first.images.camera?.data&&!!first.images.depth?.data&&!!first.images.overlay?.data&&!first.images.projectorMask,'Registered photos and computed overlay are separate PNGs');
      const select={type:'mapping.select' as const,observationId:first.observationId,expectedRevision:first.revision,candidateId:first.candidates[0].id};
      const selected=await workshop.current!.execute(select);check(!!selected.value.objectId&&runtime.current!.status().canFill,'Selection waits for a fresh tracked object and returns its revision');
      let denied=false;try{await workshop.current!.execute(select);}catch{denied=true;}check(denied,'Consumed observation cannot select again');
      const id=selected.value.objectId!;runtime.current!.fill(id,'#ff0000');await delay(80);
      const canvas=document.querySelector('canvas[aria-label="Tracked object projection"]') as HTMLCanvasElement;
      const pixels=()=>{const data=canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height).data;let lit=0,soft=0;for(let i=0;i<data.length;i+=4){if(data[i])lit++;if(data[i]>0&&data[i]<255)soft++;}return{lit,soft};};
      await until(()=>pixels().lit>0);const before=pixels().lit;check(before>0,'Selected color reaches actual output canvas');
      const observed=await workshop.current!.observe();check(!!observed.images.projectorMask&&observed.selected.objectId===id,'Inspection pairs current selected identity with computed projector mask');
      const op={type:'mapping.refine' as const,objectId:id,observationId:observed.observationId,expectedRevision:observed.revision,settings:{insetPx:2,featherPx:3,trim:{left:.1,top:0,right:0,bottom:0}}};
      const changed=await workshop.current!.execute(op);await delay(70);check(changed.value.revision>observed.revision&&changed.value.objectId===id,'Refinement preserves identity and advances mapping revision');
      check(pixels().lit>0&&pixels().lit<before&&pixels().soft>0,'Trim/inset shrink visible light and feather produces inward gradient pixels');
      denied=false;try{await workshop.current!.execute(op);}catch{denied=true;}check(denied,'Old inspection cannot issue another refinement');
      const after=await workshop.current!.observe();check(after.selected.settings.insetPx===2&&after.selected.canUndo&&!!after.images.projectorMask,'After-inspection shows resulting settings and comparison mask');
      const undo=await workshop.current!.execute({type:'mapping.undo',objectId:id,observationId:after.observationId,expectedRevision:after.revision});await delay(70);check(undo.value.settings.insetPx===1&&undo.value.settings.trim.left===0&&pixels().lit===before,'Undo restores settings and original measured footprint');
      const resetObs=await workshop.current!.observe();await workshop.current!.execute({type:'mapping.reset',objectId:id,observationId:resetObs.observationId,expectedRevision:resetObs.revision});check(runtime.current!.mappingState().settings.featherPx===0,'Reset returns conservative default edges');
      const beforeMove=await workshop.current!.observe();shift.current=.02;await delay(220);const beforeRejected=runtime.current!.mappingState();denied=false;
      try{await workshop.current!.execute({type:'mapping.refine',objectId:id,observationId:beforeMove.observationId,expectedRevision:beforeMove.revision,settings:{insetPx:3}});}catch{denied=true;}
      check(denied&&runtime.current!.mappingState().revision===beforeRejected.revision,'Fresh object movement rejects refinement without changing settings');
      live.current=false;runtime.current!.disconnect();let failed=false;try{await workshop.current!.observe();}catch{failed=true;}check(failed&&workshop.current!.latest===null,'Disconnected inspection suppresses stale images and tokens');
      await delay(80);check(!canvas.hidden&&pixels().lit===0,'Lost target remains black after refinement');runtime.current!.fill(id,null);await delay(50);check(canvas.hidden,'Explicit clear restores retained scene output');
      runtime.current!.stop();feed.current=false;setResult(`${checks.current.length} checks passed. Analytic geometry; ${simulated?'explicitly simulated fullscreen status':'actual fullscreen'}.\n`+checks.current.join('\n'));if(!simulated)await document.exitFullscreen();
    }catch(e){setResult('FAILED '+String(e)+'\n'+checks.current.join('\n')+'\n'+JSON.stringify(runtime.current?.status()));feed.current=false;runtime.current?.stop();if(!simulated&&document.fullscreenElement)await document.exitFullscreen();}finally{setBusy(false);}
  }
  return <><header style={{padding:20,position:'relative',zIndex:20000,background:'#fafbf6'}}><h1>Object workshop fixture</h1><p>{simulated?'Explicit simulated fullscreen status. Real workers and rendered pixels; no physical sensor.':'Actual browser fullscreen test. No physical sensor.'}</p><button disabled={busy} onClick={()=>void run()}>Run workshop checks</button><button disabled={busy} onClick={()=>void inspectFixture()}>Prepare UI inspection</button><pre role="status">{result}</pre></header><main className="hardware-workspace"><MappingWorkshopPanel observation={workshop.current?.latest??null} state={runtime.current?.mappingState()} available={!busy} inspect={()=>workshop.current!.observe()} execute={op=>workshop.current!.execute(op)}/></main><ObjectProjection outputId="fixture-output"/></>;
}
createRoot(document.getElementById('root')!).render(<App/>);
