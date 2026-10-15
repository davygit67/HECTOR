// Actual offscreen capture + processing cadence; no user scene or remote media.
// Run after build. This excludes IPC transport, receiver decode and display.
const { app, ipcMain } = require('electron');
const { createServer } = require('node:http');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const directory = mkdtempSync(join(tmpdir(), 'mapper-bitmap-profile-'));
app.setPath('userData', directory);
app.on('window-all-closed', () => {});
let sources, server;
const timeout = setTimeout(() => { console.error('Bitmap profile timed out'); app.exit(1); }, 30000);
const fixture = `<!doctype html><style>html,body{margin:0;overflow:hidden;background:black}canvas{width:100vw;height:100vh}</style><canvas width="1920" height="1080"></canvas><script>
const ctx=document.querySelector('canvas').getContext('2d'), image=ctx.createImageData(1920,1080);let random=1337,n=0;
for(let y=0;y<1080;y++)for(let x=0;x<1920;x++){
  random=(Math.imul(random,1664525)+1013904223)>>>0;
  const i=(y*1920+x)*4,matte=y<120||y>=960;
  image.data[i]=matte?0:((x+y)/3000*180+(random>>>16&31))|0;
  image.data[i+1]=matte?0:(y/1080*190+(random>>>8&31))|0;
  image.data[i+2]=matte?0:(x/1920*170+(random&31))|0;image.data[i+3]=255;
}
function draw(){ctx.putImageData(image,0,0);ctx.fillStyle='#e68a25';ctx.fillRect((++n*13)%1600+100,180,200,700);requestAnimationFrame(draw)}draw();
function report(){window.projectionSource.report({ready:true,playing:true,hasPlayed:true,status:'Silent fixture',currentTime:0,duration:0})}report();setInterval(report,750);
</script>`;
const percentile = (values, fraction) => [...values].sort((a,b)=>a-b)[Math.floor(values.length*fraction)];
app.whenReady().then(async () => {
  app.dock?.hide();
  const { MediaSources } = await import('../dist-electron/electron/media-sources.js');
  const { initialScene, reduceScene } = await import('../dist-electron/src/shared/domain.js');
  ipcMain.on('media:source-state', (event, value) => sources?.report(event.sender, event.senderFrame===event.sender.mainFrame, value));
  server=createServer((_req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end(fixture)});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const scene=reduceScene(initialScene(),{type:'content.create',id:'fixture',title:'Silent fixture',surfaceId:'wall',spec:{kind:'youtube',config:{videoId:'M7lc1UVf-VE',startSeconds:0,backlight:true}}});
  const results=[];
  for(const targetFps of [30,60]){
    const timings=[];
    sources=new MediaSources('http://127.0.0.1:'+server.address().port,resolve('electron/source-preload.cjs'),()=>{}, {sourceMode:'embedded-fixture',targetFps,onFrameTiming:(_id,timing)=>timings.push({...timing,at:performance.now()})});
    sources.sync(scene);await new Promise(resolve=>setTimeout(resolve,7500));sources.dispose();sources=undefined;
    const frames=timings.filter(t=>t.at>=timings[0].at+1000),gaps=frames.slice(1).map((t,i)=>t.at-frames[i].at);
    if(frames.length<30)throw new Error('Too few processed frames');
    results.push({targetFps,frames:frames.length,processedFps:+((frames.length-1)*1000/(frames.at(-1).at-frames[0].at)).toFixed(2),gapP95Ms:+percentile(gaps,.95).toFixed(3),processingMedianMs:+percentile(frames.map(t=>t.totalMs),.5).toFixed(3),processingP95Ms:+percentile(frames.map(t=>t.totalMs),.95).toFixed(3),analyzed:frames.filter(t=>t.analyzed).length});
  }
  console.log(JSON.stringify({kind:'Synthetic offscreen bitmap capture + processing, first second excluded; no receiver/network/display',platform:process.platform,electron:process.versions.electron,resolution:[1920,1080],results},null,2));
}).catch(error=>{console.error(error);process.exitCode=1}).finally(()=>{
  clearTimeout(timeout);sources?.dispose();server?.close();try{rmSync(directory,{recursive:true,force:true})}catch{};app.exit(process.exitCode||0);
});
