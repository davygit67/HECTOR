// Isolated processing profile: no network, user media, scene reads or visible windows.
// Run after build: electron tests/profile-media.cjs
const { app, nativeImage } = require('electron');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir, cpus } = require('node:os');
const { join } = require('node:path');
const profileDir = mkdtempSync(join(tmpdir(), 'mapper-profile-'));
app.setPath('userData', profileDir);
const summarize = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return { median: +sorted[Math.floor(sorted.length / 2)].toFixed(3), p95: +sorted[Math.floor(sorted.length * .95)].toFixed(3) };
};
app.whenReady().then(async () => {
  const { createBacklightAnalyzer } = await import('../dist-electron/src/shared/backlight.js');
  const { renderLightField } = await import('../dist-electron/src/shared/lightField.js');
  const { BACKLIGHT_DEFAULTS } = await import('../dist-electron/src/shared/backlight.js');
  const { MediaFrameProcessor } = await import('../dist-electron/electron/media-frame-processor.js');
  const width = 1920, height = 1080, pixels = Buffer.alloc(width * height * 4);
  let random = 1337;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
    const i = (y * width + x) * 4, matte = y < 120 || y >= 960;
    pixels[i] = matte ? 0 : (x / width * 170 + (random & 31)) | 0;
    pixels[i + 1] = matte ? 0 : (y / height * 190 + (random >>> 8 & 31)) | 0;
    pixels[i + 2] = matte ? 0 : ((x + y) / (width + height) * 180 + (random >>> 16 & 31)) | 0;
    pixels[i + 3] = 255;
  }
  const image = nativeImage.createFromBitmap(pixels, { width, height });
  const analyze = createBacklightAnalyzer(), results = { resize: [], bitmap: [], analysis: [], jpeg: [], textEncode: [], textDecode: [], total: [], light: [] };
  let jpegBytes = 0, wireBytes = 0;
  for (let n = 0; n < 65; n++) {
    const start = performance.now();
    const full = image.resize({ width, height, quality: 'good' }), small = full.resize({ width: 192, height: 108, quality: 'good' });
    const resized = performance.now();
    const fullBytes = full.toBitmap(), smallBytes = small.toBitmap(); const copied = performance.now();
    const colors = analyze({ width: 192, height: 108, data: smallBytes, order: 'bgra' }, n * 70, { width, height, data: fullBytes, order: 'bgra' });
    const analyzed = performance.now(), jpeg = full.toJPEG(85), encoded = performance.now();
    const text = JSON.stringify({ jpeg: jpeg.toString('base64'), colors }), serialized = performance.now();
    Buffer.from(JSON.parse(text).jpeg, 'base64'); const deserialized = performance.now();
    renderLightField(colors, 640, 360, 180, BACKLIGHT_DEFAULTS); const lit = performance.now();
    jpegBytes = jpeg.length; wireBytes = Buffer.byteLength(text);
    if (n >= 5) for (const [key, duration] of Object.entries({ resize: resized - start, bitmap: copied - resized, analysis: analyzed - copied, jpeg: encoded - analyzed, textEncode: serialized - encoded, textDecode: deserialized - serialized, total: deserialized - start, light: lit - deserialized })) results[key].push(duration);
  }
  const optimized = [];
  for (const fps of [30, 60]) {
    const processor = new MediaFrameProcessor(), times = [], encode = []; let analyzed = 0, bytesEqual = true;
    const expected = image.toJPEG(85);
    for (let n = 0; n < 180; n++) {
      const start = performance.now(), result = processor.process(image, true, n * 1000 / fps);
      const text = JSON.stringify({ jpeg: result.jpeg.toString('base64'), colors: result.sample });
      Buffer.from(JSON.parse(text).jpeg, 'base64'); const end = performance.now();
      if (n >= 30) { times.push(end - start); encode.push(result.timing.encodeMs); if (result.timing.analyzed) analyzed++; }
      bytesEqual &&= result.jpeg.equals(expected);
    }
    optimized.push({ scheduledFps: fps, samples: times.length, analyzed, jpegUnchanged: bytesEqual, cpuMs: summarize(times), encodeMs: summarize(encode), meanCpuMs: +(times.reduce((sum,n)=>sum+n,0)/times.length).toFixed(3) });
  }
  console.log(JSON.stringify({ kind: 'synthetic CPU processing only; excludes GPU readback, video decode, socket transfer and final display', platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model, electron: process.versions.electron, samples: results.total.length, raster: [width, height], jpegBytes, jsonBytes: wireBytes, copiedBytesPerFrame: pixels.length + 192 * 108 * 4, beforeMilliseconds: Object.fromEntries(Object.entries(results).map(([key, values]) => [key, summarize(values)])), optimized }, null, 2));
}).catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  try { rmSync(profileDir, { recursive: true, force: true }); } catch {}
  app.exit(process.exitCode || 0);
});
