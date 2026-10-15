// Isolated normal-browser adapter test. Intercepts HTTPS in a temporary Electron
// session; the source sees /watch, but all pixels/media are generated locally.
const { app, session, ipcMain, BrowserWindow } = require('electron');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { resolve, join } = require('node:path');
const assert = require('node:assert/strict');
app.setPath('userData', mkdtempSync(join(tmpdir(), 'projection-watch-check-')));
app.on('window-all-closed', () => {});
let sources;
const timeout = setTimeout(() => { console.error('Watch source check timed out'); app.exit(1); }, 45000);
const fixture = `<!doctype html><style>body{margin:0;background:#ff00ff}h1{position:fixed;top:0;left:0;margin:0;width:100vw;height:100px;background:#ff00ff;z-index:9999}#movie_player{position:absolute;left:40px;top:100px;width:960px;height:540px;background:black}video{width:100%;height:100%}button{position:absolute;left:40%;top:45%}</style>
<h1>Private page furniture must never be projected</h1><div id="movie_player" class="html5-video-player"><video muted playsinline></video><button>Play / pause</button></div>
<script>const c=document.createElement('canvas');c.width=1920;c.height=1080;const ctx=c.getContext('2d'),v=document.querySelector('video');let t=0;
function draw(){ctx.fillStyle='#000';ctx.fillRect(0,0,1920,1080);ctx.fillStyle='#0066ff';ctx.fillRect(0,120,960,840);ctx.fillStyle='#ff5500';ctx.fillRect(960,120,960,840);ctx.fillStyle='#00dd55';ctx.fillRect(200+(++t%300),500,80,100);requestAnimationFrame(draw)}draw();v.srcObject=c.captureStream(30);v.play().catch(()=>{});
document.querySelector('button').onclick=()=>v.paused?v.play():v.pause();
</script>`;
function waitFor(predicate, message='Expected source event missing') {
  return new Promise((resolve,reject)=>{const began=Date.now();const timer=setInterval(()=>{try{const result=predicate();if(result){clearInterval(timer);resolve(result)}else if(Date.now()-began>12000){clearInterval(timer);reject(new Error(message))}}catch(e){clearInterval(timer);reject(e)}},40)});
}
app.whenReady().then(async()=>{
  const { MediaSources } = await import('../dist-electron/electron/media-sources.js');
  const { initialScene, reduceScene } = await import('../dist-electron/src/shared/domain.js');
  session.fromPartition('persist:projection-media').protocol.handle('https', request => new Response(new URL(request.url).hostname === 'accounts.google.com' ? '<h1>Private sign-in page</h1>' : fixture, {headers:{'Content-Type':'text/html'}}));
  const events=[]; let canProcess=true;
  sources=new MediaSources('http://unused.invalid',resolve('electron/source-preload.cjs'),e=>events.push(e),{canProcessFrame:()=>canProcess});
  ipcMain.on('media:source-state',(e,v)=>sources.report(e.sender,e.senderFrame===e.sender.mainFrame,v));
  const scene=reduceScene(initialScene(),{type:'content.create',id:'watch-fixture',surfaceId:'wall',title:'Watch fixture',spec:{kind:'youtube',config:{videoId:'M7lc1UVf-VE',startSeconds:0,backlight:true}}});
  const command=action=>sources.command({contentId:'watch-fixture',action});
  const state=()=>sources.snapshot().find(e=>e.type==='state')?.state;
  sources.sync(scene);
  await waitFor(()=>state()?.ready && events.some(e=>e.type==='frame'), 'Watch fixture did not become ready');
  const win=BrowserWindow.getAllWindows()[0];
  assert.equal(state().source,'youtube-watch');assert.equal(state().playing,false);assert.equal(state().hasPlayed,false);assert.equal(state().muted,true);assert.equal(win.webContents.isAudioMuted(),true);
  assert.match(win.webContents.getURL(),/youtube\.com\/watch\?/);
  assert.equal(await win.webContents.executeJavaScript('document.querySelector("video").paused'),true);
  assert.equal(await win.webContents.executeJavaScript('typeof window.projectionSource + ":" + typeof window.projectionDesktop + ":" + typeof window.require'),'undefined:undefined:undefined');
  command('play');await waitFor(()=>state()?.playing);
  await waitFor(()=>events.some(e=>e.type==='frame' && e.frame.sample.picture.top>.08));
  const frame=sources.snapshot().find(e=>e.type==='frame').frame;
  assert.ok(frame.sample.colors.some(c=>c.x<.4 && c.color[2]>c.color[0]+100));
  assert.ok(frame.sample.colors.some(c=>c.x>.6 && c.color[0]>c.color[2]+100));
  assert.equal(frame.width,1920);assert.equal(frame.height,1080);
  command('pause');await waitFor(()=>!state().playing);assert.equal(win.webContents.isAudioMuted(),true);
  const generation=state().generation;
  command('open-source');assert.equal(win.isVisible(),true);assert.equal(state().sourceBrowserOpen,true);
  await new Promise(r=>setTimeout(r,700));
  assert.equal(await win.webContents.executeJavaScript('Math.round(document.querySelector("#movie_player").getBoundingClientRect().width)'),960);
  // Native close returns to the same source, retaining playback and alignment.
  win.close();await waitFor(()=>!win.isVisible() && !state().sourceBrowserOpen);
  assert.equal(state().generation,generation);
  await waitFor(()=>sources.snapshot().some(e=>e.type==='frame' && e.frame.sequence>frame.sequence));
  canProcess=false;await new Promise(r=>setTimeout(r,300));const seq=sources.snapshot().find(e=>e.type==='frame').frame.sequence;
  await new Promise(r=>setTimeout(r,500));assert.equal(sources.snapshot().find(e=>e.type==='frame').frame.sequence,seq);canProcess=true;
  command('open-source');
  await win.webContents.loadURL('https://accounts.google.com/signin');
  await waitFor(()=>!state().ready && /sign-in/.test(state().status));
  assert.equal(sources.snapshot().some(e=>e.type==='frame'),false,'Account page is never captured');
  assert.equal(win.webContents.isAudioMuted(),true);
  command('close-source');await waitFor(()=>state().ready);
  assert.equal(state().playing,false);assert.equal(state().muted,true);
  command('retry');assert.equal(win.isDestroyed(),true);assert.equal(state().playing,false);assert.equal(state().muted,true);
  await waitFor(()=>state().ready && sources.snapshot().some(e=>e.type==='frame'), 'Reloaded watch source did not produce a frame');
  sources.dispose();assert.equal(BrowserWindow.getAllWindows().length,0);
  console.log(JSON.stringify({passed:true,normalWatchUrl:true,pausedAndMutedStartup:true,noRemoteBridge:true,matchingPictureAndColors:true,blackBarsDetected:true,sourceWindowAndReturn:true,backpressure:true,accountPageNeverProjected:true,retryCleanup:true}));
}).catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{clearTimeout(timeout);sources?.dispose();app.exit(process.exitCode||0)});
