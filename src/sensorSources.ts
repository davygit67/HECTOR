import { decodeSensorFrame, SENSOR_LIMITS } from './shared/sensor';
import { localSensorURL, SensorInbox } from './shared/sensorStream';
import { syntheticFrame } from './shared/syntheticSensor';
import type { CalibrationPattern } from './shared/calibrationPatterns';
import { parseSensorBridgeStatus, type SensorBridgeStatus } from './shared/sensorBridge';

export interface SensorSource { stop(): void }
export function demoSensor(inbox: SensorInbox, pattern: () => CalibrationPattern | null): SensorSource {
  let sequence = 0;
  const emit = () => inbox.push(syntheticFrame(sequence++, Date.now(), pattern()));
  emit(); const timer = setInterval(emit, 100);
  return { stop: () => { clearInterval(timer); inbox.reset(); } };
}
export type LocalSensorMode = SensorBridgeStatus['mode'];
export type LocalSensorState = 'connecting' | 'connected' | 'waiting' | 'ended' | 'error';
export interface LocalSensorOptions {
  createSocket?: (url: string) => WebSocket;
  firstFrameTimeoutMs?: number; staleFrameMs?: number; heartbeatTimeoutMs?: number; healthIntervalMs?: number;
}
/** No silent retry: a new connection is an explicit new acquisition boundary. */
export function localSensor(inbox: SensorInbox, address: string, onStatus: (status: LocalSensorState, message: string, mode: LocalSensorMode) => void, options: LocalSensorOptions = {}): SensorSource {
  const socket = (options.createSocket ?? (url => new WebSocket(url)))(localSensorURL(address)); socket.binaryType = 'arraybuffer';
  let stopped = false, connected = false, mode: LocalSensorMode | null = null, announced = false;
  let phase: SensorBridgeStatus['state'] = 'starting', phaseAt = Date.now(), lastTraffic = phaseAt, lastFrame = phaseAt;
  onStatus('connecting', 'Waiting for the local sensor helper…', 'live');
  const end = (status: 'error' | 'ended', message: string) => {
    if (stopped) return; stopped = true; clearInterval(health); socket.close(); inbox.reset(message); onStatus(status, message, mode ?? 'live');
  };
  const fail = (message: string) => end('error', message);
  const invalidate = (message: string) => { connected = false; inbox.reset(message); };
  const health = setInterval(() => {
    const now = Date.now();
    if (announced && now - lastTraffic > (options.heartbeatTimeoutMs ?? 15000)) fail('The sensor helper stopped responding. Restart the helper, then reconnect.');
    else if (connected && mode !== 'replay' && now - lastFrame > (options.staleFrameMs ?? 5000)) fail('The sensor stopped sending frames. Check its power and USB connection, then reconnect.');
    else if (!connected && phase !== 'waiting' && now - phaseAt > (options.firstFrameTimeoutMs ?? 6000)) fail('No sensor frames received. Start the Kinect helper on this computer, then reconnect.');
  }, options.healthIntervalMs ?? 1000);
  socket.onmessage = event => {
    if (stopped) return;
    try {
      if (typeof event.data === 'string') {
        const status = parseSensorBridgeStatus(event.data);
        if (mode && status.mode !== mode) throw new Error('The helper changed source mode. Reconnect before using the new source.');
        mode = status.mode; announced = true; lastTraffic = Date.now();
        if (phase !== status.state) { phaseAt = lastTraffic; phase = status.state; }
        if (phase === 'error') { fail(status.message || 'The sensor helper reported a problem.'); return; }
        if (phase === 'ended') { end('ended', status.message || 'Recording finished. Reconnect to replay it again.'); return; }
        if (phase === 'waiting' || phase === 'starting') {
          if (connected || inbox.latest) invalidate(status.message || 'Waiting for sensor frames.');
          onStatus(phase === 'waiting' ? 'waiting' : 'connecting', status.message || 'Waiting for sensor frames…', mode);
        } else onStatus(connected ? 'connected' : 'connecting', status.message || 'Waiting for the first frame…', mode);
        return;
      }
      if (!(event.data instanceof ArrayBuffer) || event.data.byteLength > SENSOR_LIMITS.maxFrameBytes + SENSOR_LIMITS.maxHeaderBytes) throw new Error('The local bridge must send bounded PMF1 binary RGB/depth frames.');
      const frame = decodeSensorFrame(new Uint8Array(event.data));
      mode ??= 'live';
      if (mode === 'live' && frame.device.kind === 'synthetic') throw new Error('The helper must label generated frames as demo data, not live sensor measurements.');
      if (mode === 'demo' && frame.device.kind !== 'synthetic') throw new Error('Demo mode requires generated frames. Reconnect to use a live sensor.');
      if (announced && phase !== 'streaming') throw new Error('The sensor sent frames without announcing that it is streaming.');
      inbox.push(frame);
      lastTraffic = lastFrame = Date.now();
      if (!connected) { connected = true; onStatus('connected', frame.device.label, mode); }
    } catch (error) { fail(error instanceof Error ? error.message : String(error)); }
  };
  socket.onerror = () => fail('Cannot reach the local sensor helper. Start it on this computer, then reconnect.');
  socket.onclose = () => fail('Local sensor helper disconnected. Restart it, then reconnect.');
  return { stop: () => { stopped = true; clearInterval(health); socket.close(); inbox.reset(); } };
}
