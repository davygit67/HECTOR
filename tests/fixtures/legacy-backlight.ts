// Frozen pre-diffusion implementation, used only for same-frame visual comparisons.
import { homography, project, type Quad } from '../../src/shared/geometry';
export interface BacklightSettings { intensity: number; spread: number; smoothingMs: number }
export const BACKLIGHT_DEFAULTS: Readonly<BacklightSettings> = { intensity: 1, spread: .18, smoothingMs: 180 };
export const BACKLIGHT_LIMITS = { intensity: { min: 0, max: 2 }, spread: { min: .02, max: .4 }, smoothingMs: { min: 0, max: 1000 } } as const;
export function validateBacklightSettings(value: unknown, partial = false): asserts value is BacklightSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Backlight settings must be an object.');
  const settings = value as Record<string, unknown>;
  if (Object.keys(settings).some(key => !Object.hasOwn(BACKLIGHT_LIMITS, key)) || (!partial && Object.keys(settings).length !== 3)) throw new Error('Use intensity, spread and smoothingMs for backlight settings.');
  for (const [key, val] of Object.entries(settings)) {
    const range = BACKLIGHT_LIMITS[key as keyof BacklightSettings];
    if (typeof val !== 'number' || !Number.isFinite(val) || val < range.min || val > range.max || key === 'smoothingMs' && !Number.isInteger(val)) throw new Error(key + ' must be ' + range.min + '–' + range.max + (key === 'smoothingMs' ? ' whole milliseconds.' : '.'));
  }
}
export type RGB = [number, number, number];
export interface ColorRegion { x: number; y: number; color: RGB; weight: number; region: number }
export interface PixelFrame { width: number; height: number; data: ArrayLike<number>; order?: 'rgba' | 'bgra' }
export interface BacklightSample { colors: ColorRegion[]; sampledAt: number; costMs: number; dark: boolean }
export interface BacklightRequest { contentId: string; quad: Quad; viewport: { width: number; height: number } }
export interface BacklightBridge { sample(request: BacklightRequest): Promise<BacklightSample> }
export const SAMPLE_WIDTH = 96, SAMPLE_HEIGHT = 54;

/** Extend a sampled location to the video perimeter. Lobes centered inside the
 * opaque player are invisible; retain the sample's direction and color weight. */
export function backlightEdge(region: Pick<ColorRegion, 'x' | 'y'>) {
  const x = region.x - .5, y = region.y - .5, distance = Math.max(Math.abs(x), Math.abs(y));
  return distance < 1e-6 ? { x: .5, y: 0 } : { x: .5 + x / (2 * distance), y: .5 + y / (2 * distance) };
}

/** Rectify the projected video quadrilateral before sampling. No pixels outside it or its controls/footer enter analysis. */
export function rectifyVideo(frame: PixelFrame, quad: Quad): PixelFrame {
  if (frame.width < 1 || frame.height < 1 || frame.data.length !== frame.width * frame.height * 4) throw new Error('Invalid video sample.');
  const normalized = quad.map(p => ({ x: p.x / frame.width, y: p.y / frame.height })) as Quad;
  const h = homography(normalized), data = new Uint8ClampedArray(SAMPLE_WIDTH * SAMPLE_HEIGHT * 4);
  for (let y = 0; y < SAMPLE_HEIGHT; y++) for (let x = 0; x < SAMPLE_WIDTH; x++) {
    // Avoid player chrome near the frame edge. Letterboxing remains dark; no fabricated colors.
    const uv = { x: .035 + (x + .5) / SAMPLE_WIDTH * .93, y: .09 + (y + .5) / SAMPLE_HEIGHT * .79 };
    const p = project(h, uv), sx = Math.max(0, Math.min(frame.width - 1, Math.floor(p.x * frame.width))), sy = Math.max(0, Math.min(frame.height - 1, Math.floor(p.y * frame.height)));
    const a = (sy * frame.width + sx) * 4, b = (y * SAMPLE_WIDTH + x) * 4;
    data[b] = frame.data[a + (frame.order === 'bgra' ? 2 : 0)]; data[b + 1] = frame.data[a + 1]; data[b + 2] = frame.data[a + (frame.order === 'bgra' ? 0 : 2)]; data[b + 3] = 255;
  }
  return { width: SAMPLE_WIDTH, height: SAMPLE_HEIGHT, data };
}
/** Three dominant color buckets per spatial tile. Counts retain color prevalence, centroids retain rough location. */
export function analyzeColors(frame: PixelFrame): ColorRegion[] {
  const colors: ColorRegion[] = [];
  for (let ry = 0; ry < 3; ry++) for (let rx = 0; rx < 4; rx++) {
    const buckets = new Map<number, { n: number; r: number; g: number; b: number; x: number; y: number }>();
    let total = 0;
    for (let y = Math.floor(ry * frame.height / 3); y < Math.floor((ry + 1) * frame.height / 3); y++) for (let x = Math.floor(rx * frame.width / 4); x < Math.floor((rx + 1) * frame.width / 4); x++) {
      const i = (y * frame.width + x) * 4, r = frame.data[i], g = frame.data[i + 1], b = frame.data[i + 2];
      const key = (r >> 6) * 16 + (g >> 6) * 4 + (b >> 6), bin = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0, x: 0, y: 0 };
      bin.n++; bin.r += r; bin.g += g; bin.b += b; bin.x += (x + .5) / frame.width; bin.y += (y + .5) / frame.height; buckets.set(key, bin); total++;
    }
    const bins = [...buckets.entries()].sort((a, b) => b[1].n - a[1].n || a[0] - b[0]).slice(0, 3);
    for (let k = 0; k < 3; k++) {
      const bin = bins[k]?.[1];
      colors.push(bin ? { x: bin.x / bin.n, y: bin.y / bin.n, color: [bin.r / bin.n, bin.g / bin.n, bin.b / bin.n], weight: bin.n / total, region: ry * 4 + rx }
        : { x: (rx + .5) / 4, y: (ry + .5) / 3, color: [0, 0, 0], weight: 0, region: ry * 4 + rx });
    }
  }
  return colors;
}
export function smoothColors(previous: ColorRegion[], next: ColorRegion[], elapsedMs: number, smoothingMs: number): ColorRegion[] {
  const a = smoothingMs <= 0 ? 1 : 1 - Math.exp(-Math.max(0, elapsedMs) / smoothingMs);
  // Match only within a tile, preventing color clusters from swapping screen sides between frames.
  const remaining = new Set(previous.map((_, i) => i));
  return next.map(target => {
    let best = -1, distance = Infinity;
    for (const i of remaining) {
      const p = previous[i]; if (p.region !== target.region) continue;
      const d = p.color.reduce((sum, c, k) => sum + (c - target.color[k]) ** 2, 0);
      if (d < distance) { distance = d; best = i; }
    }
    const old = best >= 0 ? previous[best] : { ...target, color: [0, 0, 0] as RGB, weight: 0 }; remaining.delete(best);
    const mix = (p: number, n: number) => p + (n - p) * a;
    return { region: target.region, x: mix(old.x, target.x), y: mix(old.y, target.y), weight: mix(old.weight, target.weight), color: target.color.map((c, i) => mix(old.color[i], c)) as RGB };
  });
}
export function darkColors(colors: ColorRegion[]) { return colors.every(c => c.weight === 0 || Math.max(...c.color) < 12); }
