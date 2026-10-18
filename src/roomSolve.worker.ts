import { solveRoomSurfaces } from './shared/roomSolve';
import type { SensorSession } from './shared/sensor';
import type { RoomReference } from './shared/roomModel';
self.onmessage = ({ data }: MessageEvent<{ session: SensorSession; room?: RoomReference }>) => {
  try { self.postMessage({ result: solveRoomSurfaces(data.session, data.room) }); }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
};
