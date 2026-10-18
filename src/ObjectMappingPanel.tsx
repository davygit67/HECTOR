import {useEffect,useRef,useState} from 'react';
import type {SensorFrame} from './shared/sensor';
import type {ObjectMappingStatus,TrackingRegion} from './shared/objectMapping';
export function ObjectMappingPanel({status,frame,region,busy,canCalibrate,calibrate,select,fill,stop}:{status:ObjectMappingStatus;frame:SensorFrame|null;region?:TrackingRegion;busy:boolean;canCalibrate:boolean;calibrate:()=>void;select:(x:number,y:number)=>void;fill:(color:string|null)=>void;stop:()=>void}){
  const canvas=useRef<HTMLCanvasElement>(null),[color,setColor]=useState('#ff3020');
  useEffect(()=>{const node=canvas.current;if(!node||!frame)return;const{width,height}=frame.device.depth;node.width=width;node.height=height;const ctx=node.getContext('2d')!;const image=ctx.createImageData(width,height);
    if(frame.device.colorRegistration==='depth')for(let i=0;i<width*height;i++){image.data.set(frame.color.subarray(i*3,i*3+3),i*4);image.data[i*4+3]=255;}ctx.putImageData(image,0,0);
    if(region){ctx.strokeStyle='#b8ef9a';ctx.lineWidth=2;ctx.setLineDash([6,4]);ctx.strokeRect(region.x*width,region.y*height,region.w*width,region.h*height);}
  },[frame,region]);
  return <section className="hardware-card object-mapping-card"><div className="hardware-card-title"><div><span className="eyebrow">04 / CURVED OBJECTS · EXPERIMENTAL</span><h3>Follow one object</h3></div><span className="hardware-badge">Visible shape · slow movement</span></div>
    <p className="hardware-caption">Place several sizeable objects at different depths in the camera and projector view. Capture the room, map the tabletop, then calibrate in 3D without moving anything. A flat table alone cannot solve this fit. Keep the rig and projector settings fixed.</p>
    <div className="hardware-actions"><button className="primary" disabled={busy||!canCalibrate} onClick={calibrate}>Calibrate projector in 3D</button>{status.calibrationId&&<span>Independent fit check: {status.rmsPx?.toFixed(2)} px · current session</span>}</div>
    <div className="object-mapping-columns"><div className="object-picker">{frame?<canvas ref={canvas} aria-label="Select an object in the registered camera image" onClick={e=>{if(busy||!status.calibrationId)return;const r=e.currentTarget.getBoundingClientRect();select((e.clientX-r.left)/r.width,(e.clientY-r.top)/r.height);}}/>:<div>Connect the Kinect to select an object.</div>}<p className="hardware-caption">Click the middle of a separate cup or cylinder above the table. The outlined area stays fixed; keep the object inside it. Selection identifies the object—you choose what it is.</p></div>
    <div><p role="status">{status.message}</p>{status.object&&<p className="hardware-caption">{status.object.name} · {status.object.points} measured points · {(status.object.speedMps*100).toFixed(1)} cm/s</p>}
      <div className="hardware-controls"><label className="field"><span>Object color</span><input aria-label="Tracked object color" type="color" value={color} onChange={e=>setColor(e.target.value)}/></label><button className="primary" disabled={!status.canFill||busy} onClick={()=>fill(color)}>Project color</button></div>
      <div className="hardware-actions"><button className="secondary" disabled={!status.object} onClick={()=>fill(null)}>Clear color</button><button className="secondary" disabled={!status.object} onClick={stop}>Stop tracking</button></div>
      <p className="hardware-caption">Object projection temporarily replaces the scene with black plus the measured object mask. On tracking loss it stays black until you clear or stop. Your scene is retained.</p>
      <p className="hardware-caption">Move below 15 cm/s. The current feed is about 5 frames/second; fast motion, hands touching the object, shiny surfaces and hidden sides are not supported. Select again after a loss. Check the physical footprint before relying on it.</p>
    </div></div>
  </section>;
}
