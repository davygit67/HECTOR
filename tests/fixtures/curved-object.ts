import {aggregateRoom,sampleRoomFrame} from '../../src/shared/roomModel.js';
import {patternSequence,patternValue} from '../../src/shared/calibrationPatterns.js';
import {projectCamera,type ProjectorFit} from '../../src/shared/objectMapping.js';
import type {SensorFrame,SensorSession} from '../../src/shared/sensor.js';
import type {Surface} from '../../src/shared/spatial.js';
import {FULL_QUAD} from '../../src/shared/geometry.js';
export const matrix=[-1,0,.5,.04,0,-1.333,.5,-.1,0,0,1,0];
/** Analytic ray/cylinder/table intersections. Kinect metadata is for guard tests only. */
export function curvedFrame(offset=0,sequence=0,time=10000,options:{missing?:boolean;occlusion?:boolean;shift?:number;second?:boolean}={}):SensorFrame{
 const width=256,height=192,depth=new Uint16Array(width*height),cameraPoints=new Float32Array(width*height*3),color=new Uint8Array(width*height*3);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const rx=(128-x)/180,ry=(96-y)/180;let z=3;
  if(ry<0)z=Math.min(z,-.4/ry);
  if(!options.missing)for(const center of [offset,...(options.second?[offset+.16]:[])]){
   const a=rx*rx+1,b=-2*(rx*center+1.7),c=center*center+1.7**2-.09**2,d=b*b-4*a*c;
   if(d>=0){const hit=(-b-Math.sqrt(d))/(2*a),h=hit*ry;if(hit>0&&h>=-.4&&h<=-.22)z=Math.min(z,hit);}
   if(ry<0){const top=-.22/ry;if((top*rx-center)**2+(top-1.7)**2<.09**2)z=Math.min(z,top);}
  }
  if(options.occlusion&&x>120&&x<143&&y>117&&y<140)z=1.25;
  z+=options.shift??0;const i=y*width+x;depth[i]=Math.round(z*1000);cameraPoints.set([rx*z,ry*z,z],3*i);color.set(z<2?[180,100,65]:[90,120,100],3*i);
 }
 return{sequence,capturedAtMs:time,exposureMs:0,clockUncertaintyMs:0,color,depth,cameraPoints,floorPlane:[0,1,0,1.2],device:{id:'analytic-curved-fixture',label:'Analytic fixture, not physical Kinect',kind:'kinect-v2',color:{width,height},depth:{width,height},depthScaleMeters:.001,colorRegistration:'depth',depthIntrinsics:null,colorIntrinsics:null,depthToColor:null}};
}
export function curvedFixture(){
 const room=aggregateRoom(Array.from({length:12},(_,i)=>sampleRoomFrame(curvedFrame(0,i,1000+200*i))),'curved-room');
 const fit:ProjectorFit={id:'analytic-fit',roomReferenceId:room.id,sensorId:room.sensorId,descriptor:room.descriptor,matrix,bounds:{min:[-2,-1,1],max:[2,2,4]},rmsPx:.1,p95Px:.2,samples:1000,heldOut:200,raster:{width:640,height:360},viewport:{width:640,height:360,devicePixelRatio:1},rasterRect:{x:0,y:0,width:640,height:360},outputId:'fixture-output'};
 const surface:Surface={id:'tabletop',name:'Analytic table',kind:'table',provenance:'measured',origin:[-2,.8,-3],u:[1,0,0],v:[0,0,1],width:4,height:3,boundary:structuredClone(FULL_QUAD),holes:[],measurement:{sessionId:'fixture',sensorId:room.sensorId,source:'sensor',capturedAtMs:1000,rmsPx:.1,correspondences:1000,quad:structuredClone(FULL_QUAD),raster:fit.raster,viewport:fit.viewport,mask:{width:8,height:8,bits:'1'.repeat(64)},floorAligned:true,roomReferenceId:room.id}};
 return{room,fit,surface,seed:{x:.5,y:.675}};
}
export function curvedSession():SensorSession{
 const plannedPatterns=patternSequence(640,360),frames=plannedPatterns.map((p,i)=>{const f=curvedFrame(0,i,10000+i*1000);for(let k=0;k<f.depth.length;k++){const uv=projectCamera(matrix,Array.from(f.cameraPoints!.subarray(k*3,k*3+3)) as [number,number,number]),inside=uv.x>=0&&uv.x<1&&uv.y>=0&&uv.y<1;const v=inside?15+.85*patternValue(p,uv.x*640,uv.y*360):15;f.color.fill(Math.round(v),k*3,k*3+3);}return f;});
 return{version:1,id:'curved-calibration-fixture',name:'Analytic geometry only',kind:'pattern-capture',provenance:'sensor',createdAtMs:1000,status:'complete',message:'',plannedPatterns,frames,captures:plannedPatterns.map((p,i)=>({frameIndex:i,pattern:p,settleMs:750,receivedAtMs:frames[i].capturedAtMs,presentation:{patternId:p.id,presentedAtMs:frames[i].capturedAtMs-900,outputId:'fixture-output',mode:'output-window',fullscreen:true,viewport:{width:640,height:360,devicePixelRatio:1},rasterRect:{x:0,y:0,width:640,height:360}}}))};
}
