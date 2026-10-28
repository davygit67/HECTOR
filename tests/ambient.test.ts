// Tests for the ambient backlight core, ported from adknate05's Projection Mapper (HECTOR branch
// `codex/nate-projection-mapper`, commit 912f609: tests/backlight.test.ts and tests/active-picture.test.ts).
// Assertions are unchanged; only the runner (node:test → Vitest) and module paths differ.
import assert from 'node:assert/strict';
import { describe, expect, it } from 'vitest';
import { analyzeColors, BACKLIGHT_DEFAULTS, createBacklightAnalyzer, darkColors, detectActivePicture, smoothColors, type PixelFrame } from '../src/ambient/backlight';
import { createPictureTracker, FULL_PICTURE } from '../src/ambient/activePicture';
import { toLinear, linearToLab, gamutMap } from '../src/ambient/lightColor';
import { renderLightField, addLight, toneColor } from '../src/ambient/lightField';
import { BacklightFields } from '../src/ambient/field';
import { AmbientProcessor } from '../src/ambient/processor';

function pixels(width: number, height: number, color: (x: number, y: number) => number[]): PixelFrame {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set([...color(x, y), 255], (y * width + x) * 4);
  return { width, height, data };
}
const bars = pixels(192,108,(x,y)=>y<12||y>=96?[8+x%3,8+x%3,8+x%3]:[30,100,180]);
const crop = {left:0,top:12/108,right:1,bottom:96/108};
const lit = pixels(192,108,()=>[30,100,180]);
const black = pixels(192,108,()=>[0,0,0]);

describe('backlight colour analysis (adknate05)', () => {
  it('edge sampler preserves spatial sides and integrates proportional energy without bucket swaps', () => {
    const field=analyzeColors(pixels(192,108,x=>x<96?[0,64,255]:[255,80,0]));
    assert.equal(field.length,100);
    assert.ok(field.filter(c=>c.x<.2).every(c=>c.color[2]>240&&c.color[0]<2));
    assert.ok(field.filter(c=>c.x>.8).every(c=>c.color[0]>240&&c.color[2]<2));
    const mixed=analyzeColors(pixels(192,108,x=>x%3<2?[255,0,0]:[0,0,255]));
    const rgb=toLinear(mixed[5].color);
    assert.ok(Math.abs(rgb[0]-2/3)<.04);assert.ok(Math.abs(rgb[2]-1/3)<.04);
  });
  it('smoothing is elapsed-time based, spatially bounded, and dark frames dim rather than invent colors', () => {
    const bright = analyzeColors(pixels(96, 54, () => [220, 80, 0])), dark = analyzeColors(pixels(96, 54, () => [0, 0, 0]));
    assert.equal(darkColors(dark), true); assert.equal(darkColors(bright), false);
    const one = smoothColors(bright, dark, 200, 180), two = smoothColors(smoothColors(bright, dark, 100, 180), dark, 100, 180);
    // Blank zero-weight slots may match differently; aggregate luminance follows the same decay.
    const energy = (v: typeof bright) => v.reduce((sum, c) => sum + c.color[0] * c.weight, 0);
    assert.ok(energy(one) < energy(bright)); assert.ok(energy(two) < energy(bright));
    assert.deepEqual(smoothColors(bright, dark, 100, 0), dark);
    assert.ok(one.every(c => c.x >= 0 && c.x <= 1 && c.y >= 0 && c.y <= 1));
  });
  it('true dark-blue edge remains blue next to red interior; only far light admits interior color',()=>{
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
  it('letterboxing is paired, conservative and stable across brief dark transitions',()=>{
    const bar=pixels(192,108,(_x,y)=>y<12||y>=96?[0,0,0]:[30,100,180]);
    const rect=detectActivePicture(bar);assert.equal(rect.top,12/108);assert.equal(rect.bottom,96/108);
    assert.equal(detectActivePicture(pixels(192,108,x=>x<20?[0,0,0]:[30,100,180])).left,0);
    assert.deepEqual(detectActivePicture(pixels(192,108,()=>[0,0,0])),{left:0,top:0,right:1,bottom:1});
    const analyze=createBacklightAnalyzer();const first=analyze(bar,1000),settled=analyze(bar,1700);
    assert.ok(first[0].color[2]<10);assert.ok(settled[0].color[2]>170);
    analyze(pixels(192,108,()=>[0,0,0]),1800);
    assert.ok(analyze(bar,1900)[0].color[2]>170);
  });
  it('tone mapping keeps blacks black, neutrals neutral, bounded colors and explicit styles',()=>{
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
  it('continuous uniform field has no periodic hotspots or doubled corners and fades to zero',()=>{
    const colors=analyzeColors(pixels(192,108,()=>[80,140,220]));
    const f=renderLightField(colors,320,180,100,BACKLIGHT_DEFAULTS,520);
    const pixel=(x:number,y:number)=>Array.from(f.data.slice((y*f.width+x)*4,(y*f.width+x)*4+3));
    const row=Array.from({length:300},(_,i)=>pixel(110+i,80)[2]);assert.ok(Math.max(...row)-Math.min(...row)<=1);
    const seam=pixel(260,96)[2],middle=pixel(260,60)[2],end=pixel(260,1)[2];assert.ok(seam>middle&&middle>end);assert.ok(end<=1);
    assert.ok(pixel(260,150).every(v=>v===0),'video pixels excluded');
  });
  it('temporal filter damps tiny noise but follows broad cuts without long color trails',()=>{
    const old=analyzeColors(pixels(96,54,()=>[10,40,160])),next=analyzeColors(pixels(96,54,()=>[220,45,10]));
    let current=old;for(let i=0;i<8;i++)current=smoothColors(current,next,33,180);
    assert.ok(current[0].color[0]>180&&current[0].color[2]<80);
    const jitter=analyzeColors(pixels(96,54,()=>[11,41,161])),smoothed=smoothColors(old,jitter,33,180);
    assert.ok(smoothed[0].color[0]-old[0].color[0]<.3);
  });
  it('small bright captions do not bleach a predominantly dark blue seam',()=>{
    const base=analyzeColors(pixels(192,108,()=>[3,10,45]));
    const caption=analyzeColors(pixels(192,108,(x,y)=>y===105&&x%4===0?[255,255,255]:[3,10,45]));
    const bottom=caption.slice(16,32);assert.ok(bottom.every(c=>c.color[2]>c.color[0]*1.8));
    assert.ok(bottom.every((c,i)=>c.color[0]-base[16+i].color[0]<22));
  });
  it('contour extension follows diagonal direction and curvature, preserving the seam and flat fallback',()=>{
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
});
describe('active picture detection (adknate05)', () => {
  it('detects compressed letterbox, pillarbox, portrait and windowbox at source pixel precision',()=>{
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
  it('does not crop single-sided shadows, blue edges, black frames or a tiny light in a dark room',()=>{
    const fixtures=[black,pixels(192,108,x=>x<20?[0,0,0]:[30,100,180]),pixels(192,108,(_x,y)=>y<12||y>=96?[3,10,45]:[30,100,180]),pixels(192,108,(x,y)=>x===96&&y===54?[255,255,255]:[0,0,0])];
    for(const frame of fixtures) assert.deepEqual(detectActivePicture(frame),FULL_PICTURE);
  });
  it('stable matte survives long fades and captions; aspect expansion does not wait for inward hysteresis',()=>{
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
  it('boundary metadata and colors share one stable full-resolution observation',()=>{
    const analyze=createBacklightAnalyzer();
    const full=pixels(1920,1080,(_x,y)=>y<125||y>=955?[0,0,0]:[30,100,180]);
    analyze(bars,100,full);const colors=analyze(bars,800,full);
    assert.deepEqual(analyze.picture(),{left:0,right:1,top:125/1080,bottom:955/1080});
    assert.ok(colors[0].color[2]>170);
    assert.equal(analyze.settling(),false);
  });
});
describe('per-renderer backlight fields', () => {
  it('holds briefly after the last sample, then fades to nothing instead of keeping stale light', () => {
    const fields = new BacklightFields(), colors = analyzeColors(pixels(96, 54, () => [220, 80, 0]));
    expect(fields.read('a', 0)).toBeNull();
    fields.update('a', { colors, sampledAt: 1000, costMs: 1, dark: false });
    expect(fields.read('a', 1200)?.alpha).toBe(1);
    expect(fields.read('a', 1675)!.alpha).toBeCloseTo(.5, 5);
    expect(fields.read('a', 2001)).toBeNull();
    expect(fields.read('b', 1200)).toBeNull();
    fields.clear('a'); expect(fields.read('a', 1200)).toBeNull();
  });
  it('smooths successive samples by elapsed time and resets on a new picture boundary', () => {
    const fields = new BacklightFields(), blue = analyzeColors(pixels(96, 54, () => [10, 40, 160])), red = analyzeColors(pixels(96, 54, () => [220, 45, 10]));
    fields.update('a', { colors: blue, sampledAt: 0, costMs: 0, dark: false });
    fields.update('a', { colors: red, sampledAt: 33, costMs: 0, dark: false }, 180);
    const partway = fields.read('a', 33)!.colors[0].color;
    expect(partway[0]).toBeGreaterThan(blue[0].color[0]); expect(partway[0]).toBeLessThan(red[0].color[0]);
    fields.update('a', { colors: red, sampledAt: 66, costMs: 0, dark: false, picture: { left: 0, top: .1, right: 1, bottom: .9 } }, 180);
    expect(fields.read('a', 66)!.colors).toBe(fields.read('a', 66)!.colors);
    expect(fields.read('a', 66)!.picture).toEqual({ left: 0, top: .1, right: 1, bottom: .9 });
  });
});
describe('ambient processor (worker side)', () => {
  const frame = (rgb: number[]) => { const f = pixels(96, 54, () => rgb); return { width: 96, height: 54, data: f.data as Uint8ClampedArray }; };
  const request = (rgb: number[], now: number, extra: object = {}) => ({ type: 'sample' as const, id: 's', key: 'src', ...frame(rgb), now, smoothingMs: 180, geometry: [400, 225, 60] as [number, number, number], settings: BACKLIGHT_DEFAULTS, fieldKey: 'g1', ...extra });
  it('renders light only from real frames, and only when it changes', () => {
    const processor = new AmbientProcessor();
    expect(processor.handle({ type: 'field', id: 's', key: 'src', geometry: [400, 225, 60], settings: BACKLIGHT_DEFAULTS, fieldKey: 'g1' })?.field).toBeUndefined();
    const first = processor.handle(request([200, 40, 10], 0))!;
    expect(first.sampledAt).toBe(0); expect(first.dark).toBe(false);
    expect(first.field!.data.some(v => v > 0)).toBe(true);
    expect(first.field!.size).toEqual([400, 225, 60]);
    // Identical frames converge: nothing new to upload.
    processor.handle(request([200, 40, 10], 66));
    expect(processor.handle(request([200, 40, 10], 132))!.field).toBeUndefined();
    // A new geometry re-renders the field from the last colours without a new sample.
    expect(processor.handle({ type: 'field', id: 's', key: 'src', geometry: [500, 225, 60], settings: BACKLIGHT_DEFAULTS, fieldKey: 'g2' })!.field!.size).toEqual([500, 225, 60]);
  });
  it('resets on a new source and forgets removed surfaces', () => {
    const processor = new AmbientProcessor();
    processor.handle(request([200, 40, 10], 0));
    expect(processor.handle(request([0, 0, 0], 66, { key: 'other' }))!.dark).toBe(true);
    processor.handle({ type: 'forget', id: 's' });
    expect(processor.handle({ type: 'field', id: 's', key: 'other', geometry: [400, 225, 60], settings: BACKLIGHT_DEFAULTS, fieldKey: 'g1' })?.field).toBeUndefined();
  });
});
