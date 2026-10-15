import type { Command } from './domain.js';
export interface ChatMessage { id: string; role: 'user' | 'assistant' | 'error'; text: string; status?: 'complete' | 'incomplete' | 'cancelled' }
export interface ChatState { ready: boolean; busy: boolean; configurationError: string | null; progress: string | null; messages: ChatMessage[] }
export interface ChatBridge {
  getState(): Promise<ChatState>;
  reconnect?(): Promise<ChatState | null>;
  send(prompt: string): Promise<void>;
  cancel(): Promise<void>;
  clear(): Promise<void>;
  subscribe(listener: (state: ChatState) => void): () => void;
}
export type ChatRequest = { id: string; action: 'state' | 'send' | 'cancel' | 'clear'; prompt?: string };
export type CanvasRpc = { id: string; operation: 'snapshot' } | { id: string; operation: 'dispatch'; command: Command };
export const CHAT_MESSAGE_LIMIT = 8000;
/** Transport guard only. The imported SDK tools remain the source of orchestration. */
export const CHAT_COMMAND_TYPES = ['timer.create', 'timer.action', 'timer.remove', 'timer.attach',
  'content.create', 'content.update', 'content.action', 'content.attach', 'content.remove', 'grid.set', 'youtube.backlight', 'youtube.backlight.configure'] as const;
export function isChatCommand(value: unknown): value is Command {
  if (!value || typeof value !== 'object') return false;
  return (CHAT_COMMAND_TYPES as readonly unknown[]).includes((value as { type?: unknown }).type);
}
