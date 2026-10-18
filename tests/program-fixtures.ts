import type { ProgramDefinition } from '../src/shared/program.js';
export const orbit: ProgramDefinition = {
  sdkVersion: 1, title: 'Orbital garden', description: 'Layered orbiting petals with editable speed and density.',
  parameters: [{ key: 'speed', label: 'Orbit speed', min: .1, max: 3, step: .1, default: 1 }, { key: 'petals', label: 'Petals', min: 8, max: 60, step: 1, default: 32 }],
  source: `({init:()=>({phase:0}),update:(s,c)=>({phase:s.phase+c.dt*c.params.speed}),draw:(s,c)=>{const a=[{op:'rect',x:0,y:0,w:1,h:1,fill:'#080e24'}];for(let i=0;i<c.params.petals;i++){const t=i/c.params.petals*Math.PI*2+s.phase,r=.22+.08*Math.sin(s.phase+i*.5);a.push({op:'ellipse',x:.5+Math.cos(t)*r,y:.5+Math.sin(t)*r,rx:.035,ry:.06,fill:i%2?'#fb72b0':'#72cafa',alpha:.75});}return a;}})`,
  tests: [{ name: 'Phase advances', steps: [{ dt: .25 }, { dt: .25 }], assertions: [{ path: 'phase', op: 'eq', value: .5 }] }],
};
export const ribbons: ProgramDefinition = {
  sdkVersion: 1, title: 'Kinetic ribbons', description: 'A new waveform composition, authored as drawing instructions.', parameters: [],
  source: `({init:()=>({phase:0}),update:(s,c)=>({phase:s.phase+c.dt}),draw:(s)=>{const a=[];for(let j=0;j<24;j++){const points=[];for(let i=0;i<60;i++){const x=i/59;points.push([x,.2+j*.023+.1*Math.sin(x*9+s.phase+j*.15)]);}a.push({op:'polyline',points,width:.004,color:j%2?'#f8ac58':'#a87cff',alpha:.9});}return a;}})`, tests: [],
};
export const game: ProgramDefinition = {
  sdkVersion: 1, title: 'Color gate', description: 'Catch blue sparks by clicking the left half; click the right half to switch their color. A custom scoring mechanic.',
  parameters: [{ key: 'points', label: 'Points per catch', min: 1, max: 5, step: 1, default: 2 }],
  source: `({init:()=>({score:0,blue:true,sparks:0}),update:(s,c)=>{for(const e of c.input){if(e.type==='pointerdown'){if(e.x>.5)s.blue=!s.blue;else if(s.blue){s.score+=c.params.points;s.sparks++;}}if(e.type==='keydown'&&e.key==='r')s.score=0;}return s;},draw:(s,c)=>[{op:'rect',x:0,y:0,w:1,h:1,fill:'#0a1322'},{op:'ellipse',x:.25,y:.5,rx:.17,ry:.26,fill:s.blue?'#47d2ff':'#ff6580'},{op:'rect',x:.62,y:.3,w:.28,h:.4,fill:'#6743ac'},{op:'text',x:.5,y:.12,text:'COLOR GATE',size:.07,color:'#ffffff',align:'center'},{op:'text',x:.5,y:.86,text:'SCORE '+s.score,size:.08,color:'#ffdc92',align:'center'}]})`,
  tests: [{ name: 'Catch / switch / blocked catch', steps: [{ dt: .01, input: [{ type: 'pointerdown', x: .2, y: .5 }] }, { dt: .01, input: [{ type: 'pointerdown', x: .8, y: .5 }] }, { dt: .01, input: [{ type: 'pointerdown', x: .2, y: .5 }] }], assertions: [{ path: 'score', op: 'eq', value: 2 }, { path: 'blue', op: 'eq', value: false }, { path: 'sparks', op: 'eq', value: 1 }] }],
};
