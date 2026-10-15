import { analyzeColors } from '../src/shared/backlight';
import { initialScene, reduceScene } from '../src/shared/domain';
import { startNativeMedia, configureMedia, readMediaImage } from '../src/nativeMedia';
import { paintContent, paintYouTubeBacklight } from '../src/contentPainter';
import type { MediaEvent } from '../src/shared/media';

const canvas = document.querySelector('canvas')!, ctx = canvas.getContext('2d')!;
const source = document.createElement('canvas'); source.width = 1920; source.height = 1080;
const sc = source.getContext('2d')!; sc.fillStyle='#0066ff';sc.fillRect(0,0,960,1080);sc.fillStyle='#ff5500';sc.fillRect(960,0,960,1080);
const jpeg = new Uint8Array(await (await new Promise<Blob>(r=>source.toBlob(b=>r(b!), 'image/jpeg', .85))).arrayBuffer());
const small = document.createElement('canvas');small.width=96;small.height=54;const smallCtx=small.getContext('2d')!;smallCtx.drawImage(source,0,0,96,54);
let emit: (event: MediaEvent) => void = () => {};
window.projectionMedia = { subscribe: listener => {emit=listener;return()=>{}}, snapshot:async()=>[], command:async()=>{}, input:async()=>{} };
const stop = startNativeMedia();
await Promise.resolve();
let scene = reduceScene(initialScene(), {type:'content.create',id:'native-check',surfaceId:'wall',title:'Native test',spec:{kind:'youtube',config:{videoId:'M7lc1UVf-VE',startSeconds:0,backlight:true,backlightSettings:{intensity:1.4,spread:.3,smoothingMs:0}}}});
scene=reduceScene(scene,{type:'content.move',id:'native-check',bounds:{x:.2,y:.2,w:.6,h:.6}});configureMedia(scene);
const state={contentId:'native-check',generation:1,ready:true,playing:false,hasPlayed:true,muted:true,status:'Paused fixture',currentTime:0,duration:30};
emit({type:'state',state});emit({type:'frame',frame:{contentId:state.contentId,generation:1,sequence:1,width:1920,height:1080,jpeg,sample:{colors:analyzeColors(smallCtx.getImageData(0,0,96,54)),sampledAt:Date.now(),costMs:1,dark:false}}});
const start=Date.now();while(!readMediaImage(state.contentId)&&Date.now()-start<5000) await new Promise(r=>setTimeout(r,25));
await new Promise(r=>setTimeout(r,150));
const video=scene.contents[0];
function draw(enabled: boolean){ctx.fillStyle='#000';ctx.fillRect(0,0,960,540);ctx.save();ctx.beginPath();ctx.rect(0,0,960,540);ctx.rect(130,260,20,20);ctx.clip('evenodd');paintYouTubeBacklight(ctx,{...video,config:{...video.config,backlight:enabled}} as typeof video,960,540);ctx.restore();paintContent(ctx,video,960,540,Date.now());}
function pixels(){return {excluded:Array.from(ctx.getImageData(135,265,1,1).data),left:Array.from(ctx.getImageData(165,270,1,1).data),right:Array.from(ctx.getImageData(795,270,1,1).data),videoLeft:Array.from(ctx.getImageData(300,270,1,1).data),videoRight:Array.from(ctx.getImageData(650,270,1,1).data)}}
draw(false);const off=pixels();draw(true);const on=pixels();
// A late source frame may never restore pixels after that asset was removed.
emit({type:'removed',contentId:state.contentId});
emit({type:'frame',frame:{contentId:state.contentId,generation:1,sequence:2,width:1920,height:1080,jpeg,sample:{colors:[],sampledAt:Date.now(),costMs:0,dark:true}}});
await new Promise(r=>setTimeout(r,50));
const removed=!readMediaImage(state.contentId);
const passed=off.left[2]===0&&off.right[0]===0&&on.left[2]>40&&on.right[0]>40&&on.videoLeft[2]>200&&on.videoRight[0]>200&&removed&&on.excluded.slice(0,3).every(c=>c===0);
document.querySelector('#results')!.textContent=JSON.stringify({passed,off,on,removed},null,2);stop();
