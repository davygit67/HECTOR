import { readFile, stat } from 'node:fs/promises';
import { decodeSensorSession, SENSOR_LIMITS, type SensorSession } from '../../src/shared/sensor.js';
import { syntheticFrame } from '../../src/shared/syntheticSensor.js';
import type { SourceFactory } from './types.js';

export const demoSource: SourceFactory = sink => {
  let sequence = 0;
  sink.status('streaming', 'Demo sensor — generated RGB and depth; no Kinect measurements.');
  const send = () => sink.frame(syntheticFrame(sequence++, Date.now()));
  send(); const timer = setInterval(send, 100);
  return { stop: () => clearInterval(timer) };
};

export async function readRecording(path: string): Promise<SensorSession> {
  const file = await stat(path);
  if (!file.isFile() || file.size > SENSOR_LIMITS.maxSessionBytes + 4 * SENSOR_LIMITS.maxHeaderBytes) throw new Error('Recording exceeds the sensor session size limit.');
  return decodeSensorSession(await readFile(path));
}

/** One pass, original timestamps, no clock rebasing or synthetic relabeling. */
export function replaySource(session: SensorSession, speed = 1): SourceFactory {
  if (!Number.isFinite(speed) || speed < .25 || speed > 4) throw new Error('Replay speed must be between 0.25 and 4.');
  if (session.frames.some(f => f.device.id !== session.frames[0].device.id)) throw new Error('Bridge replay requires a recording from one sensor.');
  return sink => {
    let index = 0, stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const start = performance.now(), firstTime = session.frames[0].capturedAtMs;
    sink.status('streaming', 'Recorded session — view only, original capture timestamps preserved.');
    const heartbeat = setInterval(() => sink.status('streaming', 'Recorded session — waiting for its next recorded frame.'), 2000);
    const send = () => {
      if (stopped) return;
      sink.frame(session.frames[index++]);
      if (index === session.frames.length) { clearInterval(heartbeat); sink.status('ended', 'Replay finished. Reconnect to play the recording again.'); return; }
      const due = (session.frames[index].capturedAtMs - firstTime) / speed - (performance.now() - start);
      // setTimeout has a signed 32-bit ceiling. Long gaps are checked in bounded increments.
      const wait = () => {
        const remaining = (session.frames[index].capturedAtMs - firstTime) / speed - (performance.now() - start);
        timer = setTimeout(remaining > 1000 ? wait : send, Math.max(0, Math.min(1000, remaining)));
      };
      if (due > 1000) wait(); else timer = setTimeout(send, Math.max(0, due));
    };
    // Ensure the connection handshake has been sent before the first frame.
    timer = setTimeout(send, 0);
    return { stop: () => { stopped = true; clearTimeout(timer); clearInterval(heartbeat); } };
  };
}
