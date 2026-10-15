import {initialScene,reduceScene} from '../src/shared/domain';
import {analyzeColors,BACKLIGHT_DEFAULTS} from '../src/shared/backlight';
import {updateBacklight} from '../src/backlightField';
import {paintSceneBacklight} from '../src/contentPainter';
let scene=reduceScene(initialScene(),{type:'content.create',id:'video',surfaceId:'wall',title:'Video',spec:{kind:'youtube',config:{videoId:'M7lc1UVf-VE',startSeconds:0,backlight:true}}});
scene=reduceScene(scene,{type:'content.move',id:'video',bounds:{x:.3,y:.2,w:.6,h:.6}});
for(const [id,x] of [['timer1',.1],['timer2',.2]] as const){scene=reduceScene(scene,{type:'timer.create',id,title:id,durationMs:60000,surfaceId:'tabletop'});scene=reduceScene(scene,{type:'timer.move',id,bounds:{x,y:.2,w:.3,h:.3}});}
const source=document.createElement('canvas');source.width=192;source.height=108;const ctx=source.getContext('2d')!,gradient=ctx.createLinearGradient(0,0,192,108);gradient.addColorStop(0,'#ed1688');gradient.addColorStop(.5,'#6742d4');gradient.addColorStop(1,'#149ada');ctx.fillStyle=gradient;ctx.fillRect(0,0,192,108);
const now=Date.now();updateBacklight('video',{colors:analyzeColors(ctx.getImageData(0,0,192,108)),sampledAt:now,costMs:0,dark:false},0);
const results:Record<string,unknown>[]=[];
for(const roomFill of [0,.5,1]){
 scene=reduceScene(scene,{type:'youtube.backlight.configure',id:'video',settings:{...BACKLIGHT_DEFAULTS,roomFill,intensity:1.8,vibrance:1.4}});
 const section=document.createElement('section'),heading=document.createElement('h2');heading.textContent=`Room fill ${roomFill*100}%`;section.append(heading);document.querySelector('#views')!.append(section);
 for(const id of ['wall','tabletop']){
  const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;section.append(canvas);const c=canvas.getContext('2d')!,surface=scene.surfaces.find(s=>s.id===id)!;
  c.fillStyle='#000';c.fillRect(0,0,640,360);paintSceneBacklight(c,scene,surface,640,360,now);
  const pixel=(u:number,v:number)=>Array.from(c.getImageData(Math.floor(u*640),Math.floor(v*360),1,1).data).slice(0,3);
  results.push({roomFill,surface:id,free:pixel(.6,.85),protected:pixel(id==='wall'?.5:.25,.35),overlap:pixel(id==='wall'?.6:.35,.35),hole:pixel(.1,.6),outside:pixel(.99,.01)});
 }
}
const full=results.filter(r=>r.roomFill===1),pass=full.every(r=>(r.free as number[]).some(c=>c>30)&&(r.protected as number[]).every(c=>c===0)&&(r.overlap as number[]).every(c=>c===0))&&(full[0].hole as number[]).every(c=>c===0)&&(full[0].outside as number[]).every(c=>c===0);
// Zero opacity must produce exactly the background, independently of fill.
scene=reduceScene(scene,{type:'youtube.backlight.configure',id:'video',settings:{opacity:0}});const zero=document.createElement('canvas');zero.width=64;zero.height=36;const z=zero.getContext('2d')!;z.fillStyle='#123456';z.fillRect(0,0,64,36);paintSceneBacklight(z,scene,scene.surfaces[0],64,36,now);const opacityZero=Array.from(z.getImageData(40,30,1,1).data).slice(0,3).join(',')==='18,52,86';
const seamSamples:number[][]=[];
for(const roomFill of [0,.01]){
 scene=reduceScene(scene,{type:'youtube.backlight.configure',id:'video',settings:{opacity:1,roomFill}});
 const check=document.createElement('canvas');check.width=640;check.height=360;const c=check.getContext('2d')!;c.fillStyle='#000';c.fillRect(0,0,640,360);paintSceneBacklight(c,scene,scene.surfaces.find(s=>s.id==='wall')!,640,360,now);
 seamSamples.push(Array.from(c.getImageData(384,306,1,1).data).slice(0,3));
}
const localTransition=seamSamples[0].every((v,i)=>Math.abs(v-seamSamples[1][i])<12);
document.querySelector('#results')!.textContent=JSON.stringify({passed:pass&&opacityZero&&localTransition,opacityZero,localTransition,seamSamples,results},null,2);
