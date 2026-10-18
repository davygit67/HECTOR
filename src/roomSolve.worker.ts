import { solveRoomSurfaces } from './shared/roomSolve';
import type { SensorSession } from './shared/sensor';
self.onmessage = ({ data }: MessageEvent<SensorSession>) => {
  try { self.postMessage({ result: solveRoomSurfaces(data) }); }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
};
