import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Bridge } from '../src/shared/bridge.js';
import { CHAT_MESSAGE_LIMIT, type ChatState, type ChatOutcome } from '../src/shared/chat.js';
import type { AgentMemory, MemoryRequest, StudioPort } from '../src/shared/studio.js';
export type AgentCanvas = Pick<Bridge, 'getSnapshot' | 'dispatch'> & { studio?: StudioPort };

export interface AgentSession {
  send(prompt: string, options?: { onEvent?: (event: { type: string; toolName: string }) => void }): Promise<{ text: string; status: 'complete' | 'incomplete' }>;
  cancel(): void; clear(): void; readonly busy: boolean;
  memory?: AgentMemory;
}
export type AgentFactory = (canvas: AgentCanvas) => Promise<AgentSession>;
export function localAgentEnvironment(root:string): NodeJS.ProcessEnv {
  try { return { ...(existsSync(join(root, 'agent/.env')) ? parseEnv(readFileSync(join(root, 'agent/.env'), 'utf8')) : {}), ...process.env }; }
  catch { throw new Error('Check the local settings file at agent/.env, then reconnect.'); }
}
export function localAgentFactory(root: string, privateDirectory = join(root, '.local-data')): AgentFactory {
  return async canvas => {
    const bundle = join(root, 'agent/dist/index.js');
    if (!existsSync(bundle)) throw new Error('Build the agent package with npm --prefix agent run build, then reconnect.');
    const env = localAgentEnvironment(root);
    if (!env.OPENAI_API_KEY?.trim() || env.OPENAI_API_KEY.trim() === 'replace-me') throw new Error('Set OPENAI_API_KEY in agent/.env, then reconnect. Keep your key out of chat.');
    // New conversations pick up a completed agent build without restarting video playback.
    const module = await import(pathToFileURL(bundle).href + '?build=' + statSync(bundle).mtimeMs);
    const roomId = canvas.studio ? (await canvas.studio.inspect()).roomId : 'local-room';
    const memoryPath = join(privateDirectory, 'agent-memory', createHash('sha256').update(roomId).digest('hex').slice(0, 24) + '.json');
    try { return module.createProjectionAgentFromEnv(canvas, env, { roomId, memoryPath }) as AgentSession; }
    catch { throw new Error('Check the model and request settings in agent/.env, then reconnect.'); }
  };
}

/** Owns one conversation, never a scene store. Both hosts bind to the existing scene port. */
export function createChatController(canvas: AgentCanvas, factory: AgentFactory, emit: (state: ChatState) => void) {
  let agent: AgentSession | undefined, loading: Promise<AgentSession> | undefined, disposed = false, generation = 0, cancelled = false;
  const state: ChatState = { ready: false, busy: false, configurationError: null, progress: null, messages: [] };
  const snapshot = () => structuredClone(state);
  const broadcast = () => { if (!disposed) emit(snapshot()); };
  const trim = () => { if (state.messages.length > 40) state.messages.splice(0, state.messages.length - 40); };
  const guardedCanvas: AgentCanvas = {
    getSnapshot: () => {
      if (disposed || cancelled) return Promise.reject(new Error('Request stopped.'));
      return canvas.getSnapshot();
    },
    studio: canvas.studio && {
      inspect: () => { if (disposed || cancelled) throw new Error('Request stopped.'); return canvas.studio!.inspect(); },
      observe: request => { if (disposed || cancelled || !state.busy) throw new Error('Request stopped.'); return canvas.studio!.observe(request); },
      ...(canvas.studio.observeMapping && { observeMapping: request => { if (disposed || cancelled || !state.busy) throw new Error('Request stopped.'); return canvas.studio!.observeMapping!(request); } }),
      execute: request => { if (disposed || cancelled || !state.busy) throw new Error('Request stopped.'); return canvas.studio!.execute(request); },
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
    currentState() { return { ready: !disposed && state.ready, busy: state.busy }; },
    async getState() { try { await ensure(); } catch { /* State explains setup failure. */ } return snapshot(); },
    async send(prompt: string, source?: 'cloud'): Promise<ChatOutcome> {
      if (disposed) throw new Error('This conversation is disconnected.');
      if (state.busy) throw new Error('A request is already running.');
      if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > CHAT_MESSAGE_LIMIT) throw new Error('Use a message between 1 and 8000 characters.');
      cancelled = false; state.busy = true; state.progress = 'Thinking…'; const turn = ++generation;
      state.messages.push({ id: randomUUID(), role: 'user', text: prompt.trim(), ...(source && { source }) }); trim(); broadcast();
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
        return { status: result.status, text: result.text };
      } catch (error) {
        const stopped = disposed || turn !== generation || (error as { code?: string })?.code === 'cancelled';
        const result: ChatOutcome = { status: stopped ? 'cancelled' : 'incomplete', text: state.configurationError ?? (stopped ? 'Request stopped. Changes already applied remain on the canvas.' : 'The request failed. Check your connection and model settings. Changes already applied remain on the canvas.') };
        if (!disposed) {
          state.messages.push({ id: randomUUID(), role: 'error', ...result });
        }
        return result;
      } finally { state.busy = false; state.progress = null; trim(); broadcast(); }
    },
    cancel() { if (state.busy) { generation++; cancelled = true; agent?.cancel(); state.progress = 'Stopping…'; broadcast(); } },
    clear() {
      if (state.busy) throw new Error('Stop the current request before clearing the conversation.');
      agent?.clear(); state.messages = []; broadcast();
    },
    async memory(request: MemoryRequest) {
      if (!request || typeof request !== 'object' || JSON.stringify(request).length > 26000) throw new Error('Invalid memory request.');
      const memory = (await ensure()).memory;
      if (!memory) throw new Error('Memory is unavailable. Rebuild the agent and restart the local studio.');
      switch (request.action) {
        case 'list': break;
        case 'put': await memory.put(request.entry); break;
        case 'remove': await memory.remove(request.id); break;
        case 'clear': await memory.clear(); break;
        case 'setEnabled': await memory.setEnabled(request.enabled); break;
        case 'record':
          if (request.event?.actor !== 'user') throw new Error('Only completed manual adjustments may be recorded here.');
          await memory.record(request.event); break;
        default: throw new Error('Unknown memory action.');
      }
      return memory.list();
    },
    dispose() { disposed = true; generation++; agent?.cancel(); },
  };
}
