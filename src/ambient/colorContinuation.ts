// Ambient backlight, adapted from adknate05's Projection Mapper (HECTOR branch `codex/nate-projection-mapper`,
// commit 912f609, src/shared/colorContinuation.ts). Reused with the author's permission; see docs/THIRD_PARTY.md.
/** Local contour continuation in normalized picture coordinates. This is a
 * confidence-limited geometric estimate, not semantic image outpainting. */
export interface ColorContinuation { slope:number; curvature:number; confidence:number }
const bounded=(v:number,limit:number)=>Math.max(-limit,Math.min(limit,v));
export function contourContinuations(linear:Float32Array,width:number,height:number,active:{left:number;right:number;top:number;bottom:number}):ColorContinuation[] {
  // A small low-pass suppresses fine texture, captions and sampling noise before
  // measuring the dominant direction of broad color boundaries.
  const horizontalBlur=new Float32Array(linear.length),blurred=new Float32Array(linear.length);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)for(let c=0;c<3;c++){
    let total=0;for(let dx=-2;dx<=2;dx++)total+=linear[(y*width+Math.max(0,Math.min(width-1,x+dx)))*3+c];
    horizontalBlur[(y*width+x)*3+c]=total/5;
  }
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)for(let c=0;c<3;c++){
    let total=0;for(let dy=-2;dy<=2;dy++)total+=horizontalBlur[(Math.max(0,Math.min(height-1,y+dy))*width+x)*3+c];
    blurred[(y*width+x)*3+c]=total/5;
  }
  const result:ColorContinuation[]=[],aw=(active.right-active.left)*width,ah=(active.bottom-active.top)*height;
  for(let side=0;side<4;side++){
    const horizontal=side<2,count=horizontal?16:9;
    for(let zone=0;zone<count;zone++){
      const tensors=[[0,0,0,0],[0,0,0,0]],center=(zone+.5)/count;
      const depthMax=.24,u0=horizontal?Math.max(0,center-1.8/count):side===2?0:1-depthMax,u1=horizontal?Math.min(1,center+1.8/count):side===2?depthMax:1;
      const v0=horizontal?(side===0?0:1-depthMax):Math.max(0,center-1.8/count),v1=horizontal?(side===0?depthMax:1):Math.min(1,center+1.8/count);
      for(let y=Math.max(1,Math.floor(active.top*height+v0*ah));y<Math.min(height-1,Math.ceil(active.top*height+v1*ah));y++)for(let x=Math.max(1,Math.floor(active.left*width+u0*aw));x<Math.min(width-1,Math.ceil(active.left*width+u1*aw));x++){
        const u=(x+.5-active.left*width)/aw,v=(y+.5-active.top*height)/ah,along=horizontal?u:v,depth=side===0?v:side===1?1-v:side===2?u:1-u;
        if(depth<.008||depth>.24)continue;
        const weight=Math.exp(-.5*(((along-center)*count)/.95)**2),tensor=tensors[depth<.11?0:1];
        for(let c=0;c<3;c++){
          const gx=(blurred[(y*width+x+1)*3+c]-blurred[(y*width+x-1)*3+c])*aw/2;
          const gy=(blurred[((y+1)*width+x)*3+c]-blurred[((y-1)*width+x)*3+c])*ah/2;
          const tangent=horizontal?gx:gy,normal=(horizontal?gy:gx)*(side===1||side===3?-1:1);
          tensor[0]+=tangent*tangent*weight;tensor[1]+=normal*normal*weight;tensor[2]+=tangent*normal*weight;
        }tensor[3]+=weight;
      }
      const estimate=(a:number[])=>{
        const [tt,nn,tn,mass]=a,trace=tt+nn;
        const coherence=Math.sqrt((tt-nn)**2+4*tn*tn)/(trace+1e-9);
        return {slope:bounded(-tn/(tt+.02*mass+1e-9),2),confidence:coherence*tt/(tt+.1*mass+1e-9)};
      };
      const near=estimate(tensors[0]),inside=estimate(tensors[1]);
      result.push({slope:near.slope,curvature:bounded((inside.slope-near.slope)/.12,4)*inside.confidence,confidence:near.confidence});
    }
  }
  return result;
}
/** Pull an exterior location back to the picture edge along the estimated curve.
 * Confidence collapses for flat/noisy regions; near-seam displacement is zero. */
export function continuationShift(value:ColorContinuation|undefined,depth:number,distance:number):number {
  if(!value)return 0;
  const ramp=Math.max(0,Math.min(1,(distance-.08)/.3));
  return bounded((value.slope*depth-.5*value.curvature*depth*depth)*value.confidence*ramp*ramp*(3-2*ramp),.3);
}
