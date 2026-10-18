import { configurePrograms, readProgram, programInput } from '../src/programRuntime';
import { paintProgramFrame } from '../src/programPainter';
let id = '';
window.addEventListener('message', event => {
  if (event.origin !== location.origin || event.source !== parent) return;
  if (event.data.kind === 'scene') { id = event.data.id; configurePrograms(event.data.scene, false); }
  if (event.data.kind === 'input') programInput(id, { type: 'pointerdown', x: .2, y: .5 });
});
parent.postMessage({kind:'observer-ready'},location.origin);
setInterval(()=>{
  const entry=readProgram(id);if(!entry?.frame)return;
  const ctx=document.querySelector('canvas')!.getContext('2d')!;ctx.clearRect(0,0,480,270);paintProgramFrame(ctx,entry.frame.commands,480,270);
  document.getElementById('status')!.textContent=entry.status.status+' · shared frame '+entry.status.revision;
  parent.postMessage({kind:'observer-frame',state:entry.frame.state,time:entry.frame.time},location.origin);
},100);
