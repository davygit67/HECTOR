/// <reference types="vite/client" />
import { bridge } from './bridge';
import { LOCAL_HOST_STOPPED, recoverBrowserChat } from './chatRecovery';
import { isChatCommand, type CanvasRpc, type ChatBridge, type ChatRequest, type ChatState } from './shared/chat';

declare global { interface Window { projectionChat?: ChatBridge } }
function browserChat(): ChatBridge {
  const hot = import.meta.hot;
  const listeners = new Set<(state: ChatState) => void>();
  const pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  const isStudio = new URLSearchParams(location.search).get('view') !== 'output';
  let connected = !!hot && isStudio;
  const emit = (state: ChatState) => listeners.forEach(listener => listener(structuredClone(state)));
  const request = <T,>(action: ChatRequest['action'], prompt?: string): Promise<T> => {
    if (!hot || !isStudio) return Promise.reject(new Error('Open the local studio at http://127.0.0.1:5173/ or use the desktop app to chat.'));
    if (!connected) return Promise.reject(new Error(LOCAL_HOST_STOPPED));
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => { pending.delete(id); hot.send('pm:chat-request', { id: crypto.randomUUID(), action: 'cancel' });
        reject(new Error('The local host did not reply. Check the canvas before trying again.')); }, action === 'send' ? 135000 : 15000);
      pending.set(id, { resolve: value => resolve(value as T), reject, timer });
      hot.send('pm:chat-request', { id, action, prompt });
    });
  };
  const response = (data: { id: string; value?: unknown; error?: string }) => {
    const item = pending.get(data.id); if (!item) return;
    clearTimeout(item.timer); pending.delete(data.id);
    if (data.error) item.reject(new Error(data.error)); else item.resolve(data.value);
  };
  const rpc = async (data: CanvasRpc) => {
    if (!isStudio || !connected) return;
    try {
      const value = data.operation === 'snapshot' ? await bridge.getSnapshot()
        : data.operation === 'dispatch' && isChatCommand(data.command) ? await bridge.dispatch(data.command)
        : { ok: false, error: 'That operation is not available to the assistant.' };
      hot?.send('pm:canvas-reply', { id: data.id, value });
    } catch { hot?.send('pm:canvas-reply', { id: data.id, error: true }); }
  };
  const disconnect = () => {
    connected = false;
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('Studio disconnected. Changes already applied remain on the canvas.')); }
    pending.clear();
    emit({ ready: false, busy: false, configurationError: LOCAL_HOST_STOPPED, progress: null, messages: [] });
  };
  const connect = () => {
    if (!hot || !isStudio) return;
    connected = true; hot.send('pm:studio-ready', { role: 'studio' });
    request<ChatState>('state').then(emit).catch(() => { /* The mounted panel shows connection failure. */ });
  };
  const beforeReload = () => { hot?.send('pm:studio-dispose', {}); disconnect(); };
  if (hot && isStudio) {
    hot.on('pm:chat-state', emit); hot.on('pm:chat-response', response); hot.on('pm:canvas-rpc', rpc);
    hot.on('vite:ws:disconnect', disconnect); hot.on('vite:ws:connect', connect);
    hot.on('vite:beforeFullReload', beforeReload);
    hot.dispose(() => {
      hot.send('pm:studio-dispose', {}); disconnect();
      hot.off('pm:chat-state', emit); hot.off('pm:chat-response', response); hot.off('pm:canvas-rpc', rpc);
      hot.off('vite:ws:disconnect', disconnect); hot.off('vite:ws:connect', connect); hot.off('vite:beforeFullReload', beforeReload);
    });
    connect();
  }
  return { getState: () => request<ChatState>('state'),
    reconnect: () => {
      if (!hot || !isStudio) return request<ChatState>('state');
      return recoverBrowserChat(connected, {
        probe: async () => (await fetch(location.href, { cache: 'no-store', signal: AbortSignal.timeout(3000) })).ok,
        resume: () => { hot.send('pm:studio-ready', { role: 'studio' }); return request<ChatState>('state'); },
        reload: () => location.reload(),
      });
    },
    send: prompt => request<void>('send', prompt),
    cancel: () => request<void>('cancel'), clear: () => request<void>('clear'),
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; } };
}
export const chatBridge = window.projectionChat ?? browserChat();
