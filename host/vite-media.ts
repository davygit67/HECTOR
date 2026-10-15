import type { Plugin, WebSocketClient } from 'vite';
import { MediaWorkerClient } from './media-worker-client';
import { validateMediaCommand, validateMediaInput } from '../src/shared/media';
import { readScene, type Scene } from '../src/shared/domain';

/** Reuse Vite's authenticated local socket; no public capture, control or media proxy. */
type Worker = Pick<MediaWorkerClient, 'running' | 'request' | 'close'>;
export function projectionMedia(makeWorker: (...args: ConstructorParameters<typeof MediaWorkerClient>) => Worker = (...args) => new MediaWorkerClient(...args)): Plugin {
  return { name: 'projection-local-media', apply: 'serve', configureServer(server) {
    type Client = { client: WebSocketClient; role: 'studio' | 'output'; origin: string };
    type Room = { worker: Worker; clients: Set<Client>; timeout?: ReturnType<typeof setTimeout>; scene?: Scene };
    const origins = new WeakMap<WebSocketClient['socket'], string>(), clients = new Map<WebSocketClient['socket'], Client>(), rooms = new Map<string, Room>();
    const stop = (socket: WebSocketClient['socket']) => {
      const client = clients.get(socket); if (!client) return; clients.delete(socket);
      const room = rooms.get(client.origin); if (!room) return; room.clients.delete(client);
      if (!room.clients.size) room.timeout = setTimeout(() => { room.worker.close(); rooms.delete(client.origin); }, 30000);
    };
    server.ws.on('connection', (socket, request) => {
      try {
        const origin = new URL(request.headers.origin ?? ''), remote = request.socket.remoteAddress ?? '';
        if (origin.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(origin.hostname) && Number(origin.port) === server.config.server.port && ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(remote)) origins.set(socket, origin.origin);
      } catch {}
      socket.once('close', () => stop(socket));
    });
    const generations = new Map<string, number>();
    const startWorker = (origin: string, members: Set<Client>) => {
      const generation = (generations.get(origin) ?? 0) + 1; generations.set(origin, generation);
      return makeWorker(server.config.root, new URL(origin).hostname.replace(/[^a-z0-9]/gi,'_'), event => {
        if (generations.get(origin) !== generation) return;
        for (const peer of members) if (event.type !== 'frame' || peer.client.socket.bufferedAmount < 2_000_000) peer.client.send('pm:media-event', event);
      }, message => { if (generations.get(origin) === generation) for (const peer of members) peer.client.send('pm:media-error', { message }); });
    };
    server.ws.on('pm:media-ready', (data, client) => {
      const origin = origins.get(client.socket); if (!origin || !['studio','output'].includes(data?.role) || clients.has(client.socket)) return;
      let room = rooms.get(origin);
      if (!room) {
        const members = new Set<Client>();
        try { room = { worker: startWorker(origin, members), clients: members }; rooms.set(origin, room); }
        catch { client.send('pm:media-error', {message:'The local video renderer could not start. Check the app installation, then Restart video renderer.'}); return; }
      }
      clearTimeout(room.timeout); const entry: Client = { client, role: data.role, origin }; room.clients.add(entry); clients.set(client.socket, entry);
    });
    server.ws.on('pm:media-request', async (data, client) => {
      if (typeof data?.id !== 'string' || data.id.length > 100) return;
      const entry = clients.get(client.socket), room = entry && rooms.get(entry.origin);
      const reply = (value?: unknown, error?: string) => client.send('pm:media-response', { id: data.id, value, error });
      if (!entry || !room) { reply(undefined, 'Reconnect the local video renderer.'); return; }
      try {
        if (data.action === 'command' && data.value?.action === 'restart-renderer') {
          if (entry.role !== 'studio') throw new Error('Use video controls in the studio.');
          validateMediaCommand(data.value);
          if (data.scene !== undefined) room.scene = readScene(data.scene);
          if (!room.scene?.contents.some(c => c.id === data.value.contentId && c.kind === 'youtube')) throw new Error('That video is no longer in the room.');
          const old = room.worker; room.worker = startWorker(entry.origin, room.clients); old.close();
          await room.worker.request('sync', room.scene); reply(); return;
        }
        if (!room.worker.running) {
          room.worker = startWorker(entry.origin, room.clients);
          if (room.scene) await room.worker.request('sync', room.scene);
        }
        if (data.action === 'snapshot') { reply(await room.worker.request('snapshot')); return; }
        if (entry.role !== 'studio') throw new Error('Use video controls in the studio.');
        if (data.action === 'sync') room.scene = readScene(data.value);
        else if (data.action === 'command') validateMediaCommand(data.value);
        else if (data.action === 'input') validateMediaInput(data.value);
        else throw new Error('Unknown video operation.');
        reply(await room.worker.request(data.action, data.value));
      } catch (error) { reply(undefined, error instanceof Error ? error.message : 'Video operation failed.'); }
    });
    server.httpServer?.once('close', () => { generations.clear(); for (const room of rooms.values()) { clearTimeout(room.timeout); room.worker.close(); } rooms.clear(); });
  } };
}
