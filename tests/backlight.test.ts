import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeColors, BACKLIGHT_DEFAULTS, backlightEdge, darkColors, detectActivePicture, createBacklightAnalyzer, rectifyVideo, smoothColors, type PixelFrame } from '../src/shared/backlight.ts';
import { initialScene, reduceScene, readScene, type Command } from '../src/shared/domain.ts';
import { homography, project, type Quad } from '../src/shared/geometry.ts';
import type { YouTubeContent } from '../src/shared/content.ts';
import { toLinear, toSRGB, linearToLab, gamutMap } from '../src/shared/lightColor.ts';
import { renderLightField, addLight, toneColor } from '../src/shared/lightField.ts';
import { captureBacklight } from '../host/backlight-capture.ts';
function pixels(width: number, height: number, color: (x: number, y: number) => number[]): PixelFrame {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set([...color(x, y), 255], (y * width + x) * 4);
  return { width, height, data };
}
test('desktop backlight samples a small visible player without imposing a 100-pixel playback limit', async () => {
  let crop: unknown;
  const bitmap = pixels(80, 45, () => [255, 64, 0]).data; // BGRA: blue source.
  const sender = { capturePage: async (rect: unknown) => {
    crop = rect;
    return { isEmpty: () => false, resize: () => ({ getSize: () => ({ width: 80, height: 45 }), toBitmap: () => bitmap }) };
  } } as unknown as Parameters<typeof captureBacklight>[0];
  const sample = await captureBacklight(sender, { contentId: 'small', viewport: { width: 800, height: 600 }, quad: [{ x: 100, y: 120 }, { x: 180, y: 120 }, { x: 180, y: 165 }, { x: 100, y: 165 }] });
  assert.deepEqual(crop, { x: 100, y: 120, width: 80, height: 45 });
  assert.equal(sample.dark, false);
  assert.ok(sample.colors.filter(c => c.weight).every(c => c.color[0] < .001 && c.color[2] > 254.999));
});
test('edge sampler preserves spatial sides and integrates proportional energy without bucket swaps', () => {
  const field=analyzeColors(pixels(192,108,x=>x<96?[0,64,255]:[255,80,0]));
  assert.equal(field.length,100);
  assert.ok(field.filter(c=>c.x<.2).every(c=>c.color[2]>240&&c.color[0]<2));
  assert.ok(field.filter(c=>c.x>.8).every(c=>c.color[0]>240&&c.color[2]<2));
  const mixed=analyzeColors(pixels(192,108,x=>x%3<2?[255,0,0]:[0,0,255]));
  const rgb=toLinear(mixed[5].color);
  assert.ok(Math.abs(rgb[0]-2/3)<.04);assert.ok(Math.abs(rgb[2]-1/3)<.04);
});
test('all spatial color lobes reach the player perimeter instead of hiding behind its opaque image', () => {
  const colors = analyzeColors(pixels(96, 54, x => x < 48 ? [0, 64, 255] : [255, 80, 0]));
  for (const region of colors.filter(c => c.weight)) {
    const edge = backlightEdge(region);
    assert.ok(edge.x >= 0 && edge.x <= 1 && edge.y >= 0 && edge.y <= 1);
    assert.ok(Math.min(edge.x, 1 - edge.x, edge.y, 1 - edge.y) < 1e-9);
    assert.equal(edge.x < .5, region.x < .5); assert.equal(edge.y < .5, region.y < .5);
  }
  assert.deepEqual(backlightEdge({ x: .5, y: .5 }), { x: .5, y: 0 });
});
test('perspective rectification excludes surrounding glow/UI and handles BGRA capture pixels', () => {
  const q: Quad = [{ x: .1, y: .1 }, { x: .9, y: .2 }, { x: .8, y: .9 }, { x: .2, y: .8 }], h = homography(q);
  const frame = pixels(160, 100, () => [0, 255, 0]);
  // Rasterize a blue/red source into the skewed video, surrounded by green contamination.
  const data = frame.data as Uint8ClampedArray;
  for (let y = 0; y < 300; y++) for (let x = 0; x < 500; x++) {
    const p = project(h, { x: x / 500, y: y / 300 }); const sx = Math.floor(p.x * 160), sy = Math.floor(p.y * 100);
    data.set(x < 250 ? [0, 0, 255, 255] : [255, 0, 0, 255], (sy * 160 + sx) * 4);
  }
  const result = analyzeColors(rectifyVideo(frame, q.map(p => ({ x: p.x * 160, y: p.y * 100 })) as Quad));
  assert.ok(result.filter(c => c.weight).every(c => c.color[1] === 0)); assert.ok(result.filter(c => c.weight && c.x < .4).every(c => c.color[2] > 200));
  const blueBGRA = { ...pixels(96, 54, () => [255, 0, 0]), order: 'bgra' as const };
  assert.ok(analyzeColors(rectifyVideo(blueBGRA, [{ x: 0, y: 0 }, { x: 96, y: 0 }, { x: 96, y: 54 }, { x: 0, y: 54 }]))[0].color[2] > 254.999);
});
test('smoothing is elapsed-time based, spatially bounded, and dark frames dim rather than invent colors', () => {
  const bright = analyzeColors(pixels(96, 54, () => [220, 80, 0])), dark = analyzeColors(pixels(96, 54, () => [0, 0, 0]));
  assert.equal(darkColors(dark), true); assert.equal(darkColors(bright), false);
  const one = smoothColors(bright, dark, 200, 180), two = smoothColors(smoothColors(bright, dark, 100, 180), dark, 100, 180);
  // Blank zero-weight slots may match differently; aggregate luminance follows the same decay.
  const energy = (v: typeof bright) => v.reduce((sum, c) => sum + c.color[0] * c.weight, 0);
  assert.ok(energy(one) < energy(bright)); assert.ok(energy(two) < energy(bright));
  assert.deepEqual(smoothColors(bright, dark, 100, 0), dark);
  assert.ok(one.every(c => c.x >= 0 && c.x <= 1 && c.y >= 0 && c.y <= 1));
});
test('atomic backlight settings merge preserves video, source start, placement and geometry; legacy saves use defaults', () => {
  let s = reduceScene(initialScene(), { type: 'content.create', id: 'video', surfaceId: 'tabletop', title: 'Test', spec: { kind: 'youtube', config: { videoId: 'M7lc1UVf-VE', startSeconds: 40, backlight: true } } });
  const before = structuredClone(s);
  assert.equal((readScene(s).contents[0] as YouTubeContent).config.backlightSettings, undefined);
  s = reduceScene(s, { type: 'youtube.backlight.configure', id: 'video', enabled: false, settings: { spread: .3 } });
  const v = s.contents[0] as YouTubeContent;
  assert.deepEqual(v.config.backlightSettings, { ...BACKLIGHT_DEFAULTS, spread: .3 }); assert.equal(v.config.backlight, false); assert.equal(v.config.videoId, 'M7lc1UVf-VE'); assert.equal(v.config.startSeconds, 40); assert.deepEqual(v.bounds, before.contents[0].bounds); assert.deepEqual(s.surfaces, before.surfaces);
  const saved = JSON.stringify(s);
  for (const settings of [{ intensity: 3 }, { spread: 4 }, { smoothingMs: 4.5 }, { secret: 1 }, {}]) assert.throws(() => reduceScene(s, { type: 'youtube.backlight.configure', id: 'video', settings } as Command));
  assert.equal(JSON.stringify(s), saved); assert.deepEqual(readScene(s), s);
});

test('true dark-blue edge remains blue next to red interior; only far light admits interior color',()=>{
  const frame=pixels(192,108,(x,y)=>x<16||x>175||y<9||y>98?[3,10,45]:[255,0,0]);
  const colors=analyzeColors(frame);
  assert.deepEqual(detectActivePicture(frame),{left:0,top:0,right:1,bottom:1});
  assert.ok(colors.slice(0,50).every(c=>c.color[2]>c.color[0]*4));
  const f=renderLightField(colors,320,180,90,{...BACKLIGHT_DEFAULTS,intensity:1.6},500);
  const sample=(x:number,y:number)=>{const i=(Math.floor(y/f.height*f.height)*f.width+Math.floor(x))*4;return [...f.data.slice(i,i+3)]};
  const near=sample(88,180),far=sample(40,180);
  assert.ok(near[2]>near[0]*3,'red interior must not become a red edge');
  assert.ok(far[0]>near[0],'broad interior is allowed only in diffused outer light');
});
test('letterboxing is paired, conservative and stable across brief dark transitions',()=>{
  const bar=pixels(192,108,(_x,y)=>y<12||y>=96?[0,0,0]:[30,100,180]);
  const rect=detectActivePicture(bar);assert.equal(rect.top,12/108);assert.equal(rect.bottom,96/108);
  assert.equal(detectActivePicture(pixels(192,108,x=>x<20?[0,0,0]:[30,100,180])).left,0);
  assert.deepEqual(detectActivePicture(pixels(192,108,()=>[0,0,0])),{left:0,top:0,right:1,bottom:1});
  const analyze=createBacklightAnalyzer();const first=analyze(bar,1000),settled=analyze(bar,1700);
  assert.ok(first[0].color[2]<10);assert.ok(settled[0].color[2]>170);
  analyze(pixels(192,108,()=>[0,0,0]),1800);
  assert.ok(analyze(bar,1900)[0].color[2]>170);
});
test('tone mapping keeps blacks black, neutrals neutral, bounded colors and explicit styles',()=>{
  for(const toneProfile of ['cinema','vivid','soft','neutral'] as const){
    const settings={...BACKLIGHT_DEFAULTS,toneProfile,intensity:2};
    assert.deepEqual(toneColor([0,0,0],settings),[0,0,0]);
    const neutral=toneColor([.5,.5,.5],settings);assert.ok(Math.max(...neutral)-Math.min(...neutral)<1e-6);
    for(const rgb of [[1,0,0],[0,1,0],[0,0,1]] as [number,number,number][]){const mapped=toneColor(rgb,settings);assert.ok(mapped.every(c=>Number.isFinite(c)&&c>=0&&c<=1));}
  }
  const vivid=toneColor([.4,.1,.03],{...BACKLIGHT_DEFAULTS,toneProfile:'vivid'}),soft=toneColor([.4,.1,.03],{...BACKLIGHT_DEFAULTS,toneProfile:'soft'});
  assert.ok(vivid[0]>soft[0]);
  assert.deepEqual(addLight([1,1,1],[.5,0,0]),[1,1,1]);
  assert.ok(addLight([.1,.2,.3],[.2,.1,0]).every((v,i)=>v>=[.1,.2,.3][i]));
  const blue=[.01,.1,.7] as [number,number,number];const roundtrip=gamutMap(linearToLab(blue));assert.ok(roundtrip.every((v,i)=>Math.abs(v-blue[i])<1e-6));
});
test('continuous uniform field has no periodic hotspots or doubled corners and fades to zero',()=>{
  const colors=analyzeColors(pixels(192,108,()=>[80,140,220]));
  const f=renderLightField(colors,320,180,100,BACKLIGHT_DEFAULTS,520);
  const pixel=(x:number,y:number)=>Array.from(f.data.slice((y*f.width+x)*4,(y*f.width+x)*4+3));
  const row=Array.from({length:300},(_,i)=>pixel(110+i,80)[2]);assert.ok(Math.max(...row)-Math.min(...row)<=1);
  const seam=pixel(260,96)[2],middle=pixel(260,60)[2],end=pixel(260,1)[2];assert.ok(seam>middle&&middle>end);assert.ok(end<=1);
  assert.ok(pixel(260,150).every(v=>v===0),'video pixels excluded');
});
test('temporal filter damps tiny noise but follows broad cuts without long color trails',()=>{
  const old=analyzeColors(pixels(96,54,()=>[10,40,160])),next=analyzeColors(pixels(96,54,()=>[220,45,10]));
  let current=old;for(let i=0;i<8;i++)current=smoothColors(current,next,33,180);
  assert.ok(current[0].color[0]>180&&current[0].color[2]<80);
  const jitter=analyzeColors(pixels(96,54,()=>[11,41,161])),smoothed=smoothColors(old,jitter,33,180);
  assert.ok(smoothed[0].color[0]-old[0].color[0]<.3);
});
test('profile-only atomic change roundtrips and legacy numeric settings remain accepted',()=>{
  let scene=reduceScene(initialScene(),{type:'content.create',id:'tone',surfaceId:'wall',title:'tone',spec:{kind:'youtube',config:{videoId:'M7lc1UVf-VE',startSeconds:12,backlight:true,backlightSettings:{intensity:1.4,spread:.3,smoothingMs:250}}}});
  const before=structuredClone(scene);
  scene=reduceScene(scene,{type:'youtube.backlight.configure',id:'tone',settings:{toneProfile:'soft'}});
  const config=(scene.contents[0] as YouTubeContent).config;
  assert.deepEqual(config.backlightSettings,{...BACKLIGHT_DEFAULTS,intensity:1.4,spread:.3,smoothingMs:250,toneProfile:'soft'});
  assert.deepEqual(scene.contents[0].bounds,before.contents[0].bounds);assert.deepEqual(readScene(scene),scene);
  assert.throws(()=>reduceScene(scene,{type:'youtube.backlight.configure',id:'tone',settings:{toneProfile:'pretend'}} as unknown as Command));
});

test('small bright captions do not bleach a predominantly dark blue seam',()=>{
  const base=analyzeColors(pixels(192,108,()=>[3,10,45]));
  const caption=analyzeColors(pixels(192,108,(x,y)=>y===105&&x%4===0?[255,255,255]:[3,10,45]));
  const bottom=caption.slice(16,32);assert.ok(bottom.every(c=>c.color[2]>c.color[0]*1.8));
  assert.ok(bottom.every((c,i)=>c.color[0]-base[16+i].color[0]<22));
});

test('contour extension follows diagonal direction and curvature, preserving the seam and flat fallback',()=>{
  const shape=(curve:boolean)=>analyzeColors(pixels(192,108,(x,y)=>x/192<.5+.5*y/108-(curve?.8*(y/108)**2:0)?[20,50,200]:[220,40,60]));
  const diagonal=shape(false),curve=shape(true),direction=diagonal[8].continuation!,bending=curve[8].continuation!;
  assert.ok(direction.confidence>.8&&direction.slope>.35&&direction.slope<.65);
  assert.ok(bending.curvature<-.7,'changing contour direction is retained instead of a straight radial glow');
  const flat=analyzeColors(pixels(192,108,()=>[20,50,200]));assert.ok(flat.every(c=>c.continuation!.confidence===0));
  const plain=curve.map(({continuation,...c})=>c),settings={...BACKLIGHT_DEFAULTS,intensity:1.5};
  const a=renderLightField(curve,320,180,120,settings,560),b=renderLightField(plain,320,180,120,settings,560);
  const sample=(f:typeof a,x:number,y:number)=>Array.from(f.data.slice((y*f.width+x)*4,(y*f.width+x)*4+3));
  assert.deepEqual(sample(a,280,117),sample(b,280,117),'same immediate edge');
  assert.ok(sample(a,275,65)[0]>sample(b,275,65)[0]+8,'curving boundary moves outward in predicted direction');
  assert.ok(a.data.every(Number.isFinite));
});
