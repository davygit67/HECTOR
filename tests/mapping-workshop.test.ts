import test from 'node:test';
import assert from 'node:assert/strict';
import { curvedFixture, curvedFrame } from './fixtures/curved-object.js';
import { ObjectTracker, matchMeasuredCandidate, scanMappingFrame, trackingRegion } from '../src/shared/objectTracking.js';
import { DEFAULT_MAPPING_SETTINGS as defaults, MappingLease, mappingSettings, softenMeasuredMask, validateMappingOperation } from '../src/shared/mappingWorkshop.js';
import { ObjectOutputGate } from '../src/shared/objectOutput.js';

test('camera candidates are measured components with actual bounds, contour and mask',()=>{
  const f=curvedFixture(),scan=scanMappingFrame(curvedFrame(),f.room,f.surface,f.fit,defaults);
  assert.equal(scan.candidates.length,1);const c=scan.candidates[0];assert.ok(c.selectable);assert.ok(c.points>50);assert.equal(c.cameraMask.bits.reduce((a,b)=>a+b,0),c.points);
  assert.ok(c.contour.length>10&&c.contour.length<=128);assert.ok(c.contour.every(p=>p.x>=c.bounds.x&&p.x<=c.bounds.x+c.bounds.w&&p.y>=c.bounds.y&&p.y<=c.bounds.y+c.bounds.h));
  assert.ok(c.bounds.w*c.bounds.h<.2);assert.equal(scan.projectorMask,null);
  const noFit=scanMappingFrame(curvedFrame(),f.room,f.surface,null,defaults);assert.equal(noFit.candidates[0].selectable,false);
  assert.equal(scanMappingFrame(curvedFrame(0,1,10000,{missing:true}),f.room,f.surface,f.fit,defaults).candidates.length,0);
});
test('selection revalidation refuses motion, shape changes and duplicate candidates',()=>{
  const f=curvedFixture(),scan=(offset=0)=>scanMappingFrame(curvedFrame(offset),f.room,f.surface,f.fit,defaults).candidates;
  const original=scan();assert.equal(matchMeasuredCandidate(original[0],scan()).points,original[0].points);
  assert.throws(()=>matchMeasuredCandidate(original[0],scan(.05)),/moved/);
  assert.throws(()=>matchMeasuredCandidate(original[0],[...original,...original]),/ambiguous/);
  assert.throws(()=>matchMeasuredCandidate(original[0],[{...original[0],points:original[0].points/2}]),/changed/);
});
test('trim, inset and inward feather never add unknown or occluded projector pixels',()=>{
  const f=curvedFixture(),frame=curvedFrame(),a=scanMappingFrame(frame,f.room,f.surface,f.fit,defaults),center=a.candidates[0].centerMeters;
  const baseline=scanMappingFrame(frame,f.room,f.surface,f.fit,defaults,center).projectorMask!;
  const refined=scanMappingFrame(frame,f.room,f.surface,f.fit,mappingSettings(defaults,{insetPx:2,featherPx:3,trim:{left:.15,top:0,right:0,bottom:0}}),center).projectorMask!;
  assert.ok(refined.bits.reduce((s,n)=>s+n,0)<baseline.bits.reduce((s,n)=>s+n,0));assert.ok(refined.alpha.some(n=>n>0&&n<255));
  for(let i=0;i<refined.bits.length;i++){assert.ok(!refined.bits[i]||baseline.bits[i]);assert.ok(!refined.alpha[i]||refined.bits[i]);}
  const mask={width:15,height:15,bits:new Uint8Array(225).fill(1)};mask.bits[7*15+7]=0;const soft=softenMeasuredMask(mask,mappingSettings(defaults,{featherPx:2}));
  assert.equal(soft.alpha[7*15+7],0);assert.equal(soft.alpha[7*15+6],0);assert.ok(soft.alpha[7*15+5]>0&&soft.alpha[7*15+5]<255);
});
test('refining a tracker preserves selected shape and rejects stale frames as before',()=>{
  const f=curvedFixture(),tracker=new ObjectTracker(f.room,f.fit,f.surface,trackingRegion(.5,.675),{x:.5,y:.675});
  const before=tracker.update(curvedFrame(),10000);tracker.configure(mappingSettings(defaults,{insetPx:3,featherPx:2}));
  const after=tracker.update(curvedFrame(0,1,10200),10200);assert.deepEqual(after.center,before.center);assert.equal(after.points,before.points);assert.ok(after.mask.bits.reduce((s,n)=>s+n,0)<before.mask.bits.reduce((s,n)=>s+n,0));
  assert.throws(()=>tracker.update(curvedFrame(0,2,10400),11000),/too old/);
});
test('settings and operation validation reject arbitrary offsets, expansion and partial trim',()=>{
  assert.throws(()=>mappingSettings(defaults,{insetPx:0}));assert.throws(()=>mappingSettings(defaults,{featherPx:9}));assert.throws(()=>mappingSettings(defaults,{trim:{left:.1} as any}));
  assert.throws(()=>mappingSettings(defaults,{offsetX:4} as any));assert.throws(()=>mappingSettings(defaults,{trim:{left:-.1,top:0,right:0,bottom:0}}));
  assert.throws(()=>validateMappingOperation({type:'mapping.select',observationId:'o',expectedRevision:2,candidateId:'c',x:.5} as any));
  validateMappingOperation({type:'mapping.refine',objectId:'x',observationId:'o',expectedRevision:2,settings:{featherPx:2}});
});
test('observation lease is single use and bound to revision, scene signature and time',()=>{
  const lease=new MappingLease();assert.equal(lease.issue('o',2,'room:sensor:fit',1000),16000);lease.check('o',2,'room:sensor:fit',15999);
  assert.throws(()=>lease.check('o',2,'room:sensor:fit',16000));assert.throws(()=>lease.check('old',2,'room:sensor:fit',1100));assert.throws(()=>lease.check('o',3,'room:sensor:fit',1100));assert.throws(()=>lease.check('o',2,'changed',1100));lease.consume();assert.throws(()=>lease.check('o',2,'room:sensor:fit',1100));
});
test('output validates feather alpha shape and still expires refined masks',()=>{
  const gate=new ObjectOutputGate(),m={type:'object-frame',ownerId:'owner',outputId:'output',sequence:1,expiresAt:Date.now()+300,viewport:{width:640,height:360,devicePixelRatio:1},rasterRect:{x:0,y:0,width:640,height:360},mask:{width:2,height:2,bits:new Uint8Array([0,1,1,0]),alpha:new Uint8Array([0,80,200,0])},color:'#ff0000'};
  assert.equal(gate.accept({...m,mask:{...m.mask,alpha:new Uint8Array(1)}},'output'),false);assert.equal(gate.accept(m,'output'),true);assert.ok(gate.image(Date.now(),m.viewport,true,true));assert.equal(gate.image(m.expiresAt,m.viewport,true,true),null);
});
