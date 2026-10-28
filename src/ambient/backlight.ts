// Ambient backlight, adapted from adknate05's Projection Mapper (HECTOR branch `codex/nate-projection-mapper`,
// commit 912f609, src/shared/backlight.ts). Reused with the author's permission; see docs/THIRD_PARTY.md.
// HECTOR changes: the YouTube-player rectifier, edge helper and bridge types are omitted (HECTOR samples the
// already-rectified surface on the GPU), room fill is omitted (it needs the original 3D room model), and settings
// are validated by the scene schema.
import { createPictureTracker, detectActivePicture, type ActivePicture, type PixelFrame } from './activePicture';
export { detectActivePicture, type ActivePicture, type PixelFrame } from './activePicture';
import { contourContinuations, type ColorContinuation } from './colorContinuation';
import { toLinear, toSRGB, linearToLab, gamutMap, luminance } from './lightColor';
export const BACKLIGHT_TONE_PROFILES = ['cinema', 'vivid', 'soft', 'neutral'] as const;
export type BacklightToneProfile = typeof BACKLIGHT_TONE_PROFILES[number];
export const BACKLIGHT_TONE_LABELS: Record<BacklightToneProfile, string> = { cinema: 'Cinema', vivid: 'Vivid', soft: 'Soft', neutral: 'Natural' };
export interface BacklightSettings { intensity: number; spread: number; smoothingMs: number; toneProfile?: BacklightToneProfile; opacity?: number; vibrance?: number }
export const BACKLIGHT_DEFAULTS: Readonly<BacklightSettings> = { intensity: 1, spread: .18, smoothingMs: 180, toneProfile: 'cinema', opacity: 1, vibrance: 1 };
export const BACKLIGHT_LIMITS = { intensity: { min: 0, max: 2 }, spread: { min: .02, max: .4 }, smoothingMs: { min: 0, max: 1000 }, opacity: { min: 0, max: 1 }, vibrance: { min: 0, max: 2 } } as const;
export type RGB = [number, number, number];
export interface ColorRegion { x: number; y: number; color: RGB; weight: number; region: number; continuation?: ColorContinuation }
export interface BacklightSample { colors: ColorRegion[]; sampledAt: number; costMs: number; dark: boolean; picture?: ActivePicture }
export const SAMPLE_WIDTH = 96, SAMPLE_HEIGHT = 54;


/** Colors and geometry use the same stabilized source boundary. A full-size
 * boundary frame can refine bars without increasing the color-analysis cost. */
export function createBacklightAnalyzer() {
  const tracker = createPictureTracker();
  return Object.assign((frame: PixelFrame, now = Date.now(), boundaryFrame = frame): ColorRegion[] =>
    analyzeColors(frame, tracker.update(boundaryFrame, now)),
    { picture: tracker.picture, settling: tracker.settling });
}
/** Stable overlapping strips follow the actual edges, not moving palette blobs.
 * Linear-energy means preserve area proportions, including dark pixels. */
export function analyzeColors(frame: PixelFrame, active=detectActivePicture(frame)): ColorRegion[] {
  const {width,height,data}=frame, colors:ColorRegion[]=[];
  const linear=new Float32Array(width*height*3);
  for(let i=0;i<width*height;i++){
    const rgb:RGB=[data[i*4+(frame.order==='bgra'?2:0)],data[i*4+1],data[i*4+(frame.order==='bgra'?0:2)]];
    const value=toLinear(rgb);linear.set(value,i*3);
  }
  const continuations=contourContinuations(linear,width,height,active);
  // Each edge has a narrow seam band and a separate broad diffusion band.
  // Interior colors can illuminate the far field but never replace the actual seam.
  for(let band=0;band<2;band++)for(let side=0;side<4;side++){
    const horizontal=side<2,count=horizontal?16:9;
    for(let zone=0;zone<count;zone++){
      const center=(zone+.5)/count,sum:RGB=[0,0,0],histogram=new Float32Array(64),samples:{i:number;weight:number;y:number}[]=[];let mass=0;
      const depthMax=band===0?.055:.28,depthCenter=band===0?.012:.13,depthSigma=band===0?.019:.095;
      const u0=horizontal?Math.max(0,center-1.6/count):side===2?0:1-depthMax;
      const u1=horizontal?Math.min(1,center+1.6/count):side===2?depthMax:1;
      const v0=horizontal?(side===0?0:1-depthMax):Math.max(0,center-1.6/count);
      const v1=horizontal?(side===0?depthMax:1):Math.min(1,center+1.6/count);
      const x0=Math.max(0,Math.floor((active.left+u0*(active.right-active.left))*width));
      const x1=Math.min(width,Math.ceil((active.left+u1*(active.right-active.left))*width));
      const y0=Math.max(0,Math.floor((active.top+v0*(active.bottom-active.top))*height));
      const y1=Math.min(height,Math.ceil((active.top+v1*(active.bottom-active.top))*height));
      for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){
        const u=((x+.5)/width-active.left)/(active.right-active.left),v=((y+.5)/height-active.top)/(active.bottom-active.top);
        const along=horizontal?u:v,depth=side===0?v:side===1?1-v:side===2?u:1-u,tangent=(along-center)*count;
        if(u<0||u>1||v<0||v>1||depth>depthMax)continue;
        const weight=Math.exp(-.5*(tangent/.72)**2)*Math.exp(-.5*((depth-depthCenter)/depthSigma)**2),i=(y*width+x)*3;
        const luma=.2126*linear[i]+.7152*linear[i+1]+.0722*linear[i+2];
        histogram[Math.min(63,Math.floor(luma*64))]+=weight;samples.push({i,weight,y:luma});mass+=weight;
      }
      // A small caption/logo/specular highlight must not turn a dark edge white.
      // Weighted 80th percentile limits only outliers; broad bright areas remain bright.
      let cumulative=0,percentile=0;
      for(let i=0;i<64;i++){cumulative+=histogram[i];if(cumulative>=mass*.8){percentile=(i+1)/64;break;}}
      const ceiling=Math.max(.015,percentile*2);
      for(const sample of samples){const gain=sample.y>ceiling?ceiling/sample.y:1;for(let c=0;c<3;c++)sum[c]+=linear[sample.i+c]*sample.weight*gain;}
      colors.push({region:colors.length,x:horizontal?center:side===2?0:1,y:horizontal?side:center,color:toSRGB(sum.map(c=>mass?c/mass:0) as RGB),weight:1,continuation:continuations[colors.length%50]});
    }
  }
  return colors;
}
export function smoothColors(previous: ColorRegion[], next: ColorRegion[], elapsedMs: number, smoothingMs: number): ColorRegion[] {
  if(smoothingMs<=0||!previous.length)return next;
  const oldByRegion=new Map(previous.map(c=>[c.region,c]));
  const changes=next.map(target=>{
    const old=oldByRegion.get(target.region)??target;
    const a=linearToLab(toLinear(old.color)),b=linearToLab(toLinear(target.color));
    return Math.hypot(...a.map((c,i)=>c-b[i]));
  });
  // A broad coherent change is a cut; a small local change is motion/noise.
  const cut=changes.filter(d=>d>.18).length>next.length*.55;
  const dt=Math.max(0,Math.min(250,elapsedMs));
  return next.map((target,index)=>{
    const old=oldByRegion.get(target.region);if(!old)return target;
    const prior=linearToLab(toLinear(old.color)),goal=linearToLab(toLinear(target.color));
    const tau=cut?Math.min(70,smoothingMs):smoothingMs*(changes[index]<.025?1.6:1);
    const alpha=1-Math.exp(-dt/Math.max(1,tau));
    const lab=prior.map((c,i)=>c+(goal[i]-c)*alpha) as RGB;
    // Bound perceptual luminance slew separately, even across full-screen flashes.
    const limit=dt/(cut?320:500);
    lab[0]=prior[0]+Math.max(-limit,Math.min(limit,lab[0]-prior[0]));
    const a=old.continuation,b=target.continuation,orientationAlpha=1-Math.exp(-dt/(cut?70:Math.max(240,smoothingMs)));
    const continuation=b?{slope:(a?.slope??b.slope)+(b.slope-(a?.slope??b.slope))*orientationAlpha,curvature:(a?.curvature??b.curvature)+(b.curvature-(a?.curvature??b.curvature))*orientationAlpha,confidence:(a?.confidence??0)+(b.confidence-(a?.confidence??0))*orientationAlpha}:undefined;
    return {...target,color:toSRGB(gamutMap(lab)),continuation};
  });
}
export function darkColors(colors: ColorRegion[]) { return colors.every(c => c.weight === 0 || luminance(toLinear(c.color)) < .004); }
