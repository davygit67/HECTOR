import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { decodeSensorFrame } from '../../src/shared/sensor.js';
import { parseSensorBridgeStatus } from '../../src/shared/sensorBridge.js';
import { PacketReader } from './protocol.js';
import type { SourceFactory } from './types.js';

export function nativeSource(executable: string, options: { platform?: string; retryMs?: number; watchdogMs?: number; launch?: () => ChildProcessWithoutNullStreams } = {}): SourceFactory {
  return sink => {
    let stopped = false, child: ChildProcessWithoutNullStreams | undefined, restart: ReturnType<typeof setTimeout> | undefined;
    let lastMessage = Date.now(), lastFrame = Date.now(), streaming = false;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let retire: ((message: string) => void) | undefined;
    let forceKill: ReturnType<typeof setTimeout> | undefined;
    const unsupported = (options.platform ?? process.platform) !== 'win32';
    if (!options.launch && (unsupported || !existsSync(executable))) {
      const message = unsupported ? 'Live Kinect capture requires Windows x64 and Kinect SDK 2.0. Demo and replay work on this computer.' : 'Native Kinect helper is not built. Run sensor-helper/scripts/Build-Kinect.ps1 after installing Kinect SDK 2.0.';
      sink.status('error', message);
      heartbeat = setInterval(() => sink.status('error', message), 2000);
      return { stop: () => clearInterval(heartbeat) };
    }
    const launch = () => {
      if (stopped) return;
      streaming = false; lastMessage = lastFrame = Date.now();
      sink.status('waiting', 'Starting Kinect SDK. Waiting for a connected sensor…');
      const current = (options.launch ?? (() => spawn(executable, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })))();
      child = current; let failed = false;
      const fail = (message: string) => {
        if (failed || stopped || child !== current) return;
        failed = true; streaming = false; sink.status('waiting', message); current.kill();
        forceKill = setTimeout(() => { if (child === current) current.kill('SIGKILL'); }, 1000);
      };
      retire = fail;
      const packets = new PacketReader(bytes => {
        if (stopped || failed || child !== current) return;
        // Native statuses share stdout packet framing, so their order relative to frames is reliable.
        if (bytes.subarray(0, 4).toString('ascii') !== 'PMF1') {
          const status = parseSensorBridgeStatus(bytes.toString('utf8'));
          if (status.mode !== 'live') throw new Error('Unexpected native source mode.');
          lastMessage = Date.now();
          if (streaming && status.state !== 'streaming') { fail(status.message); return; }
          if (status.state !== 'streaming' || streaming) {
            streaming = status.state === 'streaming'; sink.status(status.state, status.message);
          }
          return;
        }
        const frame = decodeSensorFrame(bytes);
        if (frame.device.kind !== 'kinect-v2') throw new Error('Native helper did not identify a Kinect v2.');
        // A real decoded frame, not a native status by itself, promotes the source to streaming.
        if (!streaming) { streaming = true; sink.status('streaming', 'Kinect v2 RGB and depth connected. Optical timing and registration still require hardware validation.'); }
        sink.frame(frame); lastFrame = lastMessage = Date.now();
      });
      current.stdout.on('data', (chunk: Buffer) => { try { packets.push(chunk); } catch (error) { fail(`Invalid Kinect frame: ${String(error)}`); } });
      current.stderr.setEncoding('utf8');
      current.stderr.on('data', (chunk: string) => {
        if (stopped || failed || child !== current) return;
        fail(`Kinect runtime error: ${chunk.slice(0, 400).replace(/[\u0000-\u001f]/g, ' ')}`);
      });
      current.on('error', error => fail(`Kinect helper could not start: ${error.message}`));
      current.on('close', () => {
        if (stopped || child !== current) return;
        child = undefined; streaming = false; retire = undefined; clearTimeout(forceKill);
        sink.status('waiting', 'Kinect helper stopped. Reconnecting…');
        restart = setTimeout(launch, options.retryMs ?? 2000);
      });
    };
    launch();
    heartbeat = setInterval(() => {
      if (stopped) return;
      const now = Date.now(), limit = options.watchdogMs ?? 3000;
      if (child && (now - lastMessage > limit || streaming && now - lastFrame > limit)) {
        retire?.('Kinect stopped responding. Restarting the capture helper…');
      } else if (!streaming) sink.status('waiting', 'Waiting for Kinect. Check its powered adapter and USB 3 connection.');
    }, Math.min(1000, Math.max(20, (options.watchdogMs ?? 3000) / 2)));
    return { stop: () => { stopped = true; clearInterval(heartbeat); clearTimeout(restart); clearTimeout(forceKill); child?.kill('SIGKILL'); child = undefined; } };
  };
}
