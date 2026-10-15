import { randomUUID } from 'node:crypto';
import type { CanvasRpc } from '../src/shared/chat.js';

/** One broker per studio connection. Receipts are never replayed after a lost connection. */
export function createCanvasRpc(send: (request: CanvasRpc) => void, timeoutMs = 10000, onFault: () => void = () => {}) {
  const pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  let closed = false;
  return {
    request<T>(operation: Omit<Extract<CanvasRpc, { operation: 'snapshot' }>, 'id'> | Omit<Extract<CanvasRpc, { operation: 'dispatch' }>, 'id'>): Promise<T> {
      if (closed) return Promise.reject(new Error('Studio disconnected.'));
      return new Promise((resolve, reject) => {
        const id = randomUUID();
        const timer = setTimeout(() => { pending.delete(id); onFault(); reject(new Error('Studio did not acknowledge the request. Its changes may already be applied.')); }, timeoutMs);
        pending.set(id, { resolve: value => resolve(value as T), reject, timer });
        try { send({ ...operation, id }); } catch { clearTimeout(timer); pending.delete(id); onFault(); reject(new Error('Studio disconnected.')); }
      });
    },
    receive(reply: { id?: unknown; value?: unknown; error?: unknown }) {
      if (typeof reply?.id !== 'string') return;
      const item = pending.get(reply.id); if (!item) return;
      clearTimeout(item.timer); pending.delete(reply.id);
      if (reply.error) { onFault(); item.reject(new Error('Studio could not complete the request.')); } else item.resolve(reply.value);
    },
    close() {
      closed = true;
      for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('Studio disconnected.')); }
      pending.clear();
    },
  };
}
