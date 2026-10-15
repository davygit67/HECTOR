/// <reference types="vite/client" />
import { reportMediaError } from './nativeMedia';
import { mediaSourceKey } from './shared/renderKeys';
import { bridge } from './bridge';
import type { MediaBridge, MediaEvent } from './shared/media';

// The live site uses the same local native renderer while retaining its browser room.
if (import.meta.hot && !window.projectionMedia && !window.projectionSource) {
  const hot = import.meta.hot, role = new URLSearchParams(location.search).get('view') === 'output' ? 'output' : 'studio';
  const listeners = new Set<(event: MediaEvent) => void>();
  const pending = new Map<string, { resolve(value: any): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  let connected = true, publishedKey: string | null = null;
  function decode(event: any): MediaEvent {
    return event.type === 'frame' ? { ...event, frame: { ...event.frame, jpeg: Uint8Array.from(atob(event.frame.jpeg), c => c.charCodeAt(0)) } } : event;
  }
  const request = (action: string, value?: unknown, scene?: unknown): Promise<any> => new Promise((resolve, reject) => {
    if (!connected) { reject(new Error('Local video renderer disconnected. Reload the studio.')); return; }
    const id = crypto.randomUUID(), timer = setTimeout(() => { pending.delete(id); reject(new Error('Video renderer did not reply. Reload the studio.')); }, 25000);
    pending.set(id,{resolve,reject,timer}); hot.send('pm:media-request',{id,action,value,...(scene ? {scene} : {})});
  });
  const response = (data: any) => { const item = pending.get(data.id); if (!item) return; clearTimeout(item.timer); pending.delete(data.id); if (data.error) item.reject(new Error(data.error)); else item.resolve(data.value); };
  const event = (data: any) => { const value = decode(data); for (const listener of listeners) listener(value); };
  const failure = ({ message }: { message: string }) => {
    reportMediaError(message);
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error(message)); } pending.clear();
  };
  const publish = async () => { if (role === 'studio') {
    const snapshot = await bridge.getSnapshot(), key = mediaSourceKey(snapshot.scene);
    if (publishedKey === key) return; publishedKey = key;
    try { await request('sync', snapshot.scene); } catch (error) { if (publishedKey === key) publishedKey = null; throw error; }
  } };
  const connect = () => { connected = true; publishedKey = null; hot.send('pm:media-ready',{role}); void publish().catch(error => failure({message:error.message})); };
  const disconnect = () => { connected = false; failure({message:'Local video renderer disconnected. Reload the studio.'}); };
  hot.on('pm:media-response',response); hot.on('pm:media-event',event); hot.on('pm:media-error',failure);
  hot.on('vite:ws:connect',connect); hot.on('vite:ws:disconnect',disconnect);
  window.projectionMedia = {
    subscribe: fn => {listeners.add(fn);return()=>{listeners.delete(fn)}},
    snapshot: async()=> (await request('snapshot')).map(decode),
    command: async value => {
      if (value.action !== 'restart-renderer') return request('command',value);
      hot.send('pm:media-ready',{role});
      const {scene} = await bridge.getSnapshot();
      // Supply the scene directly: never wait for the stalled process before restarting it.
      await request('command',value,scene); publishedKey = mediaSourceKey(scene);
    }, input: value=>request('input',value),
  } satisfies MediaBridge;
  const unsubscribe = bridge.subscribe(()=>{void publish().catch(error=>failure({message:error.message}))});
  connect();
  hot.dispose(()=>{ unsubscribe(); disconnect(); delete window.projectionMedia;
    hot.off('pm:media-response',response);hot.off('pm:media-event',event);hot.off('pm:media-error',failure);hot.off('vite:ws:connect',connect);hot.off('vite:ws:disconnect',disconnect);
  });
}
