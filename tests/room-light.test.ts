import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeColors, BACKLIGHT_DEFAULTS, validateBacklightSettings } from '../src/shared/backlight.ts';
import { initialScene, readScene, reduceScene, type Command } from '../src/shared/domain.ts';
import { createRoomLightMap, mapRoomLight, roomLightPoint, lightProtectedBounds } from '../src/shared/roomLight.ts';
import { renderLightField, toneColor } from '../src/shared/lightField.ts';
import { linearToLab } from '../src/shared/lightColor.ts';
import { add, sub, scale, surfacePoint } from '../src/shared/spatial.ts';
import type { YouTubeContent } from '../src/shared/content.ts';
function fixture(){let scene=reduceScene(initialScene(),{type:'surface.demo-exclusion',id:'wall',enabled:false});scene=reduceScene(scene,{type:'content.create',id:'video',surfaceId:'wall',title:'Video',spec:{kind:'youtube',config:{videoId:'M7lc1UVf-VE',startSeconds:20,backlight:true}}});return scene;}
const data=new Uint8ClampedArray(192*108*4);for(let i=0;i<192*108;i++)data.set([30,90,200,255],i*4);const colors=analyzeColors({width:192,height:108,data});
test('optional opacity/vibrance/roomFill preserve legacy config and change atomically',()=>{
 validateBacklightSettings({intensity:1,spread:.2,smoothingMs:180});let scene=fixture(),before=structuredClone(scene);
 scene=reduceScene(scene,{type:'youtube.backlight.configure',id:'video',settings:{opacity:.7,vibrance:1.5,roomFill:.8}});
 const video=scene.contents[0] as YouTubeContent;assert.deepEqual(video.config.backlightSettings,{...BACKLIGHT_DEFAULTS,opacity:.7,vibrance:1.5,roomFill:.8});
 assert.equal(video.config.startSeconds,20);assert.deepEqual(video.bounds,before.contents[0].bounds);assert.deepEqual(scene.surfaces,before.surfaces);assert.deepEqual(readScene(scene),scene);
 for(const settings of [{opacity:1.1},{roomFill:-1},{vibrance:3},{roomFill:'all'},{coverage:'room'}])assert.throws(()=>reduceScene(scene,{type:'youtube.backlight.configure',id:'video',settings} as Command));
});
test('room mapping is coherent along viewer rays and fills distant table instead of a second halo',()=>{
 const scene=fixture(),video=scene.contents[0] as YouTubeContent,wall=scene.surfaces.find(s=>s.id==='wall')!,table=scene.surfaces.find(s=>s.id==='tabletop')!;
 const world=surfacePoint(wall,{x:.2,y:.8}),along=add(scene.viewer.position,scale(sub(world,scene.viewer.position),.4));
 const a=roomLightPoint(scene,wall,video,world),b=roomLightPoint(scene,wall,video,along);assert.ok(Math.abs(a.x-b.x)<1e-9&&Math.abs(a.y-b.y)<1e-9);
 const energies:number[]=[];
 for(const roomFill of [0,.5,1]){
  video.config.backlightSettings={...BACKLIGHT_DEFAULTS,roomFill};const source=renderLightField(colors,640,360,200*(1+3*roomFill),video.config.backlightSettings);
  const mapped=mapRoomLight(source,createRoomLightMap(scene,wall,table,video,source,64,36),1920,1080);
  energies.push(mapped.data.reduce((sum,c,i)=>sum+(i%4===2?c:0),0));
  if(roomFill===1)assert.ok(Array.from({length:64*36},(_,i)=>mapped.data[i*4+2]).every(c=>c>25),'all tabletop points receive source light');
 }
 assert.ok(energies[0]<energies[1]&&energies[1]<energies[2]);
});
test('vibrance changes color richness independently of room extent and blacks remain black',()=>{
 const gray=linearToLab(toneColor([.15,.03,.4],{...BACKLIGHT_DEFAULTS,vibrance:0}));assert.ok(Math.hypot(gray[1],gray[2])<1e-5);
 const plain=linearToLab(toneColor([.15,.03,.4],{...BACKLIGHT_DEFAULTS,vibrance:1})),vivid=linearToLab(toneColor([.15,.03,.4],{...BACKLIGHT_DEFAULTS,vibrance:1.7}));
 assert.ok(Math.hypot(vivid[1],vivid[2])>Math.hypot(plain[1],plain[2]));assert.deepEqual(toneColor([0,0,0],{...BACKLIGHT_DEFAULTS,vibrance:2,roomFill:1}),[0,0,0]);
});
test('all foreground bounds are protected across surfaces without extra light assets',()=>{
 const scene=fixture();scene.timers.push({id:'clock',surfaceId:'tabletop',title:'Clock',bounds:{x:.2,y:.2,w:.3,h:.3},durationMs:60000,remainingMs:60000,status:'idle',deadline:null} as typeof scene.timers[number]);
 assert.equal(lightProtectedBounds(scene,'wall').length,1);assert.equal(lightProtectedBounds(scene,'tabletop').length,1);assert.equal(scene.contents.length,1);
});
