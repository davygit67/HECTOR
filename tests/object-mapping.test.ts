import test from 'node:test';
import assert from 'node:assert/strict';
import {fitProjectorPairs,solveProjector} from '../src/shared/projectorFit.js';
import {ObjectTracker,trackingRegion} from '../src/shared/objectTracking.js';
import {ObjectOutputGate} from '../src/shared/objectOutput.js';
import {projectCamera} from '../src/shared/objectMapping.js';
import {roomMatchesFrame} from '../src/shared/roomModel.js';
import {curvedFixture,curvedFrame,curvedSession,matrix} from './fixtures/curved-object.js';
const tracker=()=>{const f=curvedFixture();return new ObjectTracker(f.room,f.fit,f.surface,trackingRegion(f.seed.x,f.seed.y),f.seed);};
test('nonplanar Gray code solves independent 3D projection, including a curved surface',()=>{
 const session=curvedSession(),{room}=curvedFixture(),fit=solveProjector(session,room);assert.ok(fit.rmsPx<1);assert.ok(fit.heldOut>100);
 for(const p of [[.1,-.3,1.65],[-.3,.2,2.4]] as [number,number,number][]){const a=projectCamera(matrix,p),b=projectCamera(fit.matrix,p);assert.ok(Math.hypot(a.x-b.x,a.y-b.y)<.003);}
});
test('flat and inconsistent correspondences cannot masquerade as a full 3D calibration',()=>{
 const pairs=Array.from({length:900},(_,i)=>{const p:[number,number,number]=[(i%30-15)/20,(Math.floor(i/30)-15)/30,2];return{p,...projectCamera(matrix,p)};});
 assert.throws(()=>fitProjectorPairs(pairs,640,360));
 pairs.forEach((p,i)=>{p.p[2]=1.5+(i%7)/5;p.x=(i*137%900)/900;p.y=(i*39%900)/900;});assert.throws(()=>fitProjectorPairs(pairs,640,360));
});
test('selected curved shape follows slow translation in one metric room and makes an inset mask',()=>{
 const t=tracker(),a=t.update(curvedFrame(0,1,10000),10000),b=t.update(curvedFrame(.015,2,10200),10200);
 assert.ok(a.points>50);assert.ok(a.mask.bits.some(Boolean));assert.ok(b.center[0]<a.center[0]);assert.ok(b.speedMps<.15);assert.ok(b.mask.bits.reduce((s,n)=>s+n,0)<a.points*20);
});
test('lost, occluded, stale and rapid objects blank and cannot silently reacquire',()=>{
 for(const f of [curvedFrame(0,2,10200,{missing:true}),curvedFrame(0,2,10200,{occlusion:true}),curvedFrame(.07,2,10200),curvedFrame(0,2,11000)]){
  const t=tracker();t.update(curvedFrame(0,1,10000),10000);assert.throws(()=>t.update(f,f.capturedAtMs));assert.throws(()=>t.update(curvedFrame(0,3,11200),11200),/stopped/);
 }
 const t=tracker();assert.throws(()=>t.update(curvedFrame(),11000),/old/);
});
test('only a bounded fixed tracking area can change; background movement still invalidates the rig',()=>{
 const {room,seed}=curvedFixture(),r=trackingRegion(seed.x,seed.y);assert.ok(roomMatchesFrame(room,curvedFrame(.015),r));assert.equal(roomMatchesFrame(room,curvedFrame(0,0,10000,{shift:.08}),r),false);assert.equal(roomMatchesFrame(room,curvedFrame(),{x:0,y:0,w:1,h:1}),false);
});
test('projection watchdog expires independently and stays black until explicit clear',()=>{
 const gate=new ObjectOutputGate(),now=Date.now(),viewport={width:640,height:360,devicePixelRatio:1};
 const msg={type:'object-frame',ownerId:'owner',outputId:'output',sequence:1,expiresAt:now+300,viewport,rasterRect:{x:0,y:0,width:640,height:360},mask:{width:4,height:4,bits:new Uint8Array(16).fill(1)},color:'#ff0000'};
 assert.ok(gate.accept(msg,'output'));assert.ok(gate.image(now,viewport,true,true));assert.equal(gate.image(now+301,viewport,true,true),null);assert.equal(gate.active,true);
 assert.equal(gate.image(now,{...viewport,width:800},true,true),null);assert.equal(gate.image(now,viewport,true,false),null);
 assert.equal(gate.accept({...msg,ownerId:'other',sequence:4},'output'),false);assert.ok(gate.accept({type:'object-clear',ownerId:'owner',outputId:'output',sequence:2},'output'));assert.equal(gate.active,false);assert.equal(gate.accept(msg,'output'),false);
});
test('native helper timing is accounted for without pretending its conservative uncertainty is zero',()=>{
 for(const uncertainty of [250,260]){const t=tracker(),f=curvedFrame(0,1,10000);f.clockUncertaintyMs=uncertainty;const result=t.update(f,10060);assert.equal(result.clockUncertaintyMs,uncertainty);assert.ok(result.points>50);}
 const old=curvedFrame(0,1,10000);old.clockUncertaintyMs=260;assert.throws(()=>tracker().update(old,10250),/old/);
 const uncertain=curvedFrame(0,1,10000);uncertain.clockUncertaintyMs=301;assert.throws(()=>tracker().update(uncertain,10000),/uncertain/);
});
