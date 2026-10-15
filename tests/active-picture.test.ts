import test from 'node:test';
import assert from 'node:assert/strict';
import { createPictureTracker, detectActivePicture, FULL_PICTURE, type PixelFrame } from '../src/shared/activePicture.ts';
import { createBacklightAnalyzer } from '../src/shared/backlight.ts';
import { youtubePictureBounds } from '../src/shared/youtube.ts';
import { initialScene, reduceScene } from '../src/shared/domain.ts';
import { lightProtectedBounds, roomLightPoint } from '../src/shared/roomLight.ts';
import { manualAlignment, alignmentCorners } from '../src/shared/manualAlignment.ts';
import { surfacePoint } from '../src/shared/spatial.ts';
import type { YouTubeContent } from '../src/shared/content.ts';

function pixels(w: number, h: number, rgb: (x: number, y: number) => number[]): PixelFrame {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y=0;y<h;y++) for(let x=0;x<w;x++) data.set([...rgb(x,y),255],(y*w+x)*4);
  return {width:w,height:h,data};
}
const bars = pixels(192,108,(x,y)=>y<12||y>=96?[8+x%3,8+x%3,8+x%3]:[30,100,180]);
const crop = {left:0,top:12/108,right:1,bottom:96/108};
const lit = pixels(192,108,()=>[30,100,180]);
const black = pixels(192,108,()=>[0,0,0]);

test('detects compressed letterbox, pillarbox, portrait and windowbox at source pixel precision',()=>{
  assert.deepEqual(detectActivePicture(bars),crop);
  for(const margin of [24,66]){
    const frame=pixels(192,108,x=>x<margin||x>=192-margin?[0,0,0]:[30,100,180]);
    assert.deepEqual(detectActivePicture(frame),{left:margin/192,right:1-margin/192,top:0,bottom:1});
  }
  const windowbox=pixels(192,108,(x,y)=>x<20||x>=172||y<12||y>=96?[0,0,0]:[30,100,180]);
  assert.deepEqual(detectActivePicture(windowbox),{left:20/192,right:172/192,top:12/108,bottom:96/108});
  const full=pixels(1920,1080,(_x,y)=>y<137||y>=943?[0,0,0]:[30,100,180]);
  assert.deepEqual(detectActivePicture(full),{left:0,right:1,top:137/1080,bottom:943/1080});
});
test('does not crop single-sided shadows, blue edges, black frames or a tiny light in a dark room',()=>{
  const fixtures=[black,pixels(192,108,x=>x<20?[0,0,0]:[30,100,180]),pixels(192,108,(_x,y)=>y<12||y>=96?[3,10,45]:[30,100,180]),pixels(192,108,(x,y)=>x===96&&y===54?[255,255,255]:[0,0,0])];
  for(const frame of fixtures) assert.deepEqual(detectActivePicture(frame),FULL_PICTURE);
});
test('stable matte survives long fades and captions; aspect expansion does not wait for inward hysteresis',()=>{
  const tracker=createPictureTracker();
  assert.deepEqual(tracker.update(bars,0),FULL_PICTURE);
  assert.deepEqual(tracker.update(bars,601),crop);
  tracker.update(black,700);tracker.update(black,5000);
  assert.deepEqual(tracker.picture(),crop);
  const caption=pixels(192,108,(x,y)=>y<12||y>=96?(x>70&&x<122&&y>99&&y<103?[255,255,255]:[0,0,0]):[30,100,180]);
  tracker.update(caption,5100);tracker.update(caption,6000);
  assert.deepEqual(tracker.picture(),crop,'small caption must not expand the picture');
  tracker.update(lit,6100);assert.deepEqual(tracker.update(lit,6230),FULL_PICTURE);
  tracker.update(bars,7000);tracker.update(lit,7300);tracker.update(bars,7500);
  assert.deepEqual(tracker.update(bars,8000),FULL_PICTURE,'brief/repeated dark borders must not bypass settling');
  assert.deepEqual(tracker.update(bars,8101),crop);
  assert.deepEqual(createPictureTracker().picture(),FULL_PICTURE,'new sources do not inherit an old crop');
});
test('boundary metadata and colors share one stable full-resolution observation',()=>{
  const analyze=createBacklightAnalyzer();
  const full=pixels(1920,1080,(_x,y)=>y<125||y>=955?[0,0,0]:[30,100,180]);
  analyze(bars,100,full);const colors=analyze(bars,800,full);
  assert.deepEqual(analyze.picture(),{left:0,right:1,top:125/1080,bottom:955/1080});
  assert.ok(colors[0].color[2]>170);
  assert.equal(analyze.settling(),false);
});
test('light masks, room mapping and alignment all follow the same picture without changing scene geometry',()=>{
  let scene=reduceScene(initialScene(),{type:'content.create',id:'video',surfaceId:'wall',title:'Video',spec:{kind:'youtube',config:{videoId:'M7lc1UVf-VE',startSeconds:0,backlight:true}}});
  scene=reduceScene(scene,{type:'content.move',id:'video',bounds:{x:.2,y:.1,w:.6,h:.8}});
  scene=reduceScene(scene,{type:'manual.target',surfaceId:'wall'});
  const before=JSON.stringify(scene),video=scene.contents[0] as YouTubeContent,wall=scene.surfaces.find(s=>s.id==='wall')!;
  const full=youtubePictureBounds(video.bounds),picture=youtubePictureBounds(video.bounds,crop);
  assert.ok(full.y>video.bounds.y&&full.h<video.bounds.h,'transparent layout padding excluded even before detection');
  assert.ok(picture.y>full.y&&picture.h<full.h);
  assert.deepEqual(lightProtectedBounds(scene,'wall',()=>crop),[picture]);
  const anchor=manualAlignment(scene,()=>crop);assert.deepEqual(anchor.bounds,picture);
  assert.deepEqual(anchor.corners,alignmentCorners(scene.manualOutput.quad,picture));
  const topLeft=roomLightPoint(scene,wall,video,surfacePoint(wall,{x:picture.x,y:picture.y}),crop);
  const bottomRight=roomLightPoint(scene,wall,video,surfacePoint(wall,{x:picture.x+picture.w,y:picture.y+picture.h}),crop);
  assert.ok(Math.abs(topLeft.x)<1e-9&&Math.abs(topLeft.y)<1e-9);
  assert.ok(Math.abs(bottomRight.x-1)<1e-9&&Math.abs(bottomRight.y-1)<1e-9);
  assert.equal(JSON.stringify(scene),before);
});
