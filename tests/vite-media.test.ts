import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { projectionMedia } from '../host/vite-media.ts';
import { initialScene, reduceScene } from '../src/shared/domain.ts';

function setup() {
  const handlers = new Map<string, Function>(), workers: { requests: any[]; running: boolean; closed: boolean; emit: Function }[] = [];
  const plugin = projectionMedia((_root, _room, emit) => {
    const worker = { requests: [] as any[], running: true, closed: false, emit,
      request: async (action: string, value?: unknown) => { worker.requests.push([action,value]); return action === 'snapshot' ? [] : undefined; },
      close: () => {worker.closed=true},
    }; workers.push(worker); return worker;
  });
  const http = new EventEmitter();
  (plugin.configureServer as Function)({ config:{root:'/unused',server:{port:5173}}, ws:{on:(name:string,fn:Function)=>handlers.set(name,fn)}, httpServer:http });
  const client = (origin: string, role = 'studio') => {
    const socket = Object.assign(new EventEmitter(), {bufferedAmount:0}), messages: any[] = [];
    const peer = {socket,send:(name:string,data:any)=>messages.push([name,data])};
    handlers.get('connection')!(socket,{headers:{origin},socket:{remoteAddress:'127.0.0.1'}});
    handlers.get('pm:media-ready')!({role},peer); return {...peer,messages};
  };
  const request = (peer:any,action:string,value?:unknown,scene?:unknown)=>handlers.get('pm:media-request')!({id:'request',action,value,scene},peer);
  return {workers,client,request,http};
}
test('live media rejects foreign origins and output mutations; shares only the same local room', async()=>{
  const t=setup(); const foreign=t.client('https://example.com'); await t.request(foreign,'snapshot'); assert.equal(t.workers.length,0); assert.match(foreign.messages[0][1].error,/Reconnect/);
  const studio=t.client('http://127.0.0.1:5173'), output=t.client('http://127.0.0.1:5173','output'); assert.equal(t.workers.length,1);
  await t.request(output,'command',{contentId:'v',action:'play'}); assert.match(output.messages.at(-1)[1].error,/studio/); assert.equal(t.workers[0].requests.length,0);
  await t.request(studio,'sync',initialScene()); assert.equal(t.workers[0].requests[0][0],'sync');
  const other=t.client('http://localhost:5173'); assert.equal(t.workers.length,2);
  t.workers[0].emit({type:'state',state:{contentId:'v'}}); assert.ok(studio.messages.some(m=>m[0]==='pm:media-event')); assert.ok(output.messages.some(m=>m[0]==='pm:media-event')); assert.equal(other.messages.length,0);
  t.http.emit('close'); assert.ok(t.workers.every(w=>w.closed));
});

test('studio can restart a stuck renderer, retaining sources and ignoring events from the old process', async()=>{
  const t=setup(), studio=t.client('http://127.0.0.1:5173'), output=t.client('http://127.0.0.1:5173','output');
  const scene=reduceScene(initialScene(),{type:'content.create',id:'v',title:'Video',surfaceId:'wall',spec:{kind:'youtube',config:{videoId:'M7lc1UVf-VE',startSeconds:0,backlight:true}}});
  await t.request(studio,'sync',scene);
  await t.request(output,'command',{contentId:'v',action:'restart-renderer'});
  assert.equal(t.workers.length,1); assert.match(output.messages.at(-1)[1].error,/studio/);
  await t.request(studio,'command',{contentId:'v',action:'restart-renderer'});
  assert.equal(t.workers.length,2); assert.equal(t.workers[0].closed,true);
  assert.deepEqual(t.workers[1].requests,[['sync',scene]]);
  const count=studio.messages.length; t.workers[0].emit({type:'state',state:{contentId:'v',status:'stale'}});
  assert.equal(studio.messages.length,count);
  t.workers[1].emit({type:'state',state:{contentId:'v',status:'new'}});
  assert.equal(studio.messages.at(-1)[1].state.status,'new');
  // A fresh page may never have completed its first sync. Restart does not depend on it.
  const fresh=t.client('http://localhost:5173');
  await t.request(fresh,'command',{contentId:'v',action:'restart-renderer'},scene);
  assert.deepEqual(t.workers.at(-1)!.requests,[['sync',scene]]);
  t.http.emit('close');
});
test('live media validates commands, drops backed-up frames and restarts a failed worker with retained source state',async()=>{
  const t=setup(), studio=t.client('http://127.0.0.1:5173');
  await t.request(studio,'command',{contentId:'v',action:'navigate',url:'file:///private'}); assert.equal(t.workers[0].requests.length,0);
  await t.request(studio,'input',{contentId:'v',type:'mouseDown',x:-1,y:0}); assert.equal(t.workers[0].requests.length,0);
  await t.request(studio,'sync',initialScene());
  studio.socket.bufferedAmount=3_000_000; const count=studio.messages.length;
  t.workers[0].emit({type:'frame',frame:{}}); assert.equal(studio.messages.length,count);
  t.workers[0].running=false; await t.request(studio,'snapshot'); assert.equal(t.workers.length,2); assert.deepEqual(t.workers[1].requests.map(r=>r[0]),['sync','snapshot']);
  t.http.emit('close');
});
