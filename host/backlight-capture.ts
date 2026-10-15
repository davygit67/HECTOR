import type { WebContents } from 'electron';
import { analyzeColors, darkColors, rectifyVideo, type BacklightRequest, type BacklightSample } from '../src/shared/backlight.js';
import { isValidQuad, type Quad } from '../src/shared/geometry.js';

const gates = new WeakMap<WebContents, { busy: boolean; last: number }>();
/** Captures only a bounded region of the calling app window; analyzes locally and returns colors, never image data. */
export async function captureBacklight(sender: WebContents, request: BacklightRequest): Promise<BacklightSample> {
  const v = request?.viewport;
  if (!v || !Number.isFinite(v.width) || !Number.isFinite(v.height) || v.width < 200 || v.height < 200 || v.width > 10000 || v.height > 10000) throw new Error('Invalid player viewport.');
  if (!Array.isArray(request.quad) || request.quad.length !== 4 || !request.quad.every(p => p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.y >= 0 && p.x <= v.width && p.y <= v.height)) throw new Error('Keep the whole player visible to sample colors.');
  const minX = Math.floor(Math.min(...request.quad.map(p => p.x))), minY = Math.floor(Math.min(...request.quad.map(p => p.y)));
  const width = Math.ceil(Math.max(...request.quad.map(p => p.x))) - minX, height = Math.ceil(Math.max(...request.quad.map(p => p.y))) - minY;
  const normalized = request.quad.map(p => ({ x: (p.x - minX) / width, y: (p.y - minY) / height })) as Quad;
  if (width < 1 || height < 1 || !isValidQuad(normalized)) throw new Error('The player has no measurable pixels to sample.');
  const gate = gates.get(sender) ?? { busy: false, last: 0 }; gates.set(sender, gate);
  if (gate.busy || performance.now() - gate.last < 65) throw new Error('Waiting for the next color sample.');
  gate.busy = true; gate.last = performance.now(); const started = performance.now();
  try {
    const image = await sender.capturePage({ x: minX, y: minY, width, height }, { stayHidden: true, stayAwake: false });
    if (image.isEmpty()) throw new Error('No video pixels available.');
    const scale = Math.min(1, 384 / Math.max(width, height));
    const small = image.resize({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), quality: 'good' });
    const size = small.getSize(), quad = normalized.map(p => ({ x: p.x * size.width, y: p.y * size.height })) as Quad;
    const frame = rectifyVideo({ ...size, data: small.toBitmap({ scaleFactor: 1 }), order: 'bgra' }, quad), colors = analyzeColors(frame);
    return { colors, sampledAt: Date.now(), costMs: performance.now() - started, dark: darkColors(colors) };
  } finally { gate.busy = false; }
}
