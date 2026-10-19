import { ObjectTracker } from './shared/objectTracking';
let tracker:ObjectTracker|null=null;
self.onmessage=({data})=>{try { if(data.init)tracker=new ObjectTracker(data.init.room,data.init.fit,data.init.surface,data.init.region,data.init.seed); if(!tracker)throw new Error('Select an object first.');if(data.settings)tracker.configure(data.settings); self.postMessage({observation:tracker.update(data.frame,data.now),settingsRevision:data.settingsRevision}); }catch(e){tracker=null;self.postMessage({error:e instanceof Error?e.message:String(e)});} };
