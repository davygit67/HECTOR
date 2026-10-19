import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import{initialScene,reduceScene}from'../src/shared/domain';import type{Snapshot,Bridge}from'../src/shared/bridge';
import{curvedFixture,curvedFrame,matrix}from'./fixtures/curved-object';import{projectCamera}from'../src/shared/objectMapping';
import{encodeSensorFrame}from'../src/shared/sensor';import{patternValue,type CalibrationPattern}from'../src/shared/calibrationPatterns';
import{saveRoomReference}from'../src/roomModelStore';import{PATTERN_CHANNEL}from'../src/patternOutput';
import'../src/styles.css';import'../src/hardware.css';import'../src/projection-output.css';
if(location.port!=='5175')throw new Error('Isolated 5175 fixture only.');
// Long captures can use a simulated fullscreen status; real fullscreen/pixels are
// separately exercised by object-mapping.html. Never enabled on the Studio origin.
const virtualFullscreen=new URLSearchParams(location.search).has('virtualFullscreen');
if(virtualFullscreen){Object.defineProperty(document,'fullscreenElement',{configurable:true,get:()=>document.documentElement});document.documentElement.requestFullscreen=async()=>{};document.exitFullscreen=async()=>{};}
const fixture=curvedFixture();let scene=initialScene();scene.surfaces[0]=fixture.surface;
const snapshot=():Snapshot=>({scene,storage:'browser',saveStatus:'saved',saveError:null,displays:[],output:{open:true,fullscreen:false,displayId:null}});
const bridge:Bridge={getSnapshot:async()=>snapshot(),subscribe:()=>()=>{},output:async()=>{},dispatch:async c=>{try{scene=reduceScene(scene,c);return{ok:true,scene};}catch(e){return{ok:false,error:String(e)};}}};window.projection=bridge;
const events:unknown[]=[];let pattern:CalibrationPattern|null=null;const patternTap=new BroadcastChannel(PATTERN_CHANNEL);patternTap.onmessage=({data})=>{events.push(data);if(events.length>15)events.shift();if(data.type==='present')pattern=data.pattern;if(data.type==='clear')pattern=null;};
const sockets:MockSocket[]=[];
class MockSocket{binaryType='';onmessage:((e:{data:unknown})=>void)|null=null;onclose:(()=>void)|null=null;onerror:(()=>void)|null=null;timer:ReturnType<typeof setInterval>;sequence=0;
 constructor(){sockets.push(this);setTimeout(()=>this.onmessage?.({data:JSON.stringify({protocol:'pm-sensor',version:1,type:'status',mode:'live',state:'streaming',message:'Analytic calibration fixture'})}),20);
 this.timer=setInterval(()=>{const f=curvedFrame(0,this.sequence++,Date.now());f.clockUncertaintyMs=250;if(pattern)for(let i=0;i<f.depth.length;i++){const uv=projectCamera(matrix,Array.from(f.cameraPoints!.subarray(i*3,i*3+3))as[number,number,number]);const v=uv.x>=0&&uv.x<1&&uv.y>=0&&uv.y<1?15+.85*patternValue(pattern,uv.x*pattern.width,uv.y*pattern.height):15;f.color.fill(Math.round(v),i*3,i*3+3);}this.onmessage?.({data:encodeSensorFrame(f).buffer});},200);}
 close(){clearInterval(this.timer);}}
window.WebSocket=MockSocket as unknown as typeof WebSocket;
const{HardwareWorkspace}=await import('../src/HardwareWorkspace');const{PatternOutput}=await import('../src/CalibrationOutput');const{executeStudio,studioPort}=await import('../src/studioRuntime');
const delay=(ms:number)=>new Promise(r=>setTimeout(r,ms)),checks:string[]=[];function assert(ok:unknown,name:string){if(!ok)throw new Error(name);checks.push('PASS '+name);}
async function until(fn:()=>Promise<boolean>){for(let i=0;i<40;i++){if(await fn())return;await delay(100);}throw new Error('Timed out waiting for Hardware status.');}
function App(){const[result,setResult]=useState('Ready: real Hardware UI and workers, simulated sensor.'),[running,setRunning]=useState(false);
 async function run(){setRunning(true);try{await document.documentElement.requestFullscreen();await saveRoomReference(fixture.room);await delay(400);
 assert((await executeStudio({type:'hardware.action',command:{action:'connect-live'}})).ok,'Real Hardware source connection');
 await until(async()=>!!(await studioPort.inspect()).hardware.roomModel?.canMap);
 assert((await executeStudio({type:'hardware.action',command:{action:'configure',settings:{resolution:'640x480',outputTarget:'output',settleMs:750}}})).ok,'Configure actual output capture');await delay(300);
 setResult('Capturing 40 real output patterns against the analytic camera (~50 seconds)…');
 const result=await executeStudio({type:'hardware.action',command:{action:'calibrate-projector'}});assert(result.ok,'Awaited Hardware calibration: '+result.message);
 await delay(800);const status=(await studioPort.inspect()).hardware.objectMapping;assert(status?.state==='ready'&&!!status.calibrationId,'3D fit flows through real Hardware status');
 const picker=document.querySelector('canvas[aria-label="Select an object in the registered camera image"]')as HTMLCanvasElement,r=picker.getBoundingClientRect();picker.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:r.left+r.width*.5,clientY:r.top+r.height*.675}));
 await until(async()=>!!(await studioPort.inspect()).hardware.objectMapping?.canFill);const id=(await studioPort.inspect()).hardware.objectMapping!.object!.id;assert(!!id,'Actual Hardware click selects object');
 const filled=await executeStudio({type:'hardware.action',command:{action:'fill-object',objectId:id,color:'#ff0000'}});assert(filled.ok,'Host revalidates and applies selected color');await delay(100);
 const canvas=document.querySelector('canvas[aria-label="Tracked object projection"]')as HTMLCanvasElement;const p=canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height).data;let red=0;for(let i=0;i<p.length;i+=4)if(p[i]>200&&p[i+1]<30)red++;assert(!canvas.hidden&&red>40,'Real output window receives red object pixels');
 assert((await executeStudio({type:'hardware.action',command:{action:'fill-object',objectId:id,color:null}})).ok,'Explicit clear through Hardware');await delay(80);assert(canvas.hidden,'Hardware clear restores scene');
 const observation=await studioPort.observeMapping!({});assert((await studioPort.inspect()).capabilities.mappingObservation&&observation.candidates.length===1&&!!observation.images.camera&&!!observation.images.depth,'Actual Studio port exposes paired camera/depth candidates');
 const chosen=await executeStudio({type:'mapping.select',observationId:observation.observationId,expectedRevision:observation.revision,candidateId:observation.candidates[0].id});assert(chosen.ok,'Measured candidate selection through actual Studio port');
 const selected=await studioPort.observeMapping!({}),selectedId=selected.selected.objectId!;assert(!!selectedId&&!!selected.images.projectorMask,'Actual port returns selected identity and computed mask');
 const refined=await executeStudio({type:'mapping.refine',observationId:selected.observationId,expectedRevision:selected.revision,objectId:selectedId,settings:{insetPx:2,featherPx:3}});assert(refined.ok&&(refined.value as {objectId:string}).objectId===selectedId,'Canonical receipt includes exact accepted MappingState');
 const stale=await executeStudio({type:'mapping.reset',observationId:selected.observationId,expectedRevision:selected.revision,objectId:selectedId});assert(!stale.ok,'Actual port rejects a consumed observation');
 const after=await studioPort.observeMapping!({});assert(after.selected.settings.insetPx===2&&after.selected.settings.featherPx===3&&after.selected.canUndo,'Actual post-inspection confirms refined settings');
 const undo=await executeStudio({type:'mapping.undo',observationId:after.observationId,expectedRevision:after.revision,objectId:selectedId});assert(undo.ok&&(undo.value as {settings:{insetPx:number}}).settings.insetPx===1,'Actual port undo restores measured default boundary');
 await executeStudio({type:'hardware.action',command:{action:'stop-object'}});await executeStudio({type:'hardware.action',command:{action:'disconnect'}});await document.exitFullscreen();setResult(`${checks.length} checks passed. Full Hardware integration; analytic input; ${virtualFullscreen?'simulated fullscreen status':'real fullscreen'}.`);
 }catch(e){setResult('FAILED '+String(e)+' '+JSON.stringify(events));await delay(200);await executeStudio({type:'hardware.action',command:{action:'stop-object'}});await executeStudio({type:'hardware.action',command:{action:'disconnect'}});if(document.fullscreenElement)await document.exitFullscreen();}finally{sockets.forEach(s=>s.close());setRunning(false);}}
 return <><header style={{position:'relative',zIndex:20000,background:'#fafbf6',padding:20}}><h1>Hardware object integration</h1><button disabled={running}onClick={()=>void run()}>Run Hardware calibration check</button><p role="status">{result}</p><pre>{checks.join('\n')}</pre></header><HardwareWorkspace snapshot={snapshot()}/><PatternOutput><div/></PatternOutput></>;
}createRoot(document.getElementById('root')!).render(<App/>);
