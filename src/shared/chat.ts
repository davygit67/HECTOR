import type { Command } from './domain.js';
import type { MemoryRequest, MemoryState, StudioRpc } from './studio.js';
import type { CloudRelayAction, CloudRelayState } from './cloudRelay.js';
export interface ChatMessage { id: string; role: 'user' | 'assistant' | 'error'; text: string; source?: 'cloud'; status?: 'complete' | 'incomplete' | 'cancelled' }
export interface ChatOutcome { status: 'complete' | 'incomplete' | 'cancelled'; text: string }
export interface ChatState { ready: boolean; busy: boolean; configurationError: string | null; progress: string | null; messages: ChatMessage[] }
export interface ChatBridge {
  getState(): Promise<ChatState>;
  reconnect?(): Promise<ChatState | null>;
  send(prompt: string): Promise<void>;
  cancel(): Promise<void>;
  clear(): Promise<void>;
  memory?(request: MemoryRequest): Promise<MemoryState>;
  relay?(action: CloudRelayAction): Promise<CloudRelayState>;
  subscribe(listener: (state: ChatState) => void): () => void;
}
export type ChatRequest = { id: string; action: 'state' | 'send' | 'cancel' | 'clear' | 'memory' | 'relay'; prompt?: string; memory?: MemoryRequest; relay?: CloudRelayAction };
export type CanvasRpc = { id: string; operation: 'snapshot' } | { id: string; operation: 'dispatch'; command: Command } | ({ id: string } & StudioRpc);
export const CHAT_MESSAGE_LIMIT = 8000;
/** Transport guard only. The imported SDK tools remain the source of orchestration. */
export const CHAT_COMMAND_TYPES = ['timer.create', 'timer.action', 'timer.remove', 'timer.attach',
  'content.create', 'content.update', 'content.action', 'content.attach', 'content.remove', 'grid.set', 'youtube.backlight', 'youtube.backlight.configure',
  'timer.select', 'timer.update', 'timer.move', 'content.select', 'content.move', 'media.seek', 'layer.configure', 'layer.reorder', 'display.configure',
  'calibration.set', 'calibration.reset', 'manual.target', 'surface.select', 'surface.fill', 'surface.move', 'surface.demo-exclusion', 'projector.update', 'viewer.update', 'output.view'] as const;
export function isChatCommand(value: unknown): value is Command {
  if (!value || typeof value !== 'object') return false;
  return (CHAT_COMMAND_TYPES as readonly unknown[]).includes((value as { type?: unknown }).type);
}
