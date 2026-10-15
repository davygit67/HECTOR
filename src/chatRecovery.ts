import type { ChatState } from './shared/chat';

export const LOCAL_HOST_STOPPED = 'The local studio server is stopped or unreachable. Double-click Launch Preview.command in the project folder, then click Reconnect. Your saved canvas stays on this Mac.';

/** A dead HMR socket cannot be repaired by sending another request through it. */
export async function recoverBrowserChat(connected: boolean, operations: {
  probe(): Promise<boolean>;
  resume(): Promise<ChatState>;
  reload(): void;
}): Promise<ChatState | null> {
  if (connected) return operations.resume();
  let reachable = false;
  try { reachable = await operations.probe(); } catch { /* A stopped server must not navigate to an error page. */ }
  if (!reachable) throw new Error(LOCAL_HOST_STOPPED);
  operations.reload(); // Acquire the restarted server's new WebSocket token; never replay a prompt.
  return null;
}
