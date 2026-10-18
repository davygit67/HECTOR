import { solveProjector } from './shared/projectorFit';
self.onmessage = ({data}) => { try { self.postMessage({fit:solveProjector(data.session,data.room)}); } catch(error) { self.postMessage({error:error instanceof Error?error.message:String(error)}); } };
