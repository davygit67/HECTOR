import { FULL_PICTURE, type ActivePicture } from './activePicture.js';
import type { Scene } from './domain.js';
import type { YouTubeContent } from './content.js';
import { type Point } from './geometry.js';
import { youtubePictureBounds } from './youtube.js';
import { add, dot, scale, sub, surfaceNormal, surfacePoint, surfaceUV, type Surface, type Vec3 } from './spatial.js';
import type { LightField } from './lightField.js';
import { layerVisible, layerOpacity } from './layers.js';

/** One viewer-relative color space shared by every receiving surface. Surface
 * points on the same viewing ray sample the same extension of the video plane. */
export function roomLightPoint(scene:Pick<Scene,'viewer'>,source:Surface,video:YouTubeContent,world:Vec3,picture:ActivePicture=FULL_PICTURE):Point {
  const ray=sub(world,scene.viewer.position),normal=surfaceNormal(source),denominator=dot(ray,normal);
  const distance=dot(sub(source.origin,scene.viewer.position),normal);
  const t=Math.abs(denominator)>1e-6?distance/denominator:-1;
  const projected=surfaceUV(source,t>0?add(scene.viewer.position,scale(ray,t)):world);
  const bounds=youtubePictureBounds(video.bounds,picture);
  return {x:(projected.x-bounds.x)/bounds.w,y:(projected.y-bounds.y)/bounds.h};
}
/** Compress only exterior distance, so an unbounded room still has a soft,
 * nonzero continuation. The video footprint itself is never stretched. */
export function roomFieldPoint(point:Point,field:LightField,roomFill=1):Point {
  const x=point.x*field.videoWidth,y=point.y*field.videoHeight;
  const cx=Math.max(0,Math.min(field.videoWidth,x)),cy=Math.max(0,Math.min(field.videoHeight,y));
  const dx=x-cx,dy=y-cy,d=Math.hypot(dx,dy),radius=field.padding*.9,factor=d>0?1-roomFill+roomFill*radius*(1-Math.exp(-d/Math.max(1,radius)))/d:0;
  return {x:(cx+dx*factor+field.padding)/(field.videoWidth+2*field.padding),y:(cy+dy*factor+field.padding)/(field.videoHeight+2*field.padding)};
}
export interface RoomLightMap { width:number;height:number;indices:Int32Array;weights:Float32Array }
export function createRoomLightMap(scene:Scene,source:Surface,target:Surface,video:YouTubeContent,field:LightField,width=224,height=126,picture:ActivePicture=FULL_PICTURE):RoomLightMap {
  const indices=new Int32Array(width*height*4),weights=new Float32Array(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const p=roomFieldPoint(roomLightPoint(scene,source,video,surfacePoint(target,{x:(x+.5)/width,y:(y+.5)/height}),picture),field,video.config.backlightSettings?.roomFill??0);
    const fx=Math.max(0,Math.min(field.width-1,p.x*field.width-.5)),fy=Math.max(0,Math.min(field.height-1,p.y*field.height-.5));
    const x0=Math.floor(fx),x1=Math.min(field.width-1,x0+1),y0=Math.floor(fy),y1=Math.min(field.height-1,y0+1),u=fx-x0,v=fy-y0,i=(y*width+x)*4;
    indices.set([(y0*field.width+x0)*4,(y0*field.width+x1)*4,(y1*field.width+x0)*4,(y1*field.width+x1)*4],i);
    weights.set([(1-u)*(1-v),u*(1-v),(1-u)*v,u*v],i);
  }
  return {width,height,indices,weights};
}
export function mapRoomLight(field:LightField,map:RoomLightMap,videoWidth:number,videoHeight:number):LightField {
  const data=new Uint8ClampedArray(map.width*map.height*4);
  for(let i=0;i<map.width*map.height;i++){
    for(let c=0;c<3;c++){let value=0;for(let k=0;k<4;k++)value+=field.data[map.indices[i*4+k]+c]*map.weights[i*4+k];data[i*4+c]=value;}
    data[i*4+3]=255;
  }
  return {width:map.width,height:map.height,data,videoWidth,videoHeight,padding:0};
}
export function lightProtectedBounds(scene:Scene,surfaceId:string,pictureFor:(id:string)=>ActivePicture=()=>FULL_PICTURE) {
  return [...scene.timers, ...scene.contents.filter(c => c.kind !== 'art')].filter(c => c.surfaceId === surfaceId && layerVisible(c) && layerOpacity(c) > 0).map(c => 'kind' in c && c.kind === 'youtube' ? youtubePictureBounds(c.bounds,pictureFor(c.id)) : c.bounds);
}
