import type { NativeImage } from 'electron';
import { analyzeColors, darkColors, type BacklightSample } from '../src/shared/backlight.js';
import { createPictureTracker } from '../src/shared/activePicture.js';

export interface FrameProcessingTiming { capturedAt: number; totalMs: number; analysisMs: number; encodeMs: number; analyzed: boolean; jpegBytes: number }
/** Bitmap compatibility path. Presentation and analysis have separate cadences;
 * GPU texture transport should eventually bypass this encoder altogether. */
export class MediaFrameProcessor {
  private readonly picture = createPictureTracker();
  private sample?: BacklightSample;
  private analyzedAt = -Infinity;
  private analyzedLight?: boolean;
  constructor(private readonly analysisIntervalMs = 100) {}
  settling() { return this.picture.settling(); }
  process(image: NativeImage, lightEnabled: boolean, now: number) {
    const started = performance.now(), size = image.getSize();
    // Normal 1080p sources already have the target size; avoid a redundant copy.
    const full = size.width === 1920 && size.height === 1080 ? image : image.resize({ width: 1920, height: 1080, quality: 'good' });
    const analyzed = !this.sample || now - this.analyzedAt >= this.analysisIntervalMs || this.analyzedLight !== lightEnabled;
    let analysisMs = 0;
    if (analyzed) {
      const before = performance.now();
      const picture = this.picture.update({ width: 1920, height: 1080, data: full.toBitmap(), order: 'bgra' }, now);
      let colors: BacklightSample['colors'] = [];
      if (lightEnabled) {
        const small = full.resize({ width: 192, height: 108, quality: 'good' });
        colors = analyzeColors({ width: 192, height: 108, data: small.toBitmap(), order: 'bgra' }, picture);
      }
      analysisMs = performance.now() - before;
      this.sample = { colors, picture, sampledAt: now, costMs: analysisMs, dark: darkColors(colors) };
      this.analyzedAt = now; this.analyzedLight = lightEnabled;
    }
    const encoding = performance.now(), jpeg = full.toJPEG(85), end = performance.now();
    return { jpeg, sample: this.sample!, timing: { capturedAt: now, totalMs: end - started, analysisMs, encodeMs: end - encoding, analyzed, jpegBytes: jpeg.length } satisfies FrameProcessingTiming };
  }
}

/** Explicit opt-in to the heavier 60 fps CPU compatibility path. GPU output is
 * the intended 60 fps architecture; this setting is not an achieved-rate claim. */
export function bitmapFrameRate(value = process.env.PM_MEDIA_FPS): 30 | 60 { return value === '60' ? 60 : 30; }
