import type { SensorFrame } from './shared/sensor';
import type { MappingImage, MappingObservation } from './shared/mappingWorkshop';
import type { MappingScan } from './shared/objectTracking';

function image(canvas:HTMLCanvasElement):MappingImage {
  return {mimeType:'image/png',data:canvas.toDataURL('image/png').split(',')[1],width:canvas.width,height:canvas.height};
}
function canvas(w:number,h:number){const c=document.createElement('canvas');c.width=w;c.height=h;return c;}
/** RGB and depth come from one exposure; overlays are labelled computed geometry. */
export function mappingImages(frame:SensorFrame,scan:MappingScan):MappingObservation['images'] {
  const {width,height}=frame.device.depth,camera=canvas(width,height),depth=canvas(width,height);
  const rgb=camera.getContext('2d')!,dc=depth.getContext('2d')!,ri=rgb.createImageData(width,height),di=dc.createImageData(width,height);
  for(let i=0;i<width*height;i++){
    ri.data.set(frame.color.subarray(i*3,i*3+3),i*4);ri.data[i*4+3]=255;
    const z=frame.depth[i]*frame.device.depthScaleMeters,k=z?Math.max(0,Math.min(1,(z-.2)/4.8)):0;
    if(z){di.data[i*4]=255*(1-k);di.data[i*4+1]=170*(1-Math.abs(2*k-1));di.data[i*4+2]=255*k;}di.data[i*4+3]=255;
  }
  rgb.putImageData(ri,0,0);dc.putImageData(di,0,0);
  const ow=Math.min(640,width),oh=Math.round(ow*height/width),overlay=canvas(ow,oh),oc=overlay.getContext('2d')!;oc.drawImage(camera,0,0,ow,oh);
  for(let n=0;n<scan.candidates.length;n++){
    const c=scan.candidates[n],m=c.cameraMask,layer=canvas(m.width,m.height),lc=layer.getContext('2d')!,pixels=lc.createImageData(m.width,m.height);
    for(let i=0;i<m.bits.length;i++)if(m.bits[i]){pixels.data[i*4]=scan.selectedIndex===n?255:70;pixels.data[i*4+1]=220;pixels.data[i*4+2]=90;pixels.data[i*4+3]=90;}
    lc.putImageData(pixels,0,0);oc.drawImage(layer,0,0,ow,oh);oc.strokeStyle=c.selectable?'#baff83':'#ffbc5a';oc.lineWidth=2;
    if(c.contour.length){oc.beginPath();c.contour.forEach((p,i)=>i?oc.lineTo(p.x*ow,p.y*oh):oc.moveTo(p.x*ow,p.y*oh));oc.closePath();oc.stroke();}
    const x=c.bounds.x*ow,y=Math.max(22,c.bounds.y*oh);oc.fillStyle='#08120d';oc.fillRect(x,y-22,30,22);oc.fillStyle='#fff';oc.font='bold 17px sans-serif';oc.fillText(String(n+1),x+7,y-5);
  }
  let projectorMask:MappingImage|null=null;
  if(scan.projectorMask){const m=scan.projectorMask,p=canvas(m.width,m.height),pc=p.getContext('2d')!,data=pc.createImageData(m.width,m.height);
    for(let i=0;i<m.bits.length;i++){const a=m.bits[i]?(m.alpha?.[i]??255):0;data.data.set([a,a,a,255],i*4);}pc.putImageData(data,0,0);projectorMask=image(p);}
  const resized=(c:HTMLCanvasElement)=>{if(c.width<=640)return image(c);const d=canvas(640,Math.round(c.height*640/c.width));d.getContext('2d')!.drawImage(c,0,0,d.width,d.height);return image(d);};
  return{camera:resized(camera),depth:resized(depth),overlay:image(overlay),projectorMask};
}
