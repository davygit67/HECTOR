import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';
import { encodeSensorFrame } from '../../src/shared/sensor.js';
import { SensorInbox } from '../../src/shared/sensorStream.js';
import { validateSensorBridgeStatus, type SensorBridgeStatus } from '../../src/shared/sensorBridge.js';
import type { Mode, Source, SourceFactory } from './types.js';

const DEFAULT_ORIGINS = ['http://127.0.0.1:5173', 'http://localhost:5173', 'http://[::1]:5173'];
export function allowedOrigin(origin: string | undefined, allowed = DEFAULT_ORIGINS) {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    return ['http:', 'https:'].includes(url.protocol) && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && url.origin === origin && allowed.includes(origin);
  } catch { return false; }
}
export function permittedRequest(request: IncomingMessage, port: number, allowed?: string[]) {
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress ?? '') &&
    [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`].includes(request.headers.host ?? '') &&
    request.url === '/' && allowedOrigin(request.headers.origin, allowed);
}

export async function startBridge(options: { mode: Mode; source: SourceFactory; port?: number; origins?: string[]; onStatus?: (s: SensorBridgeStatus) => void }) {
  let state: SensorBridgeStatus = { protocol: 'pm-sensor', version: 1, type: 'status', mode: options.mode, state: 'starting', message: 'Starting sensor helper…' };
  const inbox = new SensorInbox();
  const http = createServer((_req, response) => { response.writeHead(404); response.end(); });
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 1024, perMessageDeflate: false });
  let source: Source | undefined, stopped = false;
  const busy = new WeakSet<WebSocket>();
  let skippedFrames = 0, sentFrames = 0;
  function status(next: SensorBridgeStatus['state'], message: string) {
    state = { ...state, state: next, message: message.slice(0, 500) }; validateSensorBridgeStatus(state);
    if (next !== 'streaming') inbox.reset(message);
    for (const socket of sockets.clients) if (socket.readyState === WebSocket.OPEN) {
      // A stalled client must not accumulate status messages behind a blocked frame.
      if (socket.bufferedAmount > 14 * 1024 * 1024) socket.terminate();
      else socket.send(JSON.stringify(state));
    }
    options.onStatus?.(state);
  }
  const start = () => {
    if (source || stopped) return;
    let sourceFailed = false;
    const fail = (error: unknown) => {
      if (sourceFailed || stopped) return; sourceFailed = true;
      status('error', `Sensor source failed: ${error instanceof Error ? error.message : String(error)}`);
      source?.stop();
    };
    try { source = options.source({ status, frame: frame => {
      if (stopped || state.state !== 'streaming') return;
      try {
      if (options.mode === 'demo' && frame.device.kind !== 'synthetic' || options.mode === 'live' && frame.device.kind === 'synthetic') throw new Error('Sensor source kind does not match its mode.');
      inbox.push(frame); const packet = encodeSensorFrame(frame);
      for (const socket of sockets.clients) {
        if (socket.readyState !== WebSocket.OPEN) continue;
        if (busy.has(socket) || socket.bufferedAmount !== 0) { skippedFrames++; continue; }
        busy.add(socket); socket.send(packet, { binary: true }, error => { busy.delete(socket); if (error) socket.terminate(); }); sentFrames++;
      }
      } catch (error) { fail(error); }
    } });
      if (sourceFailed) source.stop();
    } catch (error) { fail(error); }
  };
  http.on('upgrade', (request, socket, head) => {
    if (!permittedRequest(request, (http.address() as AddressInfo).port, options.origins) || sockets.clients.size >= 4) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
    }
    sockets.handleUpgrade(request, socket, head, ws => sockets.emit('connection', ws));
  });
  sockets.on('connection', socket => {
    socket.on('error', () => socket.terminate());
    socket.on('message', () => socket.close(1008, 'Sensor helper is a read-only stream.'));
    socket.send(JSON.stringify(state));
    socket.on('close', () => {
      if (sockets.clients.size === 0 && options.mode === 'replay') {
        source?.stop(); source = undefined; inbox.reset();
        state = { ...state, state: 'starting', message: 'Reconnect to start the recorded session.' };
      }
    });
    start();
  });
  await new Promise<void>((resolve, reject) => { http.once('error', reject); http.listen(options.port ?? 5174, '127.0.0.1', () => { http.off('error', reject); resolve(); }); });
  // Live helper is initialized even before the browser connects; replay starts on connection.
  if (options.mode !== 'replay') start();
  return {
    port: (http.address() as AddressInfo).port,
    get status() { return state; },
    get stats() { return { sentFrames, skippedFrames }; },
    async stop() {
      if (stopped) return; stopped = true; source?.stop();
      for (const socket of sockets.clients) socket.terminate();
      await new Promise<void>(resolve => sockets.close(() => resolve()));
      await new Promise<void>(resolve => http.close(() => resolve()));
    },
  };
}
