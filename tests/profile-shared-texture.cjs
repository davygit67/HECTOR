// Isolated feasibility/profile of Electron's experimental GPU transport.
// No user scene, network or visible windows. This is not a production backend.
const { app, BrowserWindow, ipcMain, sharedTexture } = require('electron');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const assert = require('node:assert/strict');
const directory = mkdtempSync(join(tmpdir(), 'mapper-texture-profile-'));
// Opaque SDR sRGB bytes: all 256 levels, saturated channels and one-pixel edges.
// The animated area starts below this band, so expected pixels are independent
// of presentation timing. This tests a full texture import/draw/readback cycle.
function referencePixel(x, y) {
  const ramp = x % 256;
  if (y < 32) return [ramp, ramp, ramp, 255];
  if (y < 64) return [ramp, (x * 17) % 256, (x * 37) % 256, 255];
  if (y < 96) return x % 2 ? [255, 0, 255, 255] : [0, 255, 0, 255];
  return [(x * 29 + y * 13) % 256, (x * 7 + y * 31) % 256, (x * 53 + y * 3) % 256, 255];
}
app.setPath('userData', directory);
let source, output, finished = false, watchdog;
const finish = value => {
  if (finished) return; finished = true; clearTimeout(watchdog);
  console.log(JSON.stringify(value, null, 2));
  for (const win of [source, output]) if (win && !win.isDestroyed()) win.destroy();
  try { rmSync(directory, { recursive: true, force: true }); } catch {}
  app.exit(value.error ? 1 : 0);
};
writeFileSync(join(directory, 'receiver.cjs'), `
const { ipcRenderer, sharedTexture } = require('electron');
const referencePixel = ${referencePixel.toString()};
window.addEventListener('DOMContentLoaded', () => {
  if (!sharedTexture?.setSharedTextureReceiver) { ipcRenderer.send('texture-profile', { unsupported: 'sharedTexture receiver is unavailable in a sandboxed preload' }); return; }
  const canvas = document.querySelector('canvas'), ctx = canvas.getContext('2d');
  let count = 0, started = 0, times = [], pixelCheck, lastSequence = 0, previousAt = 0, gaps = [];
  sharedTexture.setSharedTextureReceiver(async ({ importedSharedTexture }, sequence) => {
    let frame;
    try {
      const begin = performance.now(); frame = importedSharedTexture.getVideoFrame();
      if (sequence <= lastSequence) return;
      lastSequence = sequence;
      ctx.drawImage(frame, 0, 0); times.push(performance.now() - begin);
      if (!started) started = performance.now(); count++;
      const at = performance.now(); if (previousAt) gaps.push(at - previousAt); previousAt = at;
      if (count === 120) {
        const pixels = ctx.getImageData(0, 0, 1920, 128).data;
        let differentChannels = 0, maxError = 0;
        for (let y = 0; y < 128; y++) for (let x = 0; x < 1920; x++) {
          const expected = referencePixel(x, y), i = (y * 1920 + x) * 4;
          for (let k = 0; k < 4; k++) { const error = Math.abs(expected[k] - pixels[i+k]); if (error) differentChannels++; maxError = Math.max(maxError, error); }
        }
        pixelCheck = { pixels: 1920 * 128, differentChannels, maxError, codedWidth: frame.codedWidth, codedHeight: frame.codedHeight, colorSpace: frame.colorSpace.toJSON() };
      }
      ipcRenderer.send('texture-drawn', { count, elapsed: performance.now() - started, drawMs: times.at(-1), pixelCheck, gapP95: [...gaps].sort((a,b)=>a-b)[Math.floor(gaps.length*.95)] });
    } catch (error) { ipcRenderer.send('texture-profile', { error: String(error) }); }
    finally { frame?.close(); importedSharedTexture.release(); }
  });
  ipcRenderer.send('texture-ready');
});`);
writeFileSync(join(directory, 'receiver.html'), '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><style>body{margin:0}</style><canvas width="1920" height="1080"></canvas>');
writeFileSync(join(directory, 'source.html'), `<!doctype html><style>html,body{margin:0;overflow:hidden;background:black}canvas{width:100vw;height:100vh}</style><canvas width="1920" height="1080"></canvas><script>
const canvas=document.querySelector('canvas'),ctx=canvas.getContext('2d');let n=0;
const referencePixel=${referencePixel.toString()}, band=ctx.createImageData(1920,128);
for(let y=0;y<128;y++)for(let x=0;x<1920;x++)band.data.set(referencePixel(x,y),(y*1920+x)*4);
function draw(){n++;ctx.fillStyle='#1266dd';ctx.fillRect(0,0,1920,1080);ctx.putImageData(band,0,0);ctx.fillStyle='#e68a25';ctx.fillRect((n*13)%1600+100,180,200,700);requestAnimationFrame(draw)}draw();
</script>`);
app.whenReady().then(async () => {
  app.dock?.hide();
  if (!sharedTexture?.importSharedTexture) { finish({ supported: false, reason: 'Main sharedTexture API unavailable' }); return; }
  const maxInFlight = 2;
  let captured = 0, delivered = 0, skipped = 0, inFlight = 0, lastDraw, transferTimes = [], firstAt = 0;
  ipcMain.on('texture-profile', (_event, result) => finish(result.unsupported ? { supported: false, reason: result.unsupported, electron: process.versions.electron } : result));
  ipcMain.on('texture-drawn', (_event, report) => { lastDraw = report; });
  ipcMain.once('texture-ready', async () => {
    source = new BrowserWindow({ width: 1920, height: 1080, useContentSize: true, show: false,
      webPreferences: { offscreen: { useSharedTexture: true }, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    source.webContents.setAudioMuted(true); source.webContents.setFrameRate(60);
    source.webContents.on('paint', async (event) => {
      const texture = event.texture;
      if (!texture) return;
      captured++; if (!firstAt) firstAt = performance.now();
      if (inFlight >= maxInFlight || finished) { skipped++; texture.release(); return; }
      inFlight++; let imported;
      const began = performance.now();
      try {
        imported = sharedTexture.importSharedTexture({ textureInfo: texture.textureInfo, allReferencesReleased: () => texture.release() });
        await sharedTexture.sendSharedTexture({ frame: output.webContents.mainFrame, importedSharedTexture: imported }, captured);
        transferTimes.push(performance.now() - began); delivered++;
      } catch (error) { if (!imported) texture.release(); finish({ error: String(error), captured, delivered }); }
      finally { imported?.release(); inFlight--; }
    });
    await source.loadFile(join(directory, 'source.html'));
    setTimeout(() => {
      try {
        assert.ok(delivered > 10 && lastDraw?.count > 10, 'Frames must reach the receiver');
        assert.ok(lastDraw.pixelCheck, 'Pixel precision check must run');
        assert.equal(lastDraw.pixelCheck.codedWidth, 1920); assert.equal(lastDraw.pixelCheck.codedHeight, 1080);
        assert.equal(lastDraw.pixelCheck.maxError, 0, 'SDR pixels must survive transfer exactly');
        const elapsed = performance.now() - firstAt, sorted = transferTimes.sort((a,b)=>a-b);
        finish({ supported: true, mode: 'sandboxed Electron GPU texture → VideoFrame → Canvas; silent synthetic animation', platform: process.platform, electron: process.versions.electron, gpu: app.getGPUFeatureStatus(), resolution: [1920,1080], targetFps: 60, maxInFlight, captured, delivered, droppedWhileBusy: skipped, elapsedMs: Math.round(elapsed), receivedFps: +((lastDraw.count - 1) / (lastDraw.elapsed / 1000)).toFixed(2), gapP95Ms: lastDraw.gapP95, transferMs: { median: +sorted[Math.floor(sorted.length/2)].toFixed(3), p95: +sorted[Math.floor(sorted.length*.95)].toFixed(3) }, lastDrawMs: lastDraw.drawMs, pixelCheck: lastDraw.pixelCheck, limitations: 'Opaque 8-bit SDR sRGB on this Mac only. Not YouTube decode, HDR, Windows or physical projector latency. One precision readback is included in timing. Texture lifetime and production integration remain.' });
      } catch (error) { finish({ error: String(error), captured, delivered, lastDraw }); }
    }, 6500);
  });
  output = new BrowserWindow({ width: 1920, height: 1080, show: false,
    webPreferences: { preload: join(directory, 'receiver.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  output.webContents.setAudioMuted(true);
  output.webContents.on('preload-error', (_event, _path, error) => finish({ error: String(error) }));
  await output.loadFile(join(directory, 'receiver.html'));
  watchdog = setTimeout(() => finish({ error: 'GPU texture probe timed out', captured, delivered }), 15000);
}).catch(error => finish({ error: String(error) }));
app.on('window-all-closed', () => {});
