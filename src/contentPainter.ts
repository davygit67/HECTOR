import { readProgram } from './programRuntime';
import { paintProgramFrame } from './programPainter';
import { paintMedia } from './mediaPainter';
import { layerVisible, layerOpacity } from './shared/layers';
import { readMediaImage, readMediaPicture } from './nativeMedia';
import { readBacklight } from './backlightField';
import { BACKLIGHT_DEFAULTS, type ColorRegion } from './shared/backlight';
import { renderLightField, type LightField } from './shared/lightField';
import { compositeLight } from './lightCompositor';
import { clockMs, gameTarget, GAME_GRID, randomUnit, type ArtContent, type ContentInstance, type YouTubeContent } from './shared/content';
import { swimmingFish } from './shared/art-motion';
import { surfacePoint, type Surface } from './shared/spatial';
import { youtubePictureBounds } from './shared/youtube';
import type { Scene } from './shared/domain';
import { createRoomLightMap, mapRoomLight, lightProtectedBounds, type RoomLightMap } from './shared/roomLight';
import { WIDTH, HEIGHT } from './shared/geometry';

const palettes = {
  lagoon: { back: '#071d28', mid: '#135568', light: '#8ff2c3', accent: '#66bde4' },
  ember: { back: '#2d1022', mid: '#7a3241', light: '#ffe2a2', accent: '#ef9279' },
  violet: { back: '#171333', mid: '#3b347f', light: '#d5b8ff', accent: '#7ee0ec' },
};
function wrapped(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      if (!word) continue;
      if (ctx.measureText(word).width > width) {
        if (line) { lines.push(line); line = ''; }
        for (const character of word) {
          if (ctx.measureText(line + character).width > width) { lines.push(line); line = ''; }
          line += character;
        }
      } else if (line && ctx.measureText(line + ' ' + word).width > width) { lines.push(line); line = word; }
      else line += (line ? ' ' : '') + word;
    }
    lines.push(line);
  }
  return lines;
}
function fitText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, w: number, h: number, size: number, color: string, weight = '400') {
  let lines: string[] = [], font = size;
  for (let attempt = 0; attempt < 60; attempt++) {
    ctx.font = weight + ' ' + font + 'px -apple-system, sans-serif'; lines = wrapped(ctx, text, w);
    if (lines.length * font * 1.35 <= h) break;
    font *= .9;
  }
  ctx.fillStyle = color; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  lines.forEach((line, i) => ctx.fillText(line, x, y + i * font * 1.35, w));
}
function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, width: number, size: number, color: string) {
  ctx.fillStyle = color; ctx.font = '500 ' + size + 'px -apple-system, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(text, x, y, width);
}
export function paintArt(ctx: CanvasRenderingContext2D, art: ArtContent, surface: Surface, w: number, h: number, now: number) {
  const p = palettes[art.config.palette], t = clockMs(art.state.clock, now) / 1000 * art.config.speed, seed = art.config.seed;
  const gradient = ctx.createLinearGradient(0, h, w, 0); gradient.addColorStop(0, p.back); gradient.addColorStop(1, p.mid);
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, w, h);
  if (art.config.preset === 'fish') {
    // Bubbles and swimmers share the artwork clock, so pause/resume also freezes the water.
    ctx.strokeStyle = p.light; ctx.lineWidth = 1;
    for (let i = 0; i < 25; i++) {
      const phase = randomUnit(seed, i + 900), x = (randomUnit(seed, i + 950) + Math.sin(t * .2 + i) * .009) * w;
      const y = (1 - ((phase + t * (.013 + phase * .012)) % 1)) * h;
      ctx.globalAlpha = .15 + phase * .18; ctx.beginPath(); ctx.arc(x, y, 1.5 + phase * 3, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (const fish of swimmingFish(art, now)) {
      const size = fish.size * Math.min(w, h);
      ctx.save(); ctx.translate(fish.x * w, fish.y * h); ctx.rotate(fish.tilt); ctx.scale(fish.direction * size, size);
      const color = [p.light, p.accent, '#ffda92'][fish.shade];
      // Broad forked tail, dorsal/pectoral fins, oval body and a contrasting eye are distinct from contours.
      ctx.fillStyle = color; ctx.globalAlpha = .78;
      const tailTip = -1.46 + fish.tail * .09, tailWidth = .33 + fish.tail * .08;
      ctx.beginPath(); ctx.moveTo(-.68, 0); ctx.lineTo(tailTip, -tailWidth); ctx.quadraticCurveTo(-1.26, 0, tailTip, tailWidth); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-.4, -.25); ctx.quadraticCurveTo(-.25, -.8, .25, -.23); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1; ctx.beginPath(); ctx.moveTo(.9, 0);
      ctx.bezierCurveTo(.55, -.54, -.45, -.48, -.83, 0);
      ctx.bezierCurveTo(-.4, .48, .6, .5, .9, 0); ctx.fill();
      ctx.fillStyle = p.back; ctx.globalAlpha = .2;
      ctx.beginPath(); ctx.moveTo(.12, .03); ctx.quadraticCurveTo(-.1, .62, -.45, .18); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = p.back; ctx.lineWidth = .035; ctx.globalAlpha = .35;
      ctx.beginPath(); ctx.moveTo(.32, -.29); ctx.quadraticCurveTo(.1, 0, .32, .29); ctx.stroke();
      ctx.globalAlpha = 1; ctx.fillStyle = '#f4fff3'; ctx.beginPath(); ctx.arc(.57, -.08, .085, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#122c35'; ctx.beginPath(); ctx.arc(.59, -.075, .045, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  } else if (art.config.preset === 'stars') {
    for (let i = 0; i < 150; i++) {
      const depth = .2 + randomUnit(seed, i + 450) * .8;
      const x = ((randomUnit(seed, i) + t * .008 * depth) % 1) * w, y = randomUnit(seed, i + 150) * h;
      ctx.globalAlpha = .35 + .65 * (.5 + .5 * Math.sin(t * depth + i));
      ctx.fillStyle = i % 4 ? p.light : p.accent;
      ctx.beginPath(); ctx.arc(x, y, .5 + depth * 1.7, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    const halo = ctx.createRadialGradient(w * .72, h * .3, 1, w * .72, h * .3, h * .35);
    halo.addColorStop(0, p.light + '44'); halo.addColorStop(1, p.light + '00');
    ctx.fillStyle = halo; ctx.fillRect(0, 0, w, h);
  } else {
    const contours = art.config.preset === 'contours', n = contours ? 26 : 62;
    for (let i = 0; i < n; i++) {
      ctx.beginPath();
      for (let j = 0; j <= 60; j++) {
        const u = j / 60, world = surfacePoint(surface, { x: u, y: i / n });
        const phase = world[0] * 1.6 + world[1] * 1.1 + world[2] * .8 + seed * .013;
        const y = (i / n + Math.sin(phase + t * .35 + i * .12) * .14 + Math.cos(u * 8 - t * .2) * .055) * h;
        if (j) ctx.lineTo(u * w, y); else ctx.moveTo(u * w, y);
      }
      ctx.globalAlpha = contours ? .42 : .06 + Math.sin(i / n * Math.PI) * .13;
      ctx.strokeStyle = i % 5 ? p.light : p.accent; ctx.lineWidth = contours ? 1 : h * .025; ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}
const lightCache=new Map<string,{colors:ColorRegion[];key:string;field:LightField}>();
export function paintYouTubeBacklight(ctx: CanvasRenderingContext2D, c: ContentInstance, w: number, h: number, now = Date.now()) {
  if(c.kind!=='youtube'||!c.config.backlight){lightCache.delete(c.id);return}
  const field=readBacklight(c.id,now);if(!field){lightCache.delete(c.id);return}
  const settings={...BACKLIGHT_DEFAULTS,...c.config.backlightSettings},bounds=youtubePictureBounds(c.bounds,field.picture);
  const videoWidth=bounds.w*w,videoHeight=bounds.h*h,padding=Math.max(1,settings.spread*Math.min(w,h));
  const key=JSON.stringify([videoWidth,videoHeight,padding,settings]);let cached=lightCache.get(c.id);
  if(!cached||cached.colors!==field.colors||cached.key!==key){
    cached={colors:field.colors,key,field:renderLightField(field.colors,videoWidth,videoHeight,padding,settings)};lightCache.set(c.id,cached);
    if(lightCache.size>10)lightCache.delete(lightCache.keys().next().value!);
  }
  compositeLight(ctx,cached.field,bounds.x*w-padding,bounds.y*h-padding,field.alpha*(settings.opacity??1)*layerOpacity(c));
}
const roomCache=new Map<string,{geometryKey:string;styleKey:string;colors:ColorRegion[];map:RoomLightMap;field:LightField}>();
function paintRoomSource(ctx:CanvasRenderingContext2D,scene:Scene,surface:Surface,video:YouTubeContent,w:number,h:number,now:number){
  const sample=readBacklight(video.id,now),source=scene.surfaces.find(s=>s.id===video.surfaceId);if(!sample||!source)return;
  const settings={...BACKLIGHT_DEFAULTS,...video.config.backlightSettings};if(!settings.opacity||!settings.intensity)return;
  const bounds=youtubePictureBounds(video.bounds,sample.picture),fieldWidth=640,fieldHeight=fieldWidth*bounds.h*HEIGHT/(bounds.w*WIDTH);
  const padding=Math.max(1,settings.spread*HEIGHT*fieldWidth/(bounds.w*WIDTH))*(1+3*(settings.roomFill??0)),styleKey=JSON.stringify(settings);
  const geometryKey=JSON.stringify([source,surface,scene.viewer,video.bounds,sample.picture,fieldHeight,padding,settings.roomFill,w,h]),key=video.id+':'+surface.id;
  let cached=roomCache.get(key);
  if(!cached||cached.colors!==sample.colors||cached.geometryKey!==geometryKey||cached.styleKey!==styleKey){
    const sourceKey=video.id+':room',sourceStyle=JSON.stringify([fieldWidth,fieldHeight,padding,settings]);let sourceField=lightCache.get(sourceKey);
    if(!sourceField||sourceField.colors!==sample.colors||sourceField.key!==sourceStyle){sourceField={colors:sample.colors,key:sourceStyle,field:renderLightField(sample.colors,fieldWidth,fieldHeight,padding,settings)};lightCache.set(sourceKey,sourceField);if(lightCache.size>20)lightCache.delete(lightCache.keys().next().value!);}
    const map=cached?.geometryKey===geometryKey?cached.map:createRoomLightMap(scene,source,surface,video,sourceField.field,224,126,sample.picture);
    cached={geometryKey,styleKey,colors:sample.colors,map,field:mapRoomLight(sourceField.field,map,w,h)};roomCache.set(key,cached);
    if(roomCache.size>20)roomCache.delete(roomCache.keys().next().value!);
  }
  compositeLight(ctx,cached.field,0,0,sample.alpha*settings.opacity*layerOpacity(video)*(source.id===surface.id?1:Math.min(1,(settings.roomFill??0)*4)));
}
/** Apply the same room light to every view, while protecting the union of all
 * foreground panels. Repeated subtraction handles overlapping panels correctly. */
export function paintSceneBacklight(ctx:CanvasRenderingContext2D,scene:Scene,surface:Surface,w:number,h:number,now=Date.now()){
  ctx.save();ctx.beginPath();for(const polygon of [surface.boundary,...surface.holes]){polygon.forEach((p,i)=>i?ctx.lineTo(p.x*w,p.y*h):ctx.moveTo(p.x*w,p.y*h));ctx.closePath();}ctx.clip('evenodd');
  for(const b of lightProtectedBounds(scene,surface.id,readMediaPicture)){ctx.beginPath();ctx.rect(0,0,w,h);ctx.rect(b.x*w,b.y*h,b.w*w,b.h*h);ctx.clip('evenodd');}
  for(const video of scene.contents){
    if (!layerVisible(video) || layerOpacity(video) === 0) continue;
    if(video.kind!=='youtube'||!video.config.backlight)continue;
    if((video.config.backlightSettings?.roomFill??0)>0)paintRoomSource(ctx,scene,surface,video,w,h,now);
    else if(video.surfaceId===surface.id)paintYouTubeBacklight(ctx,video,w,h,now);
  }
  ctx.restore();
}
export function paintContent(ctx: CanvasRenderingContext2D, c: ContentInstance, w: number, h: number, now: number) {
  if (c.kind === 'program') { const frame = readProgram(c.id)?.frame; if (frame) { ctx.save(); ctx.translate(c.bounds.x * w, c.bounds.y * h); paintProgramFrame(ctx, frame.commands, c.bounds.w * w, c.bounds.h * h); ctx.restore(); } return; }
  if (c.kind === 'media') { paintMedia(ctx, c, w, h); return; }
  if (c.kind === 'art') return;
  if (c.kind === 'youtube') {
    const image=readMediaImage(c.id),picture=readMediaPicture(c.id),bounds=youtubePictureBounds(c.bounds,picture);
    const x=bounds.x*w,y=bounds.y*h,pw=bounds.w*w,ph=bounds.h*h;
    if (image) {
      // Discard only the detected matte. Matching source/destination crops keep
      // every picture pixel in place and leave the surrounding layer transparent.
      ctx.drawImage(image,picture.left*image.width,picture.top*image.height,(picture.right-picture.left)*image.width,(picture.bottom-picture.top)*image.height,x,y,pw,ph);
    } else {
      ctx.save();ctx.beginPath();ctx.rect(x,y,pw,ph);ctx.clip();ctx.translate(x,y);
      ctx.fillStyle='#111b25';ctx.fillRect(0,0,pw,ph);
      label(ctx,'▶ YOUTUBE · PLACEMENT PREVIEW',pw*.07,ph*.18,pw*.86,ph*.065,'#b9c9eb');
      fitText(ctx,c.title,pw*.07,ph*.34,pw*.86,ph*.23,Math.min(pw*.07,ph*.12),'#f1f5ff','600');
      fitText(ctx,'Use the player in Surface layout or manual output.',pw*.07,ph*.68,pw*.86,ph*.23,ph*.067,'#a6b6cb');
      ctx.restore();
    }
    return;
  }
  const x = c.bounds.x * w, y = c.bounds.y * h, pw = c.bounds.w * w, ph = c.bounds.h * h;
  ctx.save(); ctx.translate(x, y); ctx.beginPath(); ctx.roundRect(0, 0, pw, ph, Math.min(12, ph * .045)); ctx.clip();
  if (c.kind === 'note') {
    ctx.fillStyle = '#faf4dd'; ctx.fillRect(0, 0, pw, ph); ctx.fillStyle = c.config.accent; ctx.fillRect(0, 0, pw, ph * .035);
    label(ctx, c.title, pw * .07, ph * .14, pw * .86, Math.min(pw * .065, ph * .1), '#35413b');
    fitText(ctx, c.config.text, pw * .07, ph * .27, pw * .86, ph * .65, Math.min(pw * .068, ph * .13), '#415146');
  } else if (c.kind === 'recipe') {
    const step = c.state.stepIndex, ingredients = step < 0;
    ctx.fillStyle = '#f2eedf'; ctx.fillRect(0, 0, pw, ph);
    label(ctx, ingredients ? 'INGREDIENTS' : 'STEP ' + (step + 1) + ' / ' + c.config.steps.length, pw * .07, ph * .1, pw * .86, ph * .041, '#8b7053');
    fitText(ctx, c.title, pw * .07, ph * .18, pw * .86, ph * .14, Math.min(ph * .1, pw * .07), '#243c30', '600');
    const text = ingredients ? c.config.ingredients.map(line => '• ' + line).join('\n') : c.config.steps[step];
    fitText(ctx, text, pw * .07, ph * .38, pw * .86, ph * .46, Math.min(ph * .08, pw * .069), '#465647');
    label(ctx, c.config.source || 'Recipe supplied locally', pw * .07, ph * .93, pw * .86, Math.min(ph * .037, pw * .035), '#8c8e7c');
  } else {
    const s = c.state, target = gameTarget(c), active = s.status === 'running', g = GAME_GRID;
    ctx.fillStyle = '#14272f'; ctx.fillRect(0, 0, pw, ph);
    label(ctx, c.title, pw * .08, ph * .115, pw * .60, Math.min(ph * .082, pw * .05), '#e0efcf');
    ctx.textAlign = 'right'; ctx.fillText(String(s.score), pw * .92, ph * .115);
    label(ctx, s.status === 'finished' ? 'COMPLETE · ' + s.misses + ' MISSES' : 'ROUND ' + Math.min(s.round + 1, c.config.rounds) + ' / ' + c.config.rounds, pw * .08, ph * .22, pw * .84, ph * .037, '#8caaaa');
    for (let index = 0; index < 8; index++) {
      const cellW = g.w * pw / 4, cellH = g.h * ph / 2, cx = g.x * pw + index % 4 * cellW, cy = g.y * ph + Math.floor(index / 4) * cellH;
      ctx.fillStyle = active && index === target ? '#dcf094' : '#263d43';
      ctx.beginPath(); ctx.roundRect(cx + 3, cy + 3, cellW - 6, cellH - 6, Math.min(8, cellH * .12)); ctx.fill();
      if (active && index === target) {
        ctx.strokeStyle = '#4d6e48'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx + cellW / 2, cy + cellH / 2, Math.min(cellW, cellH) * .19, 0, Math.PI * 2); ctx.stroke();
      }
    }
    const hint = active ? 'TAP THE LIT TARGET' : s.status === 'paused' ? 'PAUSED' : s.status === 'finished' ? 'RESET TO PLAY AGAIN' : 'START IN THE INSPECTOR';
    label(ctx, hint, pw * .08, ph * .915, pw * .84, ph * .041, '#b3cbb6');
  }
  ctx.restore();
}
