// Ambient backlight, adapted from adknate05's Projection Mapper (HECTOR branch `codex/nate-projection-mapper`,
// commit 912f609, src/shared/lightField.ts). Reused with the author's permission; see docs/THIRD_PARTY.md.
// HECTOR changes: room fill is omitted. With roomFill = 0 the original math is unchanged.
import { continuationShift } from './colorContinuation';
import { BACKLIGHT_DEFAULTS, type BacklightSettings, type ColorRegion, type RGB } from './backlight';
import { clamp01, gamutMap, linearToLab, luminance, toLinear, toSRGB } from './lightColor';

const PROFILES = {
  cinema: { gain: .82, chroma: 1.04, shoulder: .68, far: .3 },
  vivid: { gain: 1.1, chroma: 1.2, shoulder: .82, far: .38 },
  soft: { gain: .55, chroma: .88, shoulder: .56, far: .35 },
  neutral: { gain: .76, chroma: 1, shoulder: .72, far: .25 },
} as const;
export interface LightField { width:number; height:number; data:Uint8ClampedArray; padding:number; videoWidth:number; videoHeight:number }
/** All light is mixed in linear RGB, with one hue-preserving highlight shoulder.
 * Oklab adjusts chroma; gamut reduction preserves hue instead of channel clipping. */
export function toneColor(color:RGB, settings:BacklightSettings, adaptation=1):RGB {
  const profile=PROFILES[settings.toneProfile??BACKLIGHT_DEFAULTS.toneProfile!];
  const lab=linearToLab(color), chroma=profile.chroma*(settings.vibrance??1);
  let rgb=gamutMap([lab[0],lab[1]*chroma,lab[2]*chroma]);
  const y=luminance(rgb),toe=y/(y+.0025), gain=profile.gain*settings.intensity*adaptation*toe;
  rgb=rgb.map(c=>c*gain) as RGB;
  const peak=Math.max(...rgb), mapped=profile.shoulder*(1-Math.exp(-peak/profile.shoulder));
  return rgb.map(c=>peak>0?c*mapped/peak:0) as RGB;
}
function blurredSides(colors:ColorRegion[], offset:number, sigma:number) {
  let start=offset;
  return [16,16,9,9].map(count=>{
    const result:RGB[]=[];
    for(let j=0;j<count;j++){
      let mass=0;const sum:RGB=[0,0,0];
      for(let k=0;k<count;k++){
        const w=Math.exp(-.5*((k-j)/sigma)**2), rgb=toLinear(colors[start+k]?.color??[0,0,0]);
        for(let c=0;c<3;c++)sum[c]+=rgb[c]*w;mass+=w;
      }
      result.push(sum.map(v=>v/mass) as RGB);
    }
    start+=count;return result;
  });
}
const geometries=new Map<string,{width:number;height:number;indices:Int16Array;weights:Float32Array;distance:Float32Array;depthX:Float32Array;depthY:Float32Array;falloff:Float32Array}>();
function geometry(videoWidth:number,videoHeight:number,padding:number,maxSize:number){
  const key=[videoWidth,videoHeight,padding,maxSize].join(':');const cached=geometries.get(key);if(cached)return cached;
  const w=videoWidth+2*padding,h=videoHeight+2*padding,scale=Math.min(1,maxSize/Math.max(w,h));
  const width=Math.max(2,Math.ceil(w*scale)),height=Math.max(2,Math.ceil(h*scale));
  const n=width*height,indices=new Int16Array(n*4),weights=new Float32Array(n*4),distance=new Float32Array(n),depthX=new Float32Array(n),depthY=new Float32Array(n),falloff=new Float32Array(n);
  for(let py=0;py<height;py++)for(let px=0;px<width;px++){
    const i=py*width+px,x=(px+.5)/width*w-padding,y=(py+.5)/height*h-padding;
    const dx=Math.max(-x,x-videoWidth,0),dy=Math.max(-y,y-videoHeight,0),d=Math.hypot(dx,dy)/Math.max(1,padding);
    distance[i]=d;if(d>=1)continue;
    depthX[i]=dx/videoWidth;depthY[i]=dy/videoHeight;
    // A two-texel guard inside the picture prevents bilinear upscaling from
    // mixing the seam with zero-valued interior texels. The compositor masks
    // the actual picture, so this guard never lights over the video itself.
    const seamGuard=Math.min(x,videoWidth-x,y,videoHeight-y)<2*Math.max(w/width,h/height);
    falloff[i]=d===0?(seamGuard?1:0):(.55*Math.exp(-d*d/.075)+.45*Math.exp(-d*d/.5))*(1-d*d)**2;
    const ix=Math.min(x,videoWidth-x),iy=Math.min(y,videoHeight-y);
    const corner=d===0?ix/Math.max(1e-9,ix+iy):dx===0?1:dy===0?0:dy/(dx+dy);
    const u=clamp01(x/videoWidth)*15,v=clamp01(y/videoHeight)*8,ua=Math.floor(u),va=Math.floor(v);
    const horizontal=y<videoHeight/2?0:16,vertical=x<videoWidth/2?32:41;
    indices.set([horizontal+ua,horizontal+Math.min(15,ua+1),vertical+va,vertical+Math.min(8,va+1)],i*4);
    weights.set([(1-(u-ua))*corner,(u-ua)*corner,(1-(v-va))*(1-corner),(v-va)*(1-corner)],i*4);
  }
  const result={width,height,indices,weights,distance,depthX,depthY,falloff};geometries.set(key,result);if(geometries.size>6)geometries.delete(geometries.keys().next().value!);return result;
}
const encode=new Uint8ClampedArray(8193);
for(let i=0;i<encode.length;i++)encode[i]=toSRGB([i/8192,0,0])[0];
/** A normalized continuous field. Precomputed geometric weights keep the per-frame
 * pass small; the same color is never added twice at a corner. Interior color is
 * admitted only beyond the near-seam band. */
export function renderLightField(colors:ColorRegion[], videoWidth:number, videoHeight:number, padding:number, settings:BacklightSettings, maxSize=224):LightField {
  const g=geometry(videoWidth,videoHeight,padding,maxSize),data=new Uint8ClampedArray(g.width*g.height*4),radiance=new Float32Array(g.width*g.height*3);
  const profile=PROFILES[settings.toneProfile??'cinema'];
  const average=colors.slice(0,50).reduce((sum,c)=>sum+luminance(toLinear(c.color)),0)/50;
  const adaptation=Math.max(.8,Math.min(1.15,.25/(average+.15)));
  const near=blurredSides(colors,0,.65).flat().map(rgb=>toneColor(rgb,settings,adaptation));
  const far=blurredSides(colors,colors.length>=100?50:0,2.2).flat().map(rgb=>toneColor(rgb,settings,adaptation));
  for(let i=0;i<g.width*g.height;i++){
    if(!g.falloff[i])continue;
    const mix=profile.far*clamp01((g.distance[i]-.12)/.5);
    const energy:RGB=[0,0,0];
    for(let side=0;side<2;side++){
      const k=i*4+side*2,weight=g.weights[k]+g.weights[k+1];if(!weight)continue;
      const first=g.indices[k],second=g.indices[k+1],fraction=g.weights[k+1]/weight;
      const count=side===0?16:9,start=side===0?(first<16?0:16):(first<41?32:41);
      const depth=side===0?g.depthY[i]:g.depthX[i];
      const shiftA=continuationShift(colors[first]?.continuation,depth,g.distance[i]),shiftB=continuationShift(colors[second]?.continuation,depth,g.distance[i]);
      const position=Math.max(0,Math.min(count-1,first-start+fraction+(shiftA+(shiftB-shiftA)*fraction)*(count-1)));
      const a=start+Math.floor(position),b=Math.min(start+count-1,a+1),t=position-Math.floor(position);
      for(let c=0;c<3;c++){
        const av=near[a][c]+(far[a][c]-near[a][c])*mix,bv=near[b][c]+(far[b][c]-near[b][c])*mix;
        energy[c]+=(av+(bv-av)*t)*weight;
      }
    }
    for(let c=0;c<3;c++)radiance[i*3+c]=energy[c]*(g.distance[i]===0?1:g.falloff[i]);
    data[i*4+3]=255;
  }
  // Diffuse the extrapolated field as light, rather than exposing sharp warped
  // contours. Preserve the immediate seam and never bleed into source pixels.
  const horizontal=new Float32Array(radiance.length),kernel=Array.from({length:11},(_,i)=>Math.exp(-.5*((i-5)/2.2)**2)),mass=kernel.reduce((a,b)=>a+b,0);
  for(let y=0;y<g.height;y++)for(let x=0;x<g.width;x++)for(let c=0;c<3;c++){
    let v=0;for(let k=-5;k<=5;k++)v+=radiance[(y*g.width+Math.max(0,Math.min(g.width-1,x+k)))*3+c]*kernel[k+5];
    horizontal[(y*g.width+x)*3+c]=v/mass;
  }
  for(let y=0;y<g.height;y++)for(let x=0;x<g.width;x++){
    const i=y*g.width+x;if(!g.falloff[i])continue;const blend=clamp01((g.distance[i]-.1)/.25);
    for(let c=0;c<3;c++){
      let v=0;for(let k=-5;k<=5;k++)v+=horizontal[(Math.max(0,Math.min(g.height-1,y+k))*g.width+x)*3+c]*kernel[k+5];
      const value=radiance[i*3+c]+(v/mass-radiance[i*3+c])*blend;
      data[i*4+c]=encode[Math.round(clamp01(value)*8192)];
    }
  }
  return {width:g.width,height:g.height,data,padding,videoWidth,videoHeight};
}
/** Reference composition and CPU fallback. Incoming light is linear radiance. */
export function addLight(background:RGB,light:RGB):RGB {
  return background.map((v,i)=>1-(1-v)*(1-light[i])) as RGB;
}
