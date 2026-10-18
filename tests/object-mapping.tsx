import React,{useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {curvedFixture,curvedFrame,curvedSession} from './fixtures/curved-object';
import {ObjectRuntime} from '../src/objectRuntime';
import {ObjectMappingPanel} from '../src/ObjectMappingPanel';
import {ObjectProjection} from '../src/ObjectProjection';
import {RoomContinuity} from '../src/shared/roomModel';
import {initialScene} from '../src/shared/domain';
import {saveRoomReference} from '../src/roomModelStore';
import {SpatialView} from '../src/SpatialView';
import type {ProjectorFit} from '../src/shared/objectMapping';
import '../src/styles.css';import '../src/hardware.css';import '../src/spatial.css';import '../src/projection-output.css';
if(location.port!=='5175')throw new Error('Only run this analytic fixture on isolated port 5175.');
const delay=(ms:number)=>new Promise(r=>setTimeout(r,ms)),checks:string[]=[];
function assert(ok:unknown,name:string){if(!ok)throw new Error(name);checks.push('PASS '+name);}
async function until(fn:()=>boolean){for(let i=0;i<50;i++){if(fn())return;await delay(100);}throw new Error('Timed out waiting for state.');}
const fixture=curvedFixture(),continuity=new RoomContinuity();continuity.setReference(fixture.room);
const scene=initialScene();scene.surfaces[0]=fixture.surface;
function App(){
 const runtime=useRef<ObjectRuntime|null>(null),timer=useRef<ReturnType<typeof setInterval>|null>(null),offset=useRef(0),gone=useRef(false),active=useRef(false);
 const [frame,setFrame]=useState(curvedFrame()),[,refresh]=useState(0),[result,setResult]=useState('Ready. This test uses generated geometry only.'),[running,setRunning]=useState(false),[blackout,setBlackout]=useState(false);
 const current=useRef(frame);current.current=frame;
 useEffect(()=>{void saveRoomReference(fixture.room);runtime.current=new ObjectRuntime(()=>({room:fixture.room,live:active.current,busy:false,ready:continuity.status().canMap,outputs:[{outputId:'fixture-output',visible:true,fullscreen:!!document.fullscreenElement,width:innerWidth,height:innerHeight,devicePixelRatio,atMs:Date.now(),activeOwner:null,patternId:null}],nativeFullscreen:false}),r=>{continuity.trackingRegion=r;},()=>refresh(n=>n+1));return()=>{runtime.current?.dispose();if(timer.current)clearInterval(timer.current);};},[]);
 async function run(){setRunning(true);setResult('Running actual workers and fullscreen mask…');
 try{
  await document.documentElement.requestFullscreen();await delay(350);active.current=true;let sequence=0;
  timer.current=setInterval(()=>{const f=curvedFrame(offset.current,sequence++,Date.now(),{missing:gone.current});f.clockUncertaintyMs=250;continuity.observe(f,Date.now(),0);current.current=f;setFrame(f);runtime.current?.observe(f,0);},200);
  const fit=await new Promise<ProjectorFit>((resolve,reject)=>{const w=new Worker(new URL('../src/projectorFit.worker.ts',import.meta.url),{type:'module'});w.onmessage=({data})=>{w.terminate();data.error?reject(new Error(data.error)):resolve(data.fit);};w.onerror=()=>reject(new Error('Calibration worker failed'));w.postMessage({session:curvedSession(),room:fixture.room});});
  assert(fit.rmsPx<1,'Real 3D calibration worker passes independent fit checks');
  fit.viewport={width:innerWidth,height:innerHeight,devicePixelRatio};const w=Math.min(innerWidth,innerHeight*16/9),h=w*9/16;fit.rasterRect={x:(innerWidth-w)/2,y:(innerHeight-h)/2,width:w,height:h};runtime.current!.setFit(fit);
  await until(()=>continuity.status().canMap);
  assert(!!document.fullscreenElement,'Browser fullscreen remains active');assert(innerWidth===fit.viewport.width&&innerHeight===fit.viewport.height,'Fullscreen viewport remains unchanged');assert(fit.descriptor===fixture.room.descriptor,'Calibrated descriptor matches saved room');
  runtime.current!.select(current.current,.5,.675,fixture.surface,0);await until(()=>runtime.current!.status().canFill);
  assert(runtime.current!.status().object!.points>50,'Real tracking worker selects curved foreground above the table');
  const id=runtime.current!.status().object!.id;runtime.current!.fill(id,'#ff0000');await delay(70);
  const canvas=document.querySelector('canvas[aria-label="Tracked object projection"]') as HTMLCanvasElement;
  const redCount=()=>{const p=canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height).data;let n=0;for(let i=0;i<p.length;i+=4)if(p[i]>200&&p[i+1]<30&&p[i+2]<30)n++;return n;};
  await until(()=>redCount()>40);assert(!canvas.hidden&&redCount()>40,'Actual fullscreen pixels are red inside the measured mask');
  setBlackout(true);await delay(60);assert(redCount()===0&&!canvas.hidden,'Blackout overrides object color');setBlackout(false);await delay(60);assert(redCount()>40,'Leaving blackout restores only a fresh object mask');
  offset.current=.015;await delay(230);await until(()=>runtime.current!.status().canFill);assert(runtime.current!.status().object!.id===id,'Slow translation keeps the selected identity');assert(continuity.status().canMap,'Fixed background stays qualified during local motion');
  runtime.current!.fill(id,'#0044ff');await delay(80);assert(redCount()===0,'Changing object color replaces the same mask');
  gone.current=true;await delay(350);assert(runtime.current!.status().state==='lost','Disappearing target latches tracking loss');assert(redCount()===0&&!canvas.hidden,'Lost colored target stays in black output mode');
  gone.current=false;await delay(300);assert(runtime.current!.status().state==='lost','Returning target is not silently reacquired');
  runtime.current!.fill(id,null);await delay(100);assert(canvas.hidden,'Explicit clear restores the retained scene');runtime.current!.stop();offset.current=0;
  await delay(450);runtime.current!.select(current.current,.5,.675,fixture.surface,0);await until(()=>runtime.current!.status().canFill);const id2=runtime.current!.status().object!.id;runtime.current!.fill(id2,'#ff0000');await until(()=>redCount()>40);
  clearInterval(timer.current!);timer.current=null;await delay(650);assert(runtime.current!.status().state==='lost'&&redCount()===0&&!canvas.hidden,'Sensor stall independently blanks the output');
  runtime.current!.stop();await delay(50);assert(canvas.hidden,'Stop releases object projection');assert(scene.surfaces[0].id==='tabletop','Original scene surface retained');
  active.current=false;await document.exitFullscreen();setResult(`${checks.length} checks passed. Analytic geometry; no physical device used.`);
 }catch(e){setResult('FAILED '+String(e)+' Diagnostics: '+JSON.stringify({tracker:runtime.current?.status(),room:continuity.status(),fullscreen:!!document.fullscreenElement,viewport:[innerWidth,innerHeight,devicePixelRatio],fit:runtime.current?.fit?.viewport}));active.current=false;if(timer.current)clearInterval(timer.current);runtime.current?.stop();if(document.fullscreenElement)await document.exitFullscreen();}finally{setRunning(false);}}
 const status=runtime.current?.status()??{state:'uncalibrated' as const,message:'Ready for fixture',canFill:false};
 return <><header style={{position:'relative',zIndex:20000,padding:20,background:'#fafbf6'}}><h1>Curved object integration fixture</h1><button disabled={running} onClick={()=>void run()}>Run full-screen object checks</button><p role="status">{result}</p><pre>{checks.join('\n')}</pre></header><main className="hardware-workspace"><div style={{height:350}}><SpatialView scene={scene} view="orbit"/></div><ObjectMappingPanel status={status} frame={frame} region={runtime.current?.region} busy={running} canCalibrate={false} calibrate={()=>{}} select={(x,y)=>runtime.current?.select(current.current,x,y,fixture.surface,0)} fill={color=>runtime.current?.fill(status.object!.id,color)} stop={()=>runtime.current?.stop()}/></main><ObjectProjection outputId="fixture-output" blackout={blackout}/></>;
}
createRoot(document.getElementById('root')!).render(<App/>);
