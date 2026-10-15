// Run with Electron after npm run build. All assets are local, silent fixtures.
const { app, ipcMain, BrowserWindow } = require('electron');
const { createServer } = require('node:http');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const assert = require('node:assert/strict');
const data = mkdtempSync(join(tmpdir(), 'projection-native-check-'));
app.setPath('userData', data);
if (process.env.PM_MEDIA_SOFTWARE === '1') app.disableHardwareAcceleration();
let sources, server, canProcess = true, processed = 0;
const timeout = setTimeout(() => { console.error('Native media check timed out'); app.exit(1); }, 30000);
const fixture = `<!doctype html><style>html,body{margin:0;background:black}canvas{width:100vw;height:100vh}</style><canvas width="1920" height="1080"></canvas><script>
const ctx=document.querySelector('canvas').getContext('2d');
let playing=false, shift=0;
function draw(){ctx.fillStyle=shift%2?'#00dd55':'#0066ff';ctx.fillRect(0,0,960,1080);ctx.fillStyle='#ff5500';ctx.fillRect(960,0,960,1080)}
function report(){window.projectionSource.report({ready:true,playing,hasPlayed:true,status:playing?'Playing fixture':'Paused fixture',currentTime:0,duration:30})}
window.projectionSource.subscribe(c=>{if(c.action==='play')playing=true;if(c.action==='pause')playing=false;report()});
document.querySelector('canvas').addEventListener('mousedown',()=>{playing=true;report()});
setInterval(()=>{if(playing){shift++;draw()}},150);draw();report();
</script>`;
function waitFor(predicate) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const timer = setInterval(() => {
      try { const result = predicate(); if (result) { clearInterval(timer); resolve(result); } else if (Date.now() - start > 12000) { clearInterval(timer); reject(new Error('Expected native event missing')); } }
      catch(e) { clearInterval(timer); reject(e); }
    }, 25);
  });
}
app.whenReady().then(async () => {
  const { MediaSources } = await import('../dist-electron/electron/media-sources.js');
  const { initialScene, reduceScene } = await import('../dist-electron/src/shared/domain.js');
  server = createServer((_req, res) => { res.writeHead(200, { 'Content-Type':'text/html' }); res.end(fixture); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const events = [];
  sources = new MediaSources('http://127.0.0.1:' + server.address().port, resolve('electron/source-preload.cjs'), event => events.push(event), { sourceMode: 'embedded-fixture', canProcessFrame: () => canProcess, onFrameTiming: () => processed++ });
  ipcMain.on('media:source-state', (event, value) => sources.report(event.sender, event.senderFrame === event.sender.mainFrame, value));
  let scene = reduceScene(initialScene(), { type:'content.create', id:'fixture', surfaceId:'wall', title:'Silent native fixture', spec:{ kind:'youtube', config:{ videoId:'M7lc1UVf-VE', startSeconds:0, backlight:true } } });
  sources.sync(scene);
  await waitFor(() => events.some(e => e.type==='state' && e.state.ready) && events.some(e => e.type==='frame' &&
    e.frame.sample.colors.some(c=>c.x<.4 && c.weight>.1 && c.color[2]>c.color[0]+100)));
  const win = BrowserWindow.getAllWindows()[0];
  assert.equal(win.webContents.getFrameRate(), 30);
  assert.equal(win.webContents.isAudioMuted(), true);
  const snapshot = sources.snapshot(), first = snapshot.find(e=>e.type==='frame').frame;
  assert.equal(first.width, 1920); assert.equal(first.height,1080); assert.ok(first.jpeg.length>1000);
  const left = first.sample.colors.filter(c=>c.x<.4 && c.weight>.1), right = first.sample.colors.filter(c=>c.x>.6 && c.weight>.1);
  assert.ok(left.some(c=>c.color[2]>c.color[0]+100)); assert.ok(right.some(c=>c.color[0]>c.color[2]+100));
  // Placement/style/view edits retain the exact source and generation.
  scene = reduceScene(scene, { type:'youtube.backlight', id:'fixture', enabled:false }); sources.sync(scene);
  assert.equal(BrowserWindow.getAllWindows()[0],win); assert.equal(sources.snapshot()[0].state.generation, first.generation);
  await waitFor(() => sources.snapshot().find(e=>e.type==='frame')?.frame.sample.colors.length === 0);
  canProcess = false;
  const processedBefore = processed;
  scene = reduceScene(scene, { type:'youtube.backlight', id:'fixture', enabled:true }); sources.sync(scene);
  await new Promise(r=>setTimeout(r,250)); assert.equal(processed,processedBefore,'Blocked sink must skip CPU processing');
  canProcess = true;
  await waitFor(() => sources.snapshot().find(e=>e.type==='frame')?.frame.sample.colors.length > 0);
  sources.input({contentId:'fixture',type:'mouseDown',x:960,y:540});
  sources.input({contentId:'fixture',type:'mouseUp',x:960,y:540});
  await waitFor(()=>events.some(e=>e.type==='state' && e.state.playing));
  await waitFor(()=>events.some(e=>e.type==='frame' && e.frame.sequence>first.sequence+1));
  assert.equal(win.webContents.isAudioMuted(),true);
  sources.command({contentId:'fixture',action:'unmute'}); assert.equal(win.webContents.isAudioMuted(),false);
  sources.command({contentId:'fixture',action:'play'}); assert.equal(win.webContents.isAudioMuted(),true);
  sources.command({contentId:'fixture',action:'retry'});
  const next = sources.snapshot()[0].state;
  assert.ok(next.generation>first.generation); assert.equal(next.muted,true); assert.equal(next.playing,false); assert.equal(win.isDestroyed(),true);
  scene = reduceScene(scene,{type:'content.remove',id:'fixture'}); sources.sync(scene);
  assert.deepEqual(sources.snapshot(),[]); assert.equal(BrowserWindow.getAllWindows().length,0);
  console.log(JSON.stringify({passed:true,sourceResolution:[first.width,first.height],targetFps:30,frames:events.filter(e=>e.type==='frame').length,matchingBlueOrangeColors:true,pointerForwarding:true,mutedBeforeLoad:true,explicitUnmuteOnly:true,sourceRetainedAcrossStyleChange:true,pausedAnalysisDemandRefresh:true,blockedSinkSkipsProcessing:true,retryAndRemovalCleanedUp:true}));
}).catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{
  clearTimeout(timeout); sources?.dispose(); server?.close(); app.exit(process.exitCode||0);
  try {rmSync(data,{recursive:true,force:true})}catch{}
});
