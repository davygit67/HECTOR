import type { SensorFrame } from './shared/sensor';
import type { RoomReference } from './shared/roomModel';
import type { Surface } from './shared/spatial';
import { fitMatchesRoom, type ProjectorFit, type ObjectMappingStatus, type ObjectObservation, type ObjectPreview } from './shared/objectMapping';
import { trackingRegion } from './shared/objectTracking';
import { PATTERN_CHANNEL, type PatternOutputStatus } from './patternOutput';
import { DEFAULT_MAPPING_SETTINGS, mappingSettings, type MappingSettings, type MappingState } from './shared/mappingWorkshop';

let preview:ObjectPreview|null=null, revision=0;
export const getObjectPreview=()=>preview;
export const objectPreviewRevision=()=>revision;
function showPreview(value:ObjectPreview|null){preview=value;revision++;}
interface Context { room:RoomReference|null; live:boolean; busy:boolean; ready:boolean; outputs:PatternOutputStatus[]; nativeFullscreen:boolean; }
/** One worker job in flight; stale work is discarded rather than queued behind the camera. */
export class ObjectRuntime {
  fit:ProjectorFit|null=null; region:ReturnType<typeof trackingRegion>|undefined;
  private worker:Worker|null=null; private working=false; private selected:{id:string;name:string;color:string|null}|null=null;
  private observation:ObjectObservation|null=null; private lost=''; private epoch=0; private sourceGeneration=-1;
  private selectionAt=0;
  private mappingRevision=0;private settingsRevision=0;private maskRevision=-1;
  private settings:MappingSettings=structuredClone(DEFAULT_MAPPING_SETTINGS);private history:MappingSettings[]=[];
  private pendingInit:{room:RoomReference;fit:ProjectorFit;surface:Surface;region:ReturnType<typeof trackingRegion>;seed:{x:number;y:number}}|null=null;
  private channel=new BroadcastChannel(PATTERN_CHANNEL); private ownerId=crypto.randomUUID(); private timer:ReturnType<typeof setInterval>;
  private counter=0; private projectionActive=false;
  constructor(private context:()=>Context,private regionChanged:(region:ReturnType<typeof trackingRegion>|undefined)=>void,private changed:()=>void) {
    this.timer=setInterval(()=>{if(this.selected&&!this.lost&&(this.observation?Date.now()-this.observation.capturedAtMs>500:Date.now()-this.selectionAt>1000))this.fail('Sensor frames stopped. Projection is black; select the object again.');
      if(this.selected&&!this.lost&&!this.eligible())this.fail('The room, sensor or projector output is no longer qualified.');
    },150);
  }
  private eligible() {const c=this.context(),f=this.fit;return !!f&&c.live&&!c.busy&&c.ready&&fitMatchesRoom(f,c.room)&&c.outputs.some(o=>o.outputId===f.outputId&&o.visible&&(o.fullscreen||c.nativeFullscreen)&&!o.activeOwner&&Date.now()-o.atMs<1800&&o.width===f.viewport.width&&o.height===f.viewport.height&&o.devicePixelRatio===f.viewport.devicePixelRatio);}
  canSelect(){return this.eligible();}
  setFit(fit:ProjectorFit){this.stop();this.fit=fit;this.changed();}
  clearFit(){this.stop();this.fit=null;this.changed();}
  status():ObjectMappingStatus {
    const ageMs=this.observation?Math.max(0,Date.now()-this.observation.capturedAtMs+this.observation.clockUncertaintyMs):undefined;
    const canFill=!!this.selected&&!this.lost&&!!this.observation&&ageMs!==undefined&&ageMs<=500&&this.maskRevision===this.settingsRevision&&this.eligible();
    return {state:!this.fit?'uncalibrated':this.lost?'lost':this.selected?(canFill?'tracking':'blocked'):this.eligible()?'ready':'blocked',
      message:!this.fit?'Calibrate the projector in 3D, then click a separate object above a measured table.':this.lost||(!this.selected?(this.eligible()?'3D fit ready. Click an object in the camera image.':'3D fit retained. Restore the same live room and full-screen output, or recalibrate.'):canFill?'Tracking visible shape. Slow movement only.':'Waiting for a fresh, qualified object observation.'),
      calibrationId:this.fit?.id,rmsPx:this.fit?.rmsPx,ageMs,canFill,object:this.selected?{...this.selected,points:this.observation?.points??0,speedMps:this.observation?.speedMps??0}:undefined,workshop:this.mappingState()};
  }
  mappingState():MappingState{return{revision:this.mappingRevision,objectId:this.selected?.id??null,settings:structuredClone(this.settings),canUndo:this.history.length>0};}
  measuredCenter(){return this.observation&&!this.lost?this.observation.center:undefined;}
  refine(objectId:string,expectedRevision:number,action:'refine'|'undo'|'reset',patch?:Partial<MappingSettings>){
    if(expectedRevision!==this.mappingRevision||!this.selected||objectId!==this.selected.id||!this.status().canFill)throw new Error('The selected mapping changed or is not fresh. Inspect it again.');
    const next=action==='undo'?this.history.at(-1):action==='reset'?structuredClone(DEFAULT_MAPPING_SETTINGS):mappingSettings(this.settings,patch!);
    if(!next)throw new Error('No edge adjustment to undo.');
    if(action==='undo')this.history.pop();else{this.history.push(structuredClone(this.settings));if(this.history.length>10)this.history.shift();}
    this.settings=structuredClone(next);this.mappingRevision++;this.settingsRevision++;this.publish();this.changed();
    return 'Measured edge settings updated. Inspect the new camera and computed mask; physical alignment is not verified.';
  }
  select(_frame:SensorFrame,x:number,y:number,surface:Surface,generation:number,expected?:{center:import('./shared/spatial').Vec3;extent:import('./shared/spatial').Vec3;points:number}) {
    if(!this.eligible()||!this.fit)throw new Error('Calibrate with the live room and keep the same output full screen before selecting an object.');
    this.stop();this.region=trackingRegion(x,y);this.regionChanged(this.region);this.sourceGeneration=generation;
    this.selected={id:crypto.randomUUID(),name:'Selected object',color:null};this.lost='';this.selectionAt=Date.now();const epoch=++this.epoch;
    this.worker=new Worker(new URL('./objectTracking.worker.ts',import.meta.url),{type:'module'});
    this.worker.onmessage=({data})=>{if(epoch!==this.epoch)return;this.working=false;
      if(data.error){this.fail(data.error);return;}
      const value=data.observation as ObjectObservation;
      if(Date.now()-value.capturedAtMs+value.clockUncertaintyMs>500||!this.eligible()){this.fail('Object processing fell behind or output changed. Projection stopped.');return;}
      if(expected&&!this.observation&&(Math.hypot(...value.center.map((n,i)=>n-expected.center[i]))>.01||value.points<expected.points*.8||value.points>expected.points*1.2||value.extent.some((n,i)=>Math.abs(n-expected.extent[i])>Math.max(.01,expected.extent[i]*.15)))){this.fail('Observed candidate changed before tracking began. Inspect and select again.');return;}
      if(data.settingsRevision!==this.settingsRevision)return;
      this.maskRevision=this.settingsRevision;
      this.observation=value;showPreview({roomReferenceId:this.fit!.roomReferenceId,positions:value.positions,color:this.selected?.color??'#b8ef9a',at:value.capturedAtMs,region:this.region!});
      this.publish();this.changed();};
    this.worker.onerror=()=>this.fail('Object tracker could not run. Reload Studio and try again.');
    // Start from the next exposure, not a potentially almost-one-frame-old click preview.
    this.pendingInit={room:this.context().room!,fit:this.fit,surface,region:this.region,seed:{x,y}};this.changed();
  }
  observe(frame:SensorFrame,generation:number) {
    if(!this.selected||this.lost)return;
    if(generation!==this.sourceGeneration){this.fail('Sensor connection changed. Select the object again.');return;}
    if(!this.eligible()){this.fail('Fixed room or output changed. Projection stopped.');return;}
    if(this.working||!this.worker)return;
    this.working=true;this.worker.postMessage({...(this.pendingInit?{init:this.pendingInit}:{}),frame,now:Date.now(),settings:this.settings,settingsRevision:this.settingsRevision});this.pendingInit=null;
  }
  disconnect(){if(this.selected)this.fail('Sensor disconnected. Projection is black; select the object again after reconnecting.');}
  private fail(message:string){this.lost=message;this.mappingRevision++;this.epoch++;this.worker?.terminate();this.worker=null;this.working=false;showPreview(this.fit&&this.region?{roomReferenceId:this.fit.roomReferenceId,positions:[],color:'#000000',at:0,region:this.region}:null);this.publish();this.changed();}
  fill(id:string,color:string|null) {
    if(!this.selected||id!==this.selected.id)throw new Error('Select the current object first.');
    if(color!==null&&(!/^#[\da-f]{6}$/i.test(color)||!this.status().canFill))throw new Error('A fresh, confidently tracked object and full-screen calibrated output are required.');
    this.selected.color=color;this.mappingRevision++;
    if(color===null){this.clearOutput();}else{this.projectionActive=true;this.publish();}
    if(this.observation&&!this.lost)showPreview({roomReferenceId:this.fit!.roomReferenceId,positions:this.observation.positions,color:color??'#b8ef9a',at:this.observation.capturedAtMs,region:this.region!});
    this.changed();return color?'Color set on the selected measured object. Check the physical result; visible geometry only.':'Object color cleared. Retained scene output restored.';
  }
  private publish(){if(!this.projectionActive||!this.fit)return;const valid=!this.lost&&this.maskRevision===this.settingsRevision&&this.eligible()&&this.observation&&Date.now()-this.observation.capturedAtMs+this.observation.clockUncertaintyMs<500;
    this.channel.postMessage({type:'object-frame',ownerId:this.ownerId,outputId:this.fit.outputId,sequence:++this.counter,
      expiresAt:valid?this.observation!.capturedAtMs+650-this.observation!.clockUncertaintyMs:0,viewport:this.fit.viewport,rasterRect:this.fit.rasterRect,
      mask:valid?this.observation!.mask:null,color:this.selected?.color??'#000000'});
  }
  private clearOutput(){if(this.projectionActive&&this.fit)this.channel.postMessage({type:'object-clear',ownerId:this.ownerId,outputId:this.fit.outputId,sequence:++this.counter});this.projectionActive=false;}
  stop(){this.clearOutput();this.epoch++;this.mappingRevision++;this.settingsRevision++;this.maskRevision=-1;this.settings=structuredClone(DEFAULT_MAPPING_SETTINGS);this.history=[];this.worker?.terminate();this.worker=null;this.working=false;this.pendingInit=null;this.selected=null;this.observation=null;this.lost='';this.region=undefined;this.regionChanged(undefined);showPreview(null);this.changed();}
  dispose(){this.stop();clearInterval(this.timer);this.channel.close();}
}
