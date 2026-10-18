import { parseRoomScan } from './shared/roomScan';
self.onmessage = ({ data }: MessageEvent<ArrayBuffer>) => {
  try { const scan = parseRoomScan(data); self.postMessage({ scan }, { transfer: [scan.positions.buffer, scan.colors.buffer] }); }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
};
