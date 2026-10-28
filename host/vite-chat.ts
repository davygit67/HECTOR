import type { Plugin, WebSocketClient } from 'vite';
import { createChatController, localAgentFactory } from './chat-controller';
import { createCanvasRpc } from './canvas-rpc';
import type { CommandReceipt, Snapshot } from '../src/shared/bridge';
import type { ChatRequest } from '../src/shared/chat';
import type { StudioSnapshot, StudioResult, StudioObservation } from '../src/shared/studio';
import type { MappingObservation } from '../src/shared/mappingWorkshop';
import { createCloudReceiver, localCloudReceiverLoader } from './cloud-receiver';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

/** Dev-only, private HMR messages. Keys and the SDK stay in the Node process. */
export function projectionChat(): Plugin {
  return {
    name: 'projection-local-chat', apply: 'serve',
    configureServer(server) {
      const origins = new WeakMap<WebSocketClient['socket'], string>();
      type Connection = { controller: ReturnType<typeof createChatController>; rpc: ReturnType<typeof createCanvasRpc>; origin: string; id:string; releaseCloud:()=>void };
      const sessions = new Map<WebSocketClient['socket'], Connection>();
      const busyOrigins = new Map<string, Connection>();
      const factory = localAgentFactory(server.config.root);
      const cloud = createCloudReceiver(localCloudReceiverLoader(server.config.root), join(server.config.root, '.local-data'));
      const stop = (socket: WebSocketClient['socket']) => {
        const session = sessions.get(socket); if (!session) return;
        session.releaseCloud();
        session.controller.dispose(); session.rpc.close(); sessions.delete(socket);
        if (busyOrigins.get(session.origin) === session) busyOrigins.delete(session.origin);
      };
      server.ws.on('connection', (socket, request) => {
        // Keep Vite's own WebSocket token/host checks and add a loopback origin boundary.
        try {
          const origin = new URL(request.headers.origin ?? '');
          const remote = request.socket.remoteAddress ?? '';
          if (origin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)
            && Number(origin.port || 80) === server.config.server.port
            && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) origins.set(socket, origin.origin);
        } catch { /* Non-studio connections cannot request chat. */ }
        socket.once('close', () => stop(socket));
      });
      server.ws.on('pm:studio-ready', (data: { role?: string }, client) => {
        const origin = origins.get(client.socket);
        if (!origin || data?.role !== 'studio' || sessions.has(client.socket)) return;
        let controller: ReturnType<typeof createChatController>;
        const rpc = createCanvasRpc(request => client.send('pm:canvas-rpc', request), 10000, () => controller?.cancel());
        controller = createChatController({
          getSnapshot: () => rpc.request<Snapshot>({ operation: 'snapshot' }),
          dispatch: command => rpc.request<CommandReceipt>({ operation: 'dispatch', command }),
          studio: {
            inspect: () => rpc.request<StudioSnapshot>({ operation: 'studio.inspect' }),
            execute: request => rpc.request<StudioResult>({ operation: 'studio.execute', request }),
            observe: request => rpc.request<StudioObservation>({ operation: 'studio.observe', request }),
            observeMapping: request => rpc.request<MappingObservation>({ operation:'studio.observeMapping',request }),
          },
        }, factory, state => client.send('pm:chat-state', state));
        const session:Connection = { controller, rpc, origin, id:randomUUID(), releaseCloud:()=>{} };
        session.releaseCloud = cloud.register(session.id, {
          ready:()=>controller.currentState().ready && !controller.currentState().busy && !busyOrigins.has(origin),
          deliver:async prompt=>{
            if(busyOrigins.has(origin))throw new Error('A request is already running in this room.');
            busyOrigins.set(origin, session);
            try{return await controller.send(prompt, 'cloud');}
            finally{if(busyOrigins.get(origin)===session)busyOrigins.delete(origin);}
          },
          cancel:()=>controller.cancel(),
        });
        sessions.set(client.socket, session);
      });
      server.ws.on('pm:canvas-reply', (data, client) => sessions.get(client.socket)?.rpc.receive(data));
      server.ws.on('pm:studio-dispose', (_data, client) => stop(client.socket));
      server.ws.on('pm:chat-request', async (data: ChatRequest, client) => {
        if (!data || typeof data.id !== 'string' || data.id.length > 100) return;
        const session = sessions.get(client.socket);
        const reply = (value?: unknown, error?: string) => client.send('pm:chat-response', { id: data.id, value, error });
        if (!session) { reply(undefined, 'Reconnect the local studio to use chat.'); return; }
        try {
          if (data.action === 'state') reply(await session.controller.getState());
          else if (data.action === 'relay' && data.relay) reply(await cloud.request(session.id, data.relay));
          else if (data.action === 'memory' && data.memory) reply(await session.controller.memory(data.memory));
          else if (data.action === 'cancel') { session.controller.cancel(); reply(); }
          else if (data.action === 'clear') { session.controller.clear(); reply(); }
          else if (data.action === 'send') {
            if (busyOrigins.has(session.origin)) throw new Error('An assistant request is already running in this room. Wait or stop it in its tab.');
            busyOrigins.set(session.origin, session);
            try { await session.controller.send(data.prompt as string); reply(); }
            finally { if (busyOrigins.get(session.origin) === session) busyOrigins.delete(session.origin); }
          } else reply(undefined, 'Unknown chat action.');
        } catch (error) { reply(undefined, error instanceof Error ? error.message : 'Chat request failed.'); }
      });
      server.httpServer?.once('close', () => { for (const socket of sessions.keys()) stop(socket); void cloud.dispose(); });
    },
  };
}
