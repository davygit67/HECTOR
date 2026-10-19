import type { SensorFrame } from './sensor.js';
import { cameraToRoom, roomMatchesFrame, type RoomReference } from './roomModel.js';
import { dot, sub, surfaceNormal, surfaceUV, inDomain, type Surface, type Vec3 } from './spatial.js';
import { projectCamera, pointInFit, regionContains, validRegion, type ObjectObservation, type ProjectorFit, type TrackingRegion } from './objectMapping.js';
import { DEFAULT_MAPPING_SETTINGS, mappingSettings, softenMeasuredMask, type MappingSettings, type MappingCandidate } from './mappingWorkshop.js';

interface Grid { w:number; h:number; step:number; camera:(Vec3|null)[]; world:(Vec3|null)[] }
interface Component { indices:number[]; center:Vec3; extent:Vec3; edge:boolean }
const distance=(a:Vec3,b:Vec3)=>Math.hypot(...a.map((n,i)=>n-b[i]));
export function trackingRegion(x:number,y:number):TrackingRegion {
  if (![x,y].every(Number.isFinite)||x<0||x>1||y<0||y>1) throw new Error('Click an object in the camera image.');
  return {x:Math.max(0,Math.min(.64,x-.18)),y:Math.max(0,Math.min(.64,y-.18)),w:.36,h:.36};
}
function grid(frame:SensorFrame, room:RoomReference):Grid {
  const {width,height}=frame.device.depth, step=Math.max(1,Math.ceil(width/256)), w=Math.ceil(width/step),h=Math.ceil(height/step);
  const camera:(Vec3|null)[]=new Array(w*h).fill(null),world:(Vec3|null)[]=camera.slice();
  if (!frame.cameraPoints) throw new Error('Registered 3D camera points are required.');
  for(let y=0;y<h;y++) for(let x=0;x<w;x++) { const i=y*step*width+x*step,k=y*w+x,z=frame.depth[i]*frame.device.depthScaleMeters,p:Vec3=[frame.cameraPoints[3*i],frame.cameraPoints[3*i+1],frame.cameraPoints[3*i+2]];
    if(z>.2&&z<8&&p.every(Number.isFinite)&&Math.abs(p[2]-z)<.04) { camera[k]=p;world[k]=cameraToRoom(p,room.transform); }
  }
  return {w,h,step,camera,world};
}
function components(g:Grid,surface:Surface,region:TrackingRegion):Component[] {
  let n=surfaceNormal(surface); if(n[1]<0)n=n.map(v=>-v) as Vec3;
  if(n[1]<.9) throw new Error('Choose a measured horizontal support surface.');
  const eligible=new Uint8Array(g.w*g.h),visited=new Uint8Array(eligible.length);
  for(let i=0;i<eligible.length;i++) { const p=g.world[i]; if(!p||!regionContains(region,(i%g.w)/g.w,Math.floor(i/g.w)/g.h))continue;
    const height=dot(sub(p,surface.origin),n);
    if(height>.03&&height<.6&&inDomain(surface,surfaceUV(surface,p)))eligible[i]=1;
  }
  const result:Component[]=[];
  for(let start=0;start<eligible.length;start++) if(eligible[start]&&!visited[start]) {
    const indices=[start];visited[start]=1;let edge=false;
    for(let head=0;head<indices.length;head++) { const i=indices[head],x=i%g.w,y=Math.floor(i/g.w),px=x/g.w,py=y/g.h;
      if(px<region.x+2/g.w||px>region.x+region.w-2/g.w||py<region.y+2/g.h||py>region.y+region.h-2/g.h)edge=true;
      for(const [dx,dy]of [[-1,0],[1,0],[0,-1],[0,1]]) { const xx=x+dx,yy=y+dy,j=yy*g.w+xx;
        if(xx>=0&&xx<g.w&&yy>=0&&yy<g.h&&eligible[j]&&!visited[j]&&distance(g.world[i]!,g.world[j]!)<.035) { visited[j]=1;indices.push(j); }
      }
    }
    if(indices.length<30)continue;
    const center=[0,1,2].map(a=>indices.reduce((s,i)=>s+g.world[i]![a],0)/indices.length) as Vec3;
    const extent=[0,1,2].map(a=>Math.max(...indices.map(i=>g.world[i]![a]))-Math.min(...indices.map(i=>g.world[i]![a]))) as Vec3;
    if(Math.max(...extent)>.55||Math.max(...extent)<.03)continue;
    result.push({indices,center,extent,edge});
  }
  return result;
}
/** Measured depth triangles, including non-target occluders, rasterized from projector view. */
export function objectMask(g:Grid,selected:number[],fit:ProjectorFit,settings:MappingSettings=DEFAULT_MAPPING_SETTINGS) {
  const width=480,height=Math.round(width*fit.raster.height/fit.raster.width),bits=new Uint8Array(width*height),depth=new Float32Array(bits.length).fill(Infinity);
  const bounds=cameraBounds(selected,g.w,g.h),t=settings.trim;
  const target=new Uint8Array(g.w*g.h);selected.forEach(i=>{const x=(i%g.w+.5)/g.w,y=(Math.floor(i/g.w)+.5)/g.h;
    if(x>=bounds.x+bounds.w*t.left&&x<=bounds.x+bounds.w*(1-t.right)&&y>=bounds.y+bounds.h*t.top&&y<=bounds.y+bounds.h*(1-t.bottom))target[i]=1;});
  const projected=g.camera.map(p=>p?projectCamera(fit.matrix,p):null);
  function triangle(ia:number,ib:number,ic:number) {
    const pa=g.camera[ia],pb=g.camera[ib],pc=g.camera[ic],a=projected[ia],b=projected[ib],c=projected[ic];
    if(!pa||!pb||!pc||!a||!b||!c||Math.min(a.depth,b.depth,c.depth)<=.05||Math.max(distance(pa,pb),distance(pa,pc),distance(pb,pc))>.04)return;
    const ax=a.x*width,ay=a.y*height,bx=b.x*width,by=b.y*height,cx=c.x*width,cy=c.y*height;
    const area=(by-cy)*(ax-cx)+(cx-bx)*(ay-cy); if(Math.abs(area)<1e-6)return;
    // Large triangles indicate unsupported geometry or a singular projection.
    if(Math.max(Math.abs(ax-bx),Math.abs(ax-cx),Math.abs(ay-by),Math.abs(ay-cy))>40)return;
    const isTarget=target[ia]&&target[ib]&&target[ic]&&pointInFit(fit,pa)&&pointInFit(fit,pb)&&pointInFit(fit,pc)?1:0;
    for(let y=Math.max(0,Math.floor(Math.min(ay,by,cy)));y<=Math.min(height-1,Math.ceil(Math.max(ay,by,cy)));y++)
      for(let x=Math.max(0,Math.floor(Math.min(ax,bx,cx)));x<=Math.min(width-1,Math.ceil(Math.max(ax,bx,cx)));x++) {
        const u=((by-cy)*(x+.5-cx)+(cx-bx)*(y+.5-cy))/area,v=((cy-ay)*(x+.5-cx)+(ax-cx)*(y+.5-cy))/area,w=1-u-v;
        if(u<0||v<0||w<0)continue;
        const z=1/(u/a.depth+v/b.depth+w/c.depth),i=y*width+x;
        if(z<depth[i]){depth[i]=z;bits[i]=isTarget;}
      }
  }
  for(let y=0;y<g.h-1;y++)for(let x=0;x<g.w-1;x++){const a=y*g.w+x;triangle(a,a+1,a+g.w);triangle(a+1,a+g.w+1,a+g.w);}
  return softenMeasuredMask({width,height,bits},settings);
}
function cameraBounds(indices:number[],w:number,h:number):TrackingRegion {
  const xs=indices.map(i=>i%w),ys=indices.map(i=>Math.floor(i/w));
  const x=Math.min(...xs),y=Math.min(...ys);return{x:x/w,y:y/h,w:(Math.max(...xs)-x+1)/w,h:(Math.max(...ys)-y+1)/h};
}
/** Ordered exterior of the measured cells; full masks preserve holes in the image overlay. */
function cameraContour(bits:Uint8Array,w:number,h:number) {
  const edges=new Map<number,number[]>(),stride=w+1;
  const edge=(a:number,b:number)=>edges.set(a,[...(edges.get(a)??[]),b]);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x;if(!bits[i])continue;const p=y*stride+x;
    if(!y||!bits[i-w])edge(p,p+1);if(x===w-1||!bits[i+1])edge(p+1,p+stride+1);
    if(y===h-1||!bits[i+w])edge(p+stride+1,p+stride);if(!x||!bits[i-1])edge(p+stride,p);}
  let longest:number[]=[];
  while(edges.size){const start=edges.keys().next().value!;let p=start;const loop:number[]=[];
    do{loop.push(p);const next=edges.get(p);if(!next?.length)break;const q=next.pop()!;if(!next.length)edges.delete(p);p=q;}while(p!==start&&loop.length<100000);
    if(loop.length>longest.length)longest=loop;
  }
  const step=Math.max(1,Math.ceil(longest.length/128));return longest.filter((_,i)=>i%step===0).map(p=>({x:(p%stride)/w,y:Math.floor(p/stride)/h}));
}
export interface MeasuredCandidate extends Omit<MappingCandidate,'id'|'number'> { seed:{x:number;y:number}; cameraMask:{width:number;height:number;bits:Uint8Array} }
export interface MappingScan { candidates:MeasuredCandidate[]; projectorMask:ReturnType<typeof objectMask>|null; selectedIndex:number|null }
export function scanMappingFrame(frame:SensorFrame,room:RoomReference,surface:Surface,fit:ProjectorFit|null,settings:MappingSettings,selectedCenter?:Vec3):MappingScan {
  const g=grid(frame,room),all=components(g,surface,{x:0,y:0,w:1,h:1}).sort((a,b)=>b.indices.length-a.indices.length).slice(0,8);
  const candidates=all.map(c=>{
    const bounds=cameraBounds(c.indices,g.w,g.h),cx=(bounds.x+bounds.w/2)*g.w,cy=(bounds.y+bounds.h/2)*g.h;
    const index=c.indices.reduce((a,b)=>Math.hypot(b%g.w-cx,Math.floor(b/g.w)-cy)<Math.hypot(a%g.w-cx,Math.floor(a/g.w)-cy)?b:a);
    const seed={x:(index%g.w)/g.w,y:Math.floor(index/g.w)/g.h},region=trackingRegion(seed.x,seed.y),bits=new Uint8Array(g.w*g.h);c.indices.forEach(i=>bits[i]=1);
    const selectable=!!fit&&!c.edge&&c.indices.every(i=>pointInFit(fit,g.camera[i]!)&&regionContains({x:region.x+2/g.w,y:region.y+2/g.h,w:region.w-4/g.w,h:region.h-4/g.h},(i%g.w)/g.w,Math.floor(i/g.w)/g.h));
    return{bounds,centerMeters:c.center,extentMeters:c.extent,points:c.indices.length,contour:cameraContour(bits,g.w,g.h),selectable,seed,cameraMask:{width:g.w,height:g.h,bits}};
  });
  const matching=selectedCenter?all.map((c,i)=>({c,i})).filter(({c})=>distance(c.center,selectedCenter)<.025):[];
  const selectedIndex=matching.length===1?matching[0].i:null;
  return{candidates,selectedIndex,projectorMask:fit&&selectedIndex!==null?objectMask(g,all[selectedIndex].indices,fit,settings):null};
}
export function matchMeasuredCandidate(saved:MeasuredCandidate,current:MeasuredCandidate[]):MeasuredCandidate {
  const matches=current.filter(c=>distance(c.centerMeters,saved.centerMeters)<=.01&&c.points>=saved.points*.8&&c.points<=saved.points*1.2&&c.extentMeters.every((n,a)=>Math.abs(n-saved.extentMeters[a])<=Math.max(.01,saved.extentMeters[a]*.15)));
  if(matches.length!==1||!matches[0].selectable)throw new Error('The observed object moved, changed or became ambiguous. Inspect the mapping again.');return matches[0];
}
export class ObjectTracker {
  private initial:Component|null=null; private previous:ObjectObservation|null=null; private failed=false;
  private settings:MappingSettings=structuredClone(DEFAULT_MAPPING_SETTINGS);
  constructor(readonly room:RoomReference,readonly fit:ProjectorFit,readonly surface:Surface,readonly region:TrackingRegion,readonly seed:{x:number;y:number}) {
    if(!validRegion(region)||surface.kind!=='table'||surface.measurement?.roomReferenceId!==room.id||fit.roomReferenceId!==room.id||fit.descriptor!==room.descriptor)throw new Error('Use a measured tabletop and projector calibration from this room.');
  }
  update(frame:SensorFrame,now=Date.now()):ObjectObservation {
    if(this.failed)throw new Error('Tracking stopped. Select the object again.');
    try{return this.track(frame,now);}catch(e){this.failed=true;throw e;}
  }
  configure(settings:MappingSettings){this.settings=mappingSettings(DEFAULT_MAPPING_SETTINGS,settings);}
  private track(frame:SensorFrame,now:number):ObjectObservation {
    if(this.room.invalidated||frame.device.kind==='synthetic'||frame.clockUncertaintyMs>300||now-frame.capturedAtMs+frame.clockUncertaintyMs>500||frame.capturedAtMs>now+100)throw new Error('Sensor observations are too old or uncertain. Projection stopped.');
    if(!roomMatchesFrame(this.room,frame,this.region))throw new Error('Fixed background changed. Recheck the rig and capture a new room.');
    if(this.previous&&(frame.sequence<=this.previous.sequence||frame.capturedAtMs<=this.previous.capturedAtMs||frame.capturedAtMs-this.previous.capturedAtMs>600))throw new Error('Sensor continuity was lost. Select the object again.');
    const g=grid(frame,this.room), all=components(g,this.surface,this.region);
    let found:Component|undefined;
    if(!this.previous) {
      const x=Math.round(this.seed.x*g.w),y=Math.round(this.seed.y*g.h);
      const candidates=all.filter(c=>c.indices.some(i=>Math.abs(i%g.w-x)<=2&&Math.abs(Math.floor(i/g.w)-y)<=2));
      if(candidates.length===1)found=candidates[0];
    } else {
      const candidates=all.filter(c=>distance(c.center,this.previous!.center)<.1);
      if(candidates.length===1)found=candidates[0];
    }
    if(!found||found.edge)throw new Error('Object is missing, ambiguous or at the tracking-area edge. Select it again.');
    if(!this.initial)this.initial=found;
    const base=this.initial;
    if(found.indices.length<base.indices.length*.65||found.indices.length>base.indices.length*1.4||found.extent.some((n,a)=>Math.abs(n-base.extent[a])>Math.max(.025,base.extent[a]*.4)))throw new Error('Object shape changed or is occluded. Projection stopped; select it again.');
    const speedMps=this.previous?distance(found.center,this.previous.center)/((frame.capturedAtMs-this.previous.capturedAtMs)/1000):0;
    if(speedMps>.15)throw new Error('Object moved too quickly for this sensor feed. Keep motion below 15 cm/second and select again.');
    if(found.indices.some(i=>!pointInFit(this.fit,g.camera[i]!)))throw new Error('Object left the calibrated 3D volume. Recalibrate across its working area.');
    const mask=objectMask(g,found.indices,this.fit,this.settings);
    // A deliberately tight trim may be empty; it must not reset identity or expand the mask.
    if(this.settings.insetPx===1&&Object.values(this.settings.trim).every(v=>!v)&&mask.bits.reduce((s,n)=>s+n,0)<12)throw new Error('Too little confirmed projector coverage on this object.');
    this.previous={capturedAtMs:frame.capturedAtMs,clockUncertaintyMs:frame.clockUncertaintyMs,sequence:frame.sequence,region:this.region,points:found.indices.length,center:found.center,extent:found.extent,speedMps,positions:found.indices.flatMap(i=>g.world[i]!),mask};
    return this.previous;
  }
}
