import { scanMappingFrame } from './shared/objectTracking';
self.onmessage=({data})=>{try{self.postMessage({scan:scanMappingFrame(data.frame,data.room,data.surface,data.fit,data.settings,data.selectedCenter)});}catch(e){self.postMessage({error:e instanceof Error?e.message:String(e)});}};
