import { analyzeColors, BACKLIGHT_DEFAULTS } from '../src/shared/backlight';
import { renderLightField } from '../src/shared/lightField';
import { compositeLight } from '../src/lightCompositor';
const source=document.createElement('canvas');source.width=320;source.height=180;const sc=source.getContext('2d')!,pixels=sc.createImageData(320,180);
for(let y=0;y<180;y++)for(let x=0;x<320;x++){
 const u=x/320,v=y/180,b=.5+.5*v-.8*v*v,t=1/(1+Math.exp(-(u-b)*55));
 pixels.data.set([24+(229-24)*t,66+(65-66)*t,215+(116-215)*t,255],(y*320+x)*4);
}sc.putImageData(pixels,0,0);
const colors=analyzeColors(pixels),settings={...BACKLIGHT_DEFAULTS,intensity:1.8,spread:.4,toneProfile:'vivid' as const};
for(const id of ['before','after']){
 const canvas=document.querySelector<HTMLCanvasElement>('#'+id)!,ctx=canvas.getContext('2d')!;ctx.fillStyle='#060b10';ctx.fillRect(0,0,960,650);
 const field=renderLightField(id==='before'?colors.map(({continuation,...c})=>c):colors,480,270,210,settings);
 compositeLight(ctx,field,30,-20,1);ctx.drawImage(source,240,190,480,270);
}
document.querySelector('#results')!.textContent='The outer field estimates local curve direction. The source picture and immediate edge are unchanged. This is color extrapolation, not generated scenery.';
