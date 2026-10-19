import type { ObjectRuntime } from './objectRuntime';
import type { RoomReference } from './shared/roomModel';
import { roomMatchesFrame } from './shared/roomModel';
import type { Surface } from './shared/spatial';
import type { SensorFrame } from './shared/sensor';
import { fitMatchesRoom } from './shared/objectMapping';
import { matchMeasuredCandidate, type MappingScan, type MeasuredCandidate } from './shared/objectTracking';
import { MappingLease, validateMappingOperation, type MappingObservation, type MappingOperation } from './shared/mappingWorkshop';
import { mappingImages } from './mappingImages';

interface Context { runtime:ObjectRuntime;room:RoomReference|null;surface:Surface|undefined;generation:number;live:boolean;ready:boolean;busy:boolean }
export class MappingWorkshop {
  private lease=new MappingLease();private candidates=new Map<string,MeasuredCandidate>();private busy=false;private disposed=false;
  private inspectedCenter:import('./shared/spatial').Vec3|undefined;
  private cancelScan:(()=>void)|null=null;
  latest:MappingObservation|null=null;
  constructor(private context:()=>Context,private nextFrame:()=>Promise<SensorFrame>,private changed:()=>void){}
  private checked(frame?:SensorFrame){const c=this.context();
    if(this.disposed||!c.live||c.busy||!c.ready||!c.room||c.room.source!=='sensor'||c.room.invalidated||!c.surface||c.surface.measurement?.roomReferenceId!==c.room.id||c.surface.measurement.source!=='sensor')throw new Error('Connect the live Kinect, capture a stable room and map its tabletop before inspecting objects.');
    if(frame&&(frame.device.kind==='synthetic'||frame.device.colorRegistration!=='depth'||!frame.cameraPoints||frame.clockUncertaintyMs>300||Date.now()-frame.capturedAtMs+frame.clockUncertaintyMs>500||frame.capturedAtMs>Date.now()+100||!roomMatchesFrame(c.room,frame,c.runtime.region)))throw new Error('Camera/depth observations are stale or no longer match the fixed room. Inspect again after recovery.');
    return c as Context&{room:RoomReference;surface:Surface};
  }
  private signature(c:ReturnType<MappingWorkshop['checked']>){return JSON.stringify([c.generation,c.room.id,c.room.descriptor,c.surface,c.runtime.fit?.id??null,c.runtime.mappingState().revision]);}
  private scan(frame:SensorFrame,c:ReturnType<MappingWorkshop['checked']>):Promise<MappingScan>{
    return new Promise((resolve,reject)=>{const worker=new Worker(new URL('./mappingScan.worker.ts',import.meta.url),{type:'module'});
      const done=()=>{worker.terminate();clearTimeout(timer);this.cancelScan=null;};
      const timer=setTimeout(()=>{done();reject(new Error('Mapping inspection timed out. Try again with the object still.'));},3000);
      this.cancelScan=()=>{done();reject(new Error('Mapping inspection cancelled.'));};
      worker.onmessage=({data})=>{done();data.error?reject(new Error(data.error)):resolve(data.scan);};worker.onerror=()=>{done();reject(new Error('Mapping inspection worker failed.'));};
      worker.postMessage({frame,room:c.room,surface:c.surface,fit:c.runtime.fit&&fitMatchesRoom(c.runtime.fit,c.room)?c.runtime.fit:null,settings:c.runtime.mappingState().settings,selectedCenter:c.runtime.measuredCenter()});
    });
  }
  async observe():Promise<MappingObservation>{
    if(this.busy)throw new Error('Wait for the current mapping inspection.');this.busy=true;
    try{const initial=this.checked(),signature=this.signature(initial),frame=await this.nextFrame();const c=this.checked(frame);
      if(signature!==this.signature(c))throw new Error('The mapping changed during inspection. Inspect again.');
      const scan=await this.scan(frame,c),current=this.checked(frame);if(signature!==this.signature(current))throw new Error('The mapping changed during inspection. Inspect again.');
      if(!current.runtime.canSelect())for(const candidate of scan.candidates)candidate.selectable=false;
      const selected=current.runtime.mappingState(),id=crypto.randomUUID(),at=Date.now(),expiresAt=this.lease.issue(id,selected.revision,signature,at);this.candidates.clear();
      const candidates=scan.candidates.map((v,i)=>{const candidateId=`${id}:${i+1}`;const measured={...v,selectable:v.selectable&&current.runtime.canSelect()};this.candidates.set(candidateId,measured);const{seed:_,cameraMask:__,...candidate}=measured;return{...candidate,id:candidateId,number:i+1};});
      const images=mappingImages(frame,scan);this.checked(frame); // encoding cannot turn an old exposure into a fresh observation
      this.inspectedCenter=scan.selectedIndex===null?undefined:scan.candidates[scan.selectedIndex].centerMeters;
      const fit=current.runtime.fit;
      this.latest={observationId:id,revision:selected.revision,at,capturedAt:frame.capturedAtMs,expiresAt,ageMs:Math.max(0,Date.now()-frame.capturedAtMs),clockUncertaintyMs:frame.clockUncertaintyMs,stale:false,kind:'mapping-observation',source:'registered-kinect',opticalAlignmentVerified:false,roomReferenceId:current.room.id,sensorId:current.room.sensorId,calibrationId:fit?.id??null,candidates,selected,images,maskScale:fit?{width:480,height:Math.round(480*fit.raster.height/fit.raster.width),projectorPixelsPerCell:fit.raster.width/480}:null,
        limitations:['Camera and registered depth show one physical observation. Colored outlines are computed geometry, not observed projected-light alignment.','Depth colors: near is red, far is blue (0.2–5 m); missing depth is black.','Candidate numbers are temporary measured components, not semantic names. The contour is the exterior; the full overlay retains measured holes.','The projector mask is computed from depth, visibility and current edge settings; it is not a photograph or proof that the physical edge looks optimal.','Keep the object still while selecting or refining. Requests revalidate fresh geometry; observations expire after 15 seconds.','Trims, inset and feather only remove light inside measured geometry. They cannot translate alignment, reveal hidden faces or expand onto unknown pixels.']};
      this.changed();return structuredClone(this.latest);
    }catch(e){this.latest=null;this.lease.consume();this.candidates.clear();this.changed();throw e;}finally{this.busy=false;}
  }
  async execute(op:MappingOperation){
    validateMappingOperation(op);if(this.busy)throw new Error('Wait for the current mapping inspection.');this.busy=true;
    try{const c=this.checked();this.lease.check(op.observationId,op.expectedRevision,this.signature(c));const frame=await this.nextFrame(),current=this.checked(frame);
      this.lease.check(op.observationId,op.expectedRevision,this.signature(current));
      if(op.type==='mapping.select'){
        const saved=this.candidates.get(op.candidateId);if(!saved||!saved.selectable)throw new Error('Choose a selectable candidate from the current observation after 3D projector calibration.');
        const scan=await this.scan(frame,current),fresh=this.checked(frame);this.lease.check(op.observationId,op.expectedRevision,this.signature(fresh));
        const candidate=matchMeasuredCandidate(saved,scan.candidates);
        fresh.runtime.select(frame,candidate.seed.x,candidate.seed.y,fresh.surface,fresh.generation,{center:candidate.centerMeters,extent:candidate.extentMeters,points:candidate.points});
      }else{
        if(current.runtime.mappingState().objectId!==op.objectId)throw new Error('The selected object changed. Inspect it again.');
        // The tracking worker may still be processing this exposure. Re-scan the
        // fresh frame rather than treating the previous tracked centroid as current.
        const scan=await this.scan(frame,current),fresh=this.checked(frame);this.lease.check(op.observationId,op.expectedRevision,this.signature(fresh));
        const center=scan.selectedIndex===null?undefined:scan.candidates[scan.selectedIndex].centerMeters;
        if(!center||!this.inspectedCenter||Math.hypot(...center.map((n,i)=>n-this.inspectedCenter![i]))>.01)throw new Error('The selected object moved since inspection. Keep it still and inspect again.');
        fresh.runtime.refine(op.objectId,op.expectedRevision,op.type==='mapping.refine'?'refine':op.type==='mapping.undo'?'undo':'reset',op.type==='mapping.refine'?op.settings:undefined);
      }
      const acceptedSignature=this.signature(this.checked());
      this.lease.consume();this.latest=null;this.candidates.clear();this.changed();
      for(let i=0;i<100&&!current.runtime.status().canFill;i++){if(this.disposed||current.runtime.status().state==='lost')throw new Error('Mapping changed but tracking was lost. Inspect before continuing.');await new Promise(r=>setTimeout(r,20));}
      if(!current.runtime.status().canFill)throw new Error('Mapping changed but a fresh tracked mask has not arrived. Inspect before continuing.');
      if(acceptedSignature!==this.signature(this.checked()))throw new Error('The mapping changed before this adjustment finished. Inspect the current result before continuing.');
      return {message:op.type==='mapping.select'?'Measured candidate selected. Inspect the mapping again; no color was enabled.':'Measured edge settings applied. Inspect the new camera and computed mask before another change; optical alignment remains unverified.',value:current.runtime.mappingState()};
    }finally{this.busy=false;}
  }
  dispose(){this.disposed=true;this.cancelScan?.();this.lease.consume();this.candidates.clear();this.latest=null;}
}
