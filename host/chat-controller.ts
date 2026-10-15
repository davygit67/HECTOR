import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Bridge } from '../src/shared/bridge.js';
import { CHAT_MESSAGE_LIMIT, type ChatState } from '../src/shared/chat.js';

export interface AgentSession {
  send(prompt: string, options?: { onEvent?: (event: { type: string; toolName: string }) => void }): Promise<{ text: string; status: 'complete' | 'incomplete' }>;
  cancel(): void; clear(): void; readonly busy: boolean;
}
export type AgentFactory = (canvas: Pick<Bridge, 'getSnapshot' | 'dispatch'>) => Promise<AgentSession>;
export function localAgentFactory(root: string): AgentFactory {
  return async canvas => {
    const bundle = join(root, 'agent/dist/index.js');
    if (!existsSync(bundle)) throw new Error('Build the agent package with npm --prefix agent run build, then reconnect.');
    let env: NodeJS.ProcessEnv;
    try { env = { ...(existsSync(join(root, 'agent/.env')) ? parseEnv(readFileSync(join(root, 'agent/.env'), 'utf8')) : {}), ...process.env }; }
    catch { throw new Error('Check the local settings file at agent/.env, then reconnect.'); }
    if (!env.OPENAI_API_KEY?.trim() || env.OPENAI_API_KEY.trim() === 'replace-me') throw new Error('Set OPENAI_API_KEY in agent/.env, then reconnect. Keep your key out of chat.');
    const module = await import(pathToFileURL(bundle).href);
    try { return module.createProjectionAgentFromEnv(canvas, env) as AgentSession; }
    catch { throw new Error('Check the model and request settings in agent/.env, then reconnect.'); }
  };
}

/** Owns one conversation, never a scene store. Both hosts bind to the existing scene port. */
export function createChatController(canvas: Pick<Bridge, 'getSnapshot' | 'dispatch'>, factory: AgentFactory, emit: (state: ChatState) => void) {
  let agent: AgentSession | undefined, loading: Promise<AgentSession> | undefined, disposed = false, generation = 0, cancelled = false;
  const state: ChatState = { ready: false, busy: false, configurationError: null, progress: null, messages: [] };
  const snapshot = () => structuredClone(state);
  const broadcast = () => { if (!disposed) emit(snapshot()); };
  const trim = () => { if (state.messages.length > 40) state.messages.splice(0, state.messages.length - 40); };
  const guardedCanvas: Pick<Bridge, 'getSnapshot' | 'dispatch'> = {
    getSnapshot: () => {
      if (disposed || cancelled) return Promise.reject(new Error('Request stopped.'));
      return canvas.getSnapshot();
    },
    dispatch: command => {
      // A lost receipt cancels this turn. Even an SDK continuation cannot issue another edit.
      if (disposed || cancelled || !state.busy) return Promise.reject(new Error('Request stopped.'));
      return canvas.dispatch(command);
    },
  };
  async function ensure() {
    if (disposed) throw new Error('This conversation is disconnected.');
    if (agent) return agent;
    if (!loading) loading = factory(guardedCanvas).then(a => {
      if (disposed) { a.cancel(); throw new Error('This conversation is disconnected.'); }
      agent = a; state.ready = true; state.configurationError = null; return a;
    }).catch(error => {
      state.ready = false;
      // Only setup errors are surfaced here; never forward SDK/provider objects or credentials.
      const message = error instanceof Error ? error.message : '';
      state.configurationError = /^(Set OPENAI_API_KEY|Build the agent package|Check the (local settings file|model and request settings))/.test(message)
        ? message : 'The local AI host could not start. Check agent/.env and rebuild the agent package.';
      throw new Error(state.configurationError);
    }).finally(() => { loading = undefined; broadcast(); });
    return loading;
  }
  return {
    async getState() { try { await ensure(); } catch { /* State explains setup failure. */ } return snapshot(); },
    async send(prompt: string) {
      if (disposed) throw new Error('This conversation is disconnected.');
      if (state.busy) throw new Error('A request is already running.');
      if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > CHAT_MESSAGE_LIMIT) throw new Error('Use a message between 1 and 8000 characters.');
      cancelled = false; state.busy = true; state.progress = 'Thinking…'; const turn = ++generation;
      state.messages.push({ id: randomUUID(), role: 'user', text: prompt.trim() }); trim(); broadcast();
      try {
        const session = await ensure();
        if (turn !== generation || disposed) throw new Error('Cancelled');
        const result = await session.send(prompt, { onEvent: event => {
          if (turn !== generation || disposed) return;
          state.progress = event.type === 'tool-start'
            ? event.toolName === 'search_youtube' ? 'Finding YouTube videos…'
              : event.toolName === 'display_youtube' ? 'Placing the video…'
              : 'Working: ' + event.toolName.replaceAll('_', ' ')
            : 'Preparing reply…'; broadcast();
        } });
        if (turn !== generation) throw new Error('Cancelled');
        if (!disposed) state.messages.push({ id: randomUUID(), role: 'assistant', text: result.text, status: result.status });
      } catch (error) {
        if (!disposed) {
          const cancelled = turn !== generation || (error as { code?: string })?.code === 'cancelled';
          state.messages.push({ id: randomUUID(), role: 'error', status: cancelled ? 'cancelled' : 'incomplete',
            text: state.configurationError ?? (cancelled ? 'Request stopped. Changes already applied remain on the canvas.' : 'The request failed. Check your connection and model settings. Changes already applied remain on the canvas.') });
        }
      } finally { state.busy = false; state.progress = null; trim(); broadcast(); }
    },
    cancel() { if (state.busy) { generation++; cancelled = true; agent?.cancel(); state.progress = 'Stopping…'; broadcast(); } },
    clear() {
      if (state.busy) throw new Error('Stop the current request before clearing the conversation.');
      agent?.clear(); state.messages = []; broadcast();
    },
    dispose() { disposed = true; generation++; agent?.cancel(); },
  };
}
