import test from 'node:test';
import assert from 'node:assert/strict';
import {createCanvasRpc,canvasRequestTimeout} from '../host/canvas-rpc.js';
import type {CanvasRpc} from '../src/shared/chat.js';
const calibration={operation:'studio.execute' as const,request:{type:'hardware.action' as const,command:{action:'calibrate-projector' as const}}};
test('only full 3D calibration receives a bounded longer Studio acknowledgement window',()=>{
 assert.equal(canvasRequestTimeout(calibration,10000),85000);
 assert.equal(canvasRequestTimeout({operation:'studio.inspect'},10000),10000);
 assert.equal(canvasRequestTimeout({operation:'studio.execute',request:{type:'hardware.action',command:{action:'fill-object',objectId:'a',color:'#ff0000'}}},10000),10000);
});
test('calibration RPC survives ordinary timeout, but expires without accepting a late receipt or replaying',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const sent:CanvasRpc[]=[];let faults=0;
 const rpc=createCanvasRpc(r=>sent.push(r),10000,()=>faults++),first=rpc.request(calibration);
 t.mock.timers.tick(11000);assert.equal(faults,0);rpc.receive({id:sent[0].id,value:'estimated fit'});assert.equal(await first,'estimated fit');
 const second=rpc.request(calibration),rejection=assert.rejects(second,/did not acknowledge/);
 t.mock.timers.tick(85001);await rejection;assert.equal(faults,1);rpc.receive({id:sent[1].id,value:'too late'});assert.equal(sent.length,2);rpc.close();
});
