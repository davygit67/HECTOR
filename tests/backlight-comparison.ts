import '../src/browserMedia';
import { bridge } from '../src/bridge';
import { analyzeColors, BACKLIGHT_DEFAULTS, type ColorRegion } from '../src/shared/backlight';
import { analyzeColors as oldAnalyze, rectifyVideo as oldRectify, backlightEdge } from './fixtures/legacy-backlight';
import { paintArt, paintYouTubeBacklight } from '../src/contentPainter';
import { updateBacklight } from '../src/backlightField';
import { youtubePlayerLayout } from '../src/shared/youtube';
import type { MediaEvent } from '../src/shared/media';
import type { YouTubeContent } from '../src/shared/content';

const before=document.querySelector<HTMLCanvasElement>('#before')!,after=document.querySelector<HTMLCanvasElement>('#after')!;
const small=document.createElement('canvas');small.width=192;small.height=108;const smallCtx=small.getContext('2d',{willReadFrequently:true})!;
const scene=(await bridge.getSnapshot()).scene,video=scene.contents.find(c=>c.kind==='youtube') as YouTubeContent;
const art=scene.contents.find(c=>c.kind==='art'&&c.surfaceId===video?.surfaceId),surface=scene.surfaces.find(s=>s.id===video?.surfaceId)!;
let frozen=false,frames=0,latest:Extract<MediaEvent,{type:'frame'}>['frame']|undefined,busy=false;
const freeze=document.querySelector<HTMLButtonElement>('#freeze')!;freeze.onclick=()=>{frozen=!frozen;freeze.textContent=frozen?'Resume comparison':'Freeze comparison';};
function oldLight(ctx:CanvasRenderingContext2D,colors:ColorRegion[]){
 const s={...BACKLIGHT_DEFAULTS,...video.config.backlightSettings},l=youtubePlayerLayout(video.bounds),b={x:video.bounds.x+l.left/1920,y:video.bounds.y+l.top/1080,w:l.width/1920,h:l.height/1080};
 ctx.save();ctx.globalCompositeOperation='screen';for(const c of colors){if(c.weight<.015||Math.max(...c.color)<8)continue;const edge=backlightEdge(c),x=(b.x+edge.x*b.w)*960,y=(b.y+edge.y*b.h)*540,r=s.spread*540,alpha=Math.min(.9,c.weight*s.intensity*.72),rgb=c.color.map(Math.round).join(',');const g=ctx.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,`rgba(${rgb},${alpha})`);g.addColorStop(.45,`rgba(${rgb},${alpha*.65})`);g.addColorStop(1,`rgba(${rgb},0)`);ctx.fillStyle=g;ctx.fillRect(x-r,y-r,r*2,r*2);}ctx.restore();
}
async function render(){
 if(busy||frozen||!latest||!video)return;busy=true;const frame=latest;latest=undefined;
 try{
 const bitmap=await createImageBitmap(new Blob([new Uint8Array(frame.jpeg)],{type:'image/jpeg'}));smallCtx.drawImage(bitmap,0,0,192,108);const pixels=smallCtx.getImageData(0,0,192,108);
 const now=Date.now(),start=performance.now(),colors=analyzeColors(pixels),analysisMs=performance.now()-start;
 const old=oldAnalyze(oldRectify(pixels,[{x:0,y:0},{x:192,y:0},{x:192,y:108},{x:0,y:108}]));
 updateBacklight(video.id,{colors,sampledAt:now,costMs:analysisMs,dark:false},0);
 const l=youtubePlayerLayout(video.bounds),x=video.bounds.x*960+l.left/2,y=video.bounds.y*540+l.top/2;
 let newMs=0;
 for(const [canvas,legacy] of [[before,true],[after,false]] as const){const ctx=canvas.getContext('2d',{willReadFrequently:true})!;ctx.fillStyle='#071d28';ctx.fillRect(0,0,960,540);if(art?.kind==='art')paintArt(ctx,art,surface,960,540,now);const t=performance.now();if(legacy)oldLight(ctx,old);else paintYouTubeBacklight(ctx,video,960,540,now);if(!legacy)newMs=performance.now()-t;ctx.drawImage(bitmap,x,y,l.width/2,l.height/2);}
 bitmap.close();frames++;
 document.querySelector('#status')!.textContent=`${frames} shared frames compared · generation ${frame.generation} · sequence ${frame.sequence} · identical source image and settings`;
 document.querySelector('#results')!.textContent=JSON.stringify({tone:video.config.backlightSettings?.toneProfile??'cinema',analysisMs:Math.round(analysisMs*100)/100,newCompositionMs:Math.round(newMs*100)/100,sceneRevision:scene.revision,videoId:video.config.videoId,videoPixels:'same decoded bitmap on both canvases',screenSharing:false},null,2);
 }finally{busy=false;if(latest)void render()}
}
const receive=(event:MediaEvent)=>{if(event.type==='frame'&&event.frame.contentId===video?.id){latest=event.frame;void render()}};
const stop=window.projectionMedia!.subscribe(receive);(await window.projectionMedia!.snapshot()).forEach(receive);window.addEventListener('pagehide',stop);
