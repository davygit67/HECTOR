import type { ProgramDraw } from './shared/program';
/** Only validated primitives cross from the interpreter into the trusted painter. */
export function paintProgramFrame(ctx: CanvasRenderingContext2D, commands: ProgramDraw[], w: number, h: number) {
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
  for (const c of commands) {
    ctx.save(); ctx.globalAlpha *= c.alpha ?? 1;
    if (c.op === 'rect') { ctx.fillStyle = c.fill; ctx.fillRect(c.x*w, c.y*h, c.w*w, c.h*h); }
    else if (c.op === 'ellipse') { ctx.fillStyle = c.fill; ctx.beginPath(); ctx.ellipse(c.x*w,c.y*h,c.rx*w,c.ry*h,0,0,Math.PI*2); ctx.fill(); }
    else if (c.op === 'line') { ctx.strokeStyle=c.color;ctx.lineWidth=c.width*h;ctx.beginPath();ctx.moveTo(c.x*w,c.y*h);ctx.lineTo(c.x2*w,c.y2*h);ctx.stroke(); }
    else if (c.op === 'polygon' || c.op === 'polyline') {
      ctx.beginPath(); c.points.forEach(([x,y],i)=> i ? ctx.lineTo(x*w,y*h) : ctx.moveTo(x*w,y*h));
      if(c.op==='polygon'){ctx.closePath();ctx.fillStyle=c.color;ctx.fill();}else{ctx.strokeStyle=c.color;ctx.lineWidth=(c.width??.002)*h;ctx.stroke();}
    } else if (c.op === 'text') { ctx.fillStyle=c.color;ctx.font=`${c.size*h}px sans-serif`;ctx.textAlign=c.align??'left';ctx.textBaseline='middle';ctx.fillText(c.text,c.x*w,c.y*h,w); }
    ctx.restore();
  }
  ctx.restore();
}
