import { useEffect, useRef, useState } from 'react';
import { PATTERN_CHANNEL } from './patternOutput';
import { ObjectOutputGate } from './shared/objectOutput';

/** Raw projector raster; this never goes through the planar manual warp. */
export function ObjectProjection({outputId,blackout=false,brightness=1}:{outputId:string;blackout?:boolean;brightness?:number}) {
  const canvas=useRef<HTMLCanvasElement>(null),[active,setActive]=useState(false);
  const blanked=useRef(blackout);blanked.current=blackout;
  useEffect(()=>{
    const gate=new ObjectOutputGate(),channel=new BroadcastChannel(PATTERN_CHANNEL);
    let raf=0,painted:unknown=undefined;
    channel.onmessage=({data})=>{if(gate.accept(data,outputId))setActive(gate.active);};
    const blank=()=>{gate.blank();painted=undefined;};
    const paint=()=>{
      const frame=blanked.current?null:gate.image(Date.now(),{width:innerWidth,height:innerHeight,devicePixelRatio},document.visibilityState==='visible',!!document.fullscreenElement),node=canvas.current;
      if(node&&frame!==painted){painted=frame;node.width=innerWidth;node.height=innerHeight;const ctx=node.getContext('2d');
        if(ctx){ctx.fillStyle='#000';ctx.fillRect(0,0,node.width,node.height);
          if(frame?.mask){const m=frame.mask,tile=document.createElement('canvas');tile.width=m.width;tile.height=m.height;const tc=tile.getContext('2d')!;const img=tc.createImageData(m.width,m.height),rgb=[1,3,5].map(i=>parseInt(frame.color.slice(i,i+2),16));
            for(let i=0;i<m.bits.length;i++){if(m.bits[i]){img.data[i*4]=rgb[0];img.data[i*4+1]=rgb[1];img.data[i*4+2]=rgb[2];}img.data[i*4+3]=255;}
            tc.putImageData(img,0,0);ctx.imageSmoothingEnabled=false;const r=frame.rasterRect;ctx.drawImage(tile,r.x,r.y,r.width,r.height);
          }
        }
      }raf=requestAnimationFrame(paint);
    };paint();
    window.addEventListener('resize',blank);document.addEventListener('fullscreenchange',blank);document.addEventListener('visibilitychange',blank);
    return()=>{cancelAnimationFrame(raf);channel.close();window.removeEventListener('resize',blank);document.removeEventListener('fullscreenchange',blank);document.removeEventListener('visibilitychange',blank);};
  },[outputId]);
  return <canvas ref={canvas} className="object-projection-output" aria-label="Tracked object projection" hidden={!active} style={{filter:`brightness(${brightness})`}}/>;
}
