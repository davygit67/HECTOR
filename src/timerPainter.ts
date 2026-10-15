import { formatTime, remaining, type Timer } from './shared/domain';

export function paintTimer(ctx: CanvasRenderingContext2D, t: Timer, TEX_W: number, TEX_H: number, now: number) {
    const x = t.bounds.x * TEX_W, y = t.bounds.y * TEX_H, w = t.bounds.w * TEX_W, h = t.bounds.h * TEX_H, left = remaining(t, now), done = left <= 0 && t.status !== 'idle';
    ctx.save(); ctx.beginPath(); ctx.roundRect(x, y, w, h, Math.min(12, h / 10)); ctx.clip();
    ctx.fillStyle = done ? '#40301f' : '#122b23'; ctx.fillRect(x, y, w, h);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#e6f3d4';
    ctx.font = `${Math.max(9, h * .068)}px -apple-system, sans-serif`; ctx.fillText(t.title, x + w / 2, y + h * .22, w * .86);
    ctx.font = `500 ${Math.min(h * .44, w * (left >= 3600000 ? .17 : .25))}px -apple-system, sans-serif`; ctx.fillText(formatTime(left), x + w / 2, y + h * .51, w * .88);
    ctx.fillStyle = '#b4c7a4'; ctx.font = `${Math.max(8, h * .061)}px -apple-system, sans-serif`;
    ctx.fillText(done ? 'Time is up' : t.status === 'running' ? 'Counting down' : t.status === 'paused' ? 'Paused' : 'Ready when you are', x + w / 2, y + h * .79, w * .9);
    ctx.fillStyle = '#b8db90'; ctx.fillRect(x, y + h - 3, w * left / t.durationMs, 3); ctx.restore();
}
