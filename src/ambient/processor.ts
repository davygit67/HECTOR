// Runs adknate05's analysis, smoothing and light field for every lit surface of one renderer. It runs in a worker so
// none of this work competes with the render loop; it is plain code, so it also runs inline if no worker can start.
import { createBacklightAnalyzer, darkColors, type BacklightSettings, type ColorRegion } from './backlight';
import { BacklightFields } from './field';
import { renderLightField } from './lightField';

/** Width, height and padding of the lit area, in output pixels. */
export type FieldGeometry = [number, number, number];
export type AmbientRequest =
  | { type: 'sample'; id: string; key: string; width: number; height: number; data: Uint8ClampedArray; now: number; smoothingMs: number; geometry: FieldGeometry; settings: BacklightSettings; fieldKey: string }
  | { type: 'field'; id: string; key: string; geometry: FieldGeometry; settings: BacklightSettings; fieldKey: string }
  | { type: 'forget'; id: string };
export interface AmbientResult {
  id: string; key: string; sampledAt?: number; analysisMs?: number; dark?: boolean; settling?: boolean;
  /** Present only when the light changed; `data` is RGBA, `size` the geometry it was rendered for. */
  field?: { width: number; height: number; data: Uint8ClampedArray; size: FieldGeometry; fieldKey: string; ms: number };
}
export class AmbientProcessor {
  private fields = new BacklightFields();
  private surfaces = new Map<string, { key: string; analyzer: ReturnType<typeof createBacklightAnalyzer>; colors: ColorRegion[] | null; fieldColors: ColorRegion[] | null; fieldKey: string }>();
  handle(request: AmbientRequest): AmbientResult | null {
    if (request.type === 'forget') { this.surfaces.delete(request.id); this.fields.clear(request.id); return null; }
    let surface = this.surfaces.get(request.id);
    // A new source never inherits the previous one's light or letterbox.
    if (surface?.key !== request.key) {
      this.fields.clear(request.id);
      surface = { key: request.key, analyzer: createBacklightAnalyzer(), colors: null, fieldColors: null, fieldKey: '' };
      this.surfaces.set(request.id, surface);
    }
    const result: AmbientResult = { id: request.id, key: request.key };
    if (request.type === 'sample') {
      const start = performance.now(), colors = surface.analyzer({ width: request.width, height: request.height, data: request.data }, request.now);
      result.dark = darkColors(colors); result.settling = surface.analyzer.settling(); result.sampledAt = request.now;
      this.fields.update(request.id, { colors, sampledAt: request.now, costMs: 0, dark: result.dark, picture: surface.analyzer.picture() }, request.smoothingMs);
      surface.colors = this.fields.read(request.id, request.now)?.colors ?? null;
      result.analysisMs = performance.now() - start;
    }
    // The field is rebuilt only when the smoothed colours, the surface's size or the settings change.
    if (surface.colors && (surface.colors !== surface.fieldColors || surface.fieldKey !== request.fieldKey)) {
      const start = performance.now(), [width, height, padding] = request.geometry;
      const field = renderLightField(surface.colors, width, height, padding, request.settings);
      surface.fieldColors = surface.colors; surface.fieldKey = request.fieldKey;
      result.field = { width: field.width, height: field.height, data: field.data, size: request.geometry, fieldKey: request.fieldKey, ms: performance.now() - start };
    }
    return result;
  }
}
