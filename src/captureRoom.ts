import { ROOM_SAMPLE_COUNT, sampleRoomFrame, type RoomReference, type RoomSample } from './shared/roomModel';
import { checkAbort, type SensorInbox } from './shared/sensorStream';

export async function captureRoomReference(inbox: SensorInbox, signal: AbortSignal, progress: (frames: number) => void): Promise<RoomReference> {
  const generation = inbox.generation, samples: RoomSample[] = [];
  for (let i = 0; i < ROOM_SAMPLE_COUNT; i++) {
    checkAbort(signal);
    const entry = await inbox.waitAfter(Date.now() + 180, signal, 3500);
    if (inbox.generation !== generation) throw new Error('Connection changed during room capture. Saved room retained; retry when the sensor is stable.');
    if (entry.frame.clockUncertaintyMs > 500) throw new Error('Sensor timing is too uncertain for a stable room capture. Restart the helper.');
    samples.push(sampleRoomFrame(entry.frame)); progress(samples.length);
  }
  return new Promise((resolve, reject) => {
    checkAbort(signal);
    const worker = new Worker(new URL('./roomModel.worker.ts', import.meta.url), { type: 'module' });
    const finish = () => { clearTimeout(timer); worker.terminate(); signal.removeEventListener('abort', abort); };
    const abort = () => { finish(); reject(new Error('Room capture cancelled. Previous reference retained.')); };
    const timer = setTimeout(() => { finish(); reject(new Error('Room aggregation timed out. Previous reference retained.')); }, 15000);
    signal.addEventListener('abort', abort, { once: true });
    worker.onmessage = ({ data }) => { finish(); if (data.error) reject(new Error(data.error)); else resolve(data.reference); };
    worker.onerror = () => { finish(); reject(new Error('Room aggregation could not run. Reload Studio and retry.')); };
    worker.postMessage({ samples, id: crypto.randomUUID() });
  });
}
