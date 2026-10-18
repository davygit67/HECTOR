import { ObjectTracker } from './shared/objectTracking';
let tracker:ObjectTracker|null=null;
self.onmessage=({data})=>{try { if(data.init)tracker=new ObjectTracker(data.init.room,data.init.fit,data.init.surface,data.init.region,data.init.seed); if(!tracker)throw new Error('Select an object first.'); self.postMessage({observation:tracker.update(data.frame,data.now)}); }catch(e){tracker=null;self.postMessage({error:e instanceof Error?e.message:String(e)});} };
