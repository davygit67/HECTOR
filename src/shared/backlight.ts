import { createPictureTracker, detectActivePicture, type ActivePicture, type PixelFrame } from './activePicture.js';
export { detectActivePicture, type ActivePicture, type PixelFrame } from './activePicture.js';
import { contourContinuations, type ColorContinuation } from './colorContinuation.js';
import { toLinear, toSRGB, linearToLab, gamutMap, luminance } from './lightColor.js';
import { homography, project, type Quad } from './geometry.js';
export const BACKLIGHT_TONE_PROFILES = ['cinema', 'vivid', 'soft', 'neutral'] as const;
export type BacklightToneProfile = typeof BACKLIGHT_TONE_PROFILES[number];
export const BACKLIGHT_TONE_LABELS: Record<BacklightToneProfile, string> = { cinema: 'Cinema', vivid: 'Vivid', soft: 'Soft', neutral: 'Natural' };
export interface BacklightSettings { intensity: number; spread: number; smoothingMs: number; toneProfile?: BacklightToneProfile; opacity?: number; vibrance?: number; roomFill?: number }
export const BACKLIGHT_DEFAULTS: Readonly<BacklightSettings> = { intensity: 1, spread: .18, smoothingMs: 180, toneProfile: 'cinema', opacity: 1, vibrance: 1, roomFill: 0 };
export const BACKLIGHT_LIMITS = { intensity: { min: 0, max: 2 }, spread: { min: .02, max: .4 }, smoothingMs: { min: 0, max: 1000 }, opacity: { min: 0, max: 1 }, vibrance: { min: 0, max: 2 }, roomFill: { min: 0, max: 1 } } as const;
export function validateBacklightSettings(value: unknown, partial = false): asserts value is BacklightSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Backlight settings must be an object.');
  const settings = value as Record<string, unknown>;
  if (Object.keys(settings).some(key => key !== 'toneProfile' && !Object.hasOwn(BACKLIGHT_LIMITS, key)) || (!partial && ['intensity','spread','smoothingMs'].some(key => !Object.hasOwn(settings, key)))) throw new Error('Use intensity, spread, smoothingMs, toneProfile, opacity, vibrance and roomFill for backlight settings.');
  for (const [key, val] of Object.entries(settings)) {
    if (key === 'toneProfile') { if (!BACKLIGHT_TONE_PROFILES.includes(val as BacklightToneProfile)) throw new Error('Choose cinema, vivid, soft or neutral lighting.'); continue; }
    const range = BACKLIGHT_LIMITS[key as keyof typeof BACKLIGHT_LIMITS];
    if (typeof val !== 'number' || !Number.isFinite(val) || val < range.min || val > range.max || key === 'smoothingMs' && !Number.isInteger(val)) throw new Error(key + ' must be ' + range.min + '–' + range.max + (key === 'smoothingMs' ? ' whole milliseconds.' : '.'));
  }
}
export type RGB = [number, number, number];
export interface ColorRegion { x: number; y: number; color: RGB; weight: number; region: number; continuation?: ColorContinuation }
export interface BacklightSample { colors: ColorRegion[]; sampledAt: number; costMs: number; dark: boolean; picture?: ActivePicture }
export interface BacklightRequest { contentId: string; quad: Quad; viewport: { width: number; height: number } }
export interface BacklightBridge { sample(request: BacklightRequest): Promise<BacklightSample> }
export const SAMPLE_WIDTH = 96, SAMPLE_HEIGHT = 54;

/** Extend a sampled location to the video perimeter. Lobes centered inside the
 * opaque player are invisible; retain the sample's direction and color weight. */
export function backlightEdge(region: Pick<ColorRegion, 'x' | 'y'>) {
  const x = region.x - .5, y = region.y - .5, distance = Math.max(Math.abs(x), Math.abs(y));
  return distance < 1e-6 ? { x: .5, y: 0 } : { x: .5 + x / (2 * distance), y: .5 + y / (2 * distance) };
}

/** Rectify the projected video quadrilateral before sampling. No pixels outside it or its controls/footer enter analysis. */
export function rectifyVideo(frame: PixelFrame, quad: Quad): PixelFrame {
  if (frame.width < 1 || frame.height < 1 || frame.data.length !== frame.width * frame.height * 4) throw new Error('Invalid video sample.');
  const normalized = quad.map(p => ({ x: p.x / frame.width, y: p.y / frame.height })) as Quad;
  const h = homography(normalized), data = new Uint8ClampedArray(SAMPLE_WIDTH * SAMPLE_HEIGHT * 4);
  for (let y = 0; y < SAMPLE_HEIGHT; y++) for (let x = 0; x < SAMPLE_WIDTH; x++) {
    // Avoid player chrome near the frame edge. Letterboxing remains dark; no fabricated colors.
    const uv = { x: .01 + (x + .5) / SAMPLE_WIDTH * .98, y: .01 + (y + .5) / SAMPLE_HEIGHT * .98 };
    const p = project(h, uv), sx = Math.max(0, Math.min(frame.width - 1, Math.floor(p.x * frame.width))), sy = Math.max(0, Math.min(frame.height - 1, Math.floor(p.y * frame.height)));
    const a = (sy * frame.width + sx) * 4, b = (y * SAMPLE_WIDTH + x) * 4;
    data[b] = frame.data[a + (frame.order === 'bgra' ? 2 : 0)]; data[b + 1] = frame.data[a + 1]; data[b + 2] = frame.data[a + (frame.order === 'bgra' ? 0 : 2)]; data[b + 3] = 255;
  }
  return { width: SAMPLE_WIDTH, height: SAMPLE_HEIGHT, data };
}
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
