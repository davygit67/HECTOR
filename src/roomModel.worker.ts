import { aggregateRoom, type RoomSample } from './shared/roomModel';
self.onmessage = ({ data }: MessageEvent<{ samples: RoomSample[]; id: string }>) => {
  try { self.postMessage({ reference: aggregateRoom(data.samples, data.id) }); }
  catch (e) { self.postMessage({ error: e instanceof Error ? e.message : String(e) }); }
};
