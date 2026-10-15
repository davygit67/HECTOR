// Optional network check. Paused/muted by default; --play-muted exercises motion
// in an isolated profile with the native audio gate held muted throughout.
const { app, ipcMain, BrowserWindow } = require('electron');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const assert = require('node:assert/strict');
app.setPath('userData', mkdtempSync(join(tmpdir(), 'projection-youtube-ready-')));
let sources, assets;
const timeout = setTimeout(()=>{console.error('YouTube ready check timed out');app.exit(1)},35000);
app.whenReady().then(async()=>{
  app.dock?.hide();
  const { MediaSources } = await import('../dist-electron/electron/media-sources.js');
  const { startStaticPreview } = await import('../dist-electron/host/static-preview.js');
  const { initialScene, reduceScene } = await import('../dist-electron/src/shared/domain.js');
  assets=await startStaticPreview(resolve('dist'));
  const events=[];
  sources=new MediaSources(assets.origin,resolve('electron/source-preload.cjs'),e=>events.push(e));
  ipcMain.on('media:source-state',(e,value)=>sources.report(e.sender,e.senderFrame===e.sender.mainFrame,value));
  const videoId=process.argv.find(a=>a.startsWith('--video='))?.slice(8)||'M7lc1UVf-VE';
  const scene=reduceScene(initialScene(),{type:'content.create',id:'paused-youtube',surfaceId:'wall',title:'Paused YouTube check',spec:{kind:'youtube',config:{videoId,startSeconds:0,backlight:true}}});
  sources.sync(scene);
  await new Promise((resolve,reject)=>{
    const timer=setInterval(()=>{
      const latest=sources.snapshot().find(e=>e.type==='state')?.state;
      if(latest?.ready){clearInterval(timer);resolve()}
      else if(latest && !latest.status.startsWith('Loading')){clearInterval(timer);reject(new Error(latest.status))}
    },100);
  });
  await new Promise(r=>setTimeout(r,2500));
  const state=sources.snapshot().find(e=>e.type==='state').state;
  assert.equal(state.playing,false);assert.equal(state.hasPlayed,false);assert.equal(state.muted,true);
  assert.equal(BrowserWindow.getAllWindows()[0].webContents.isAudioMuted(),true);
  assert.ok(events.some(e=>e.type==='frame' && e.frame.jpeg.length>1000));
  const win=BrowserWindow.getAllWindows()[0];
  const dimensions=await win.webContents.executeJavaScript('JSON.stringify(document.querySelector("#movie_player").getBoundingClientRect().toJSON())');
  if(process.argv.includes('--play-muted')){
    sources.command({contentId:'paused-youtube',action:'play'});
    await new Promise(r=>setTimeout(r,6000));
    const playing=sources.snapshot().find(e=>e.type==='state').state;
    assert.equal(playing.playing,true);assert.equal(playing.muted,true);assert.ok(playing.currentTime>2);
    assert.equal(win.webContents.isAudioMuted(),true);
    const frame=sources.snapshot().find(e=>e.type==='frame').frame;
    assert.ok(frame.sample.colors.length>0);
    sources.command({contentId:'paused-youtube',action:'pause'});
    await new Promise(r=>setTimeout(r,500));assert.equal(sources.snapshot().find(e=>e.type==='state').state.playing,false);
    console.log(JSON.stringify({passed:true,videoId,title:win.getTitle(),mutedMotion:true,currentTime:playing.currentTime,colors:frame.sample.colors.length,sourceDimensions:JSON.parse(dimensions),frames:events.filter(e=>e.type==='frame').length}));
  }else console.log(JSON.stringify({passed:true,ready:state.ready,playing:state.playing,muted:state.muted,posterFrames:events.filter(e=>e.type==='frame').length,noPlayCommandIssued:true,sourceDimensions:JSON.parse(dimensions)}));
}).catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{clearTimeout(timeout);sources?.dispose();assets?.close();app.exit(process.exitCode||0)});
