import type { AdjustmentEvent } from './shared/studio';
import { mergeAdjustment } from './shared/adjustments';

const listeners = new Set<(event: AdjustmentEvent) => void>();
const pending = new Map<string, { event: AdjustmentEvent; timer: ReturnType<typeof setTimeout> }>();
const output = new URLSearchParams(location.search).get('view') === 'output';
const channel = new BroadcastChannel('projection-mapper-manual-adjustments-v1');
channel.onmessage = message => {
  const event = message.data as AdjustmentEvent;
  if (!output && event?.actor === 'user' && event.roomId === roomId() && JSON.stringify(event).length <= 24000) listeners.forEach(fn => fn(event));
};
export function roomId() {
  // Desktop asset-server ports change between launches; its room identity must not.
  if (window.projection) return 'desktop-room';
  const key = 'projection-mapper.room-id';
  let id = localStorage.getItem(key);
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(key, id); }
  return id;
}
export function recordAdjustment(event: AdjustmentEvent) {
  const key = `${event.roomId}:${event.operation}:${event.targetId ?? ''}`;
  const old = pending.get(key); if (old) clearTimeout(old.timer);
  const merged = old ? mergeAdjustment(old.event, event) : event;
  pending.set(key, { event: merged, timer: setTimeout(() => { pending.delete(key); if (output) channel.postMessage(merged); else listeners.forEach(fn => fn(merged)); }, 600) });
}
export function subscribeAdjustments(listener: (event: AdjustmentEvent) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
