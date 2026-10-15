import type { MediaContent } from './shared/content';
import { localMediaSource } from './localMedia';

/** Reuses the browser's decoded frame, just as FREEkMapper reuses VideoSource.current_frame. */
export function paintMedia(ctx: CanvasRenderingContext2D, content: MediaContent, width: number, height: number) {
  const source = localMediaSource(content.id), c = content.config, b = content.bounds;
  const x = b.x * width, y = b.y * height, w = b.w * width, h = b.h * height;
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  if (source?.ready && (!(source.element instanceof HTMLVideoElement) || source.element.readyState >= 2)) {
    const quarter = c.rotation === 90 || c.rotation === 270;
    const rw = quarter ? c.height : c.width, rh = quarter ? c.width : c.height;
    const scale = c.fit === 'cover' ? Math.max(w / rw, h / rh) : Math.min(w / rw, h / rh);
    ctx.translate(x + w / 2, y + h / 2); ctx.scale(c.flipX ? -1 : 1, c.flipY ? -1 : 1);
    ctx.rotate(c.rotation * Math.PI / 180);
    ctx.filter = `brightness(${c.brightness}) contrast(${c.contrast}) saturate(${c.saturation})`;
    const dw = c.fit === 'stretch' ? (quarter ? h : w) : c.width * scale;
    const dh = c.fit === 'stretch' ? (quarter ? w : h) : c.height * scale;
    ctx.drawImage(source.element, -dw / 2, -dh / 2, dw, dh);
  }
  // Loading/missing files stay black in projection; actionable errors live in the inspector.
  ctx.restore();
}
