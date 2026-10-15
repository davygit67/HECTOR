import test from 'node:test';
import assert from 'node:assert/strict';
import type { NativeImage } from 'electron';
import { MediaFrameProcessor, bitmapFrameRate } from '../electron/media-frame-processor';

function fixture(width = 1920, height = 1080) {
  const calls = { fullReads: 0, smallReads: 0, fullResizes: 0, smallResizes: 0, encodes: 0 };
  const make = (w: number, h: number): NativeImage => ({
    getSize: () => ({ width: w, height: h }),
    resize: ({ width, height }: { width: number; height: number }) => {
      if (width === 192) calls.smallResizes++; else calls.fullResizes++;
      return make(width, height);
    },
    toBitmap: () => {
      if (w === 192) calls.smallReads++; else calls.fullReads++;
      const bytes = Buffer.alloc(w * h * 4);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4, matte = y < 137 / 1080 * h || y >= 943 / 1080 * h;
        bytes[i] = matte ? 0 : 180; bytes[i + 1] = matte ? 0 : 100; bytes[i + 2] = matte ? 0 : 30; bytes[i + 3] = 255;
      }
      return bytes;
    },
    toJPEG: (quality: number) => { assert.equal(quality, 85, 'Compatibility encoder quality must not decrease'); calls.encodes++; return Buffer.from([1, 2, 3]); },
  } as unknown as NativeImage);
  return { image: make(width, height), calls };
}

test('presentation encodes each frame while analysis runs at most 10Hz with full pixel precision', () => {
  const { image, calls } = fixture(), processor = new MediaFrameProcessor();
  const first = processor.process(image, true, 0);
  for (const at of [17, 34, 51, 68, 85]) {
    const next = processor.process(image, true, at);
    assert.equal(next.sample, first.sample); assert.equal(next.timing.analyzed, false);
  }
  const next = processor.process(image, true, 102);
  assert.notEqual(next.sample, first.sample); assert.equal(next.sample.sampledAt, 102);
  assert.deepEqual(calls, { fullReads: 2, smallReads: 2, fullResizes: 0, smallResizes: 2, encodes: 7 });
  assert.deepEqual(processor.process(image, true, 702).sample.picture, { left: 0, right: 1, top: 137 / 1080, bottom: 943 / 1080 });
  assert.equal(processor.settling(), false);
});
test('disabled lighting avoids color sampling, and enabling refreshes immediately', () => {
  const { image, calls } = fixture(), processor = new MediaFrameProcessor();
  assert.equal(processor.process(image, false, 0).sample.colors.length, 0);
  assert.equal(calls.fullReads, 1, 'Picture detection still provides transparent margins');
  assert.equal(calls.smallReads, 0);
  assert.ok(processor.process(image, true, 10).sample.colors.length > 0);
  assert.equal(calls.smallReads, 1);
  assert.equal(processor.process(image, false, 20).sample.colors.length, 0);
});
test('non-1080 frames normalize once and compatibility cadence has no 15fps default', () => {
  const { image, calls } = fixture(3840, 2160);
  new MediaFrameProcessor().process(image, false, 0);
  assert.equal(calls.fullResizes, 1);
  assert.equal(bitmapFrameRate(''), 30); assert.equal(bitmapFrameRate('60'), 60); assert.equal(bitmapFrameRate('15'), 30);
});
