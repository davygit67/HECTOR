import { randomUUID } from 'node:crypto';
import { ToolLoopAgent, isStepCount, type LanguageModel, type ModelMessage, type ToolSet } from 'ai';

export interface AgentEvent {
  type: 'tool-start' | 'tool-end';
  toolName: string;
  toolCallId: string;
}

export interface TurnBinding {
  tools: ToolSet;
  instructions: () => Promise<string>;
  formatReply?: (reply: { text: string; toolNames: readonly string[] }) => string;
}

export interface SessionOptions {
  model: LanguageModel;
  bindTurn: (context: { turnId: string; signal: AbortSignal; prompt: string }) => Promise<TurnBinding>;
  maxSteps?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
  historyTurns?: number;
}

export interface TurnResult {
  text: string;
  status: 'complete' | 'incomplete';
  steps: number;
  finishReason: string;
  usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  tools: { toolName: string; toolCallId: string; output: unknown }[];
}

export class AgentTurnError extends Error {
  constructor(public readonly code: 'cancelled' | 'request_failed', message: string) {
    super(message);
    this.name = 'AgentTurnError';
  }
}

function abortable<T>(work: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => { cleanup(); reject(signal.reason); };
    const cleanup = () => signal.removeEventListener('abort', abort);
    // Attach handlers even if already aborted so late failures are still consumed.
    Promise.resolve(work).then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}

/** One conversation, one active turn. Room state always stays with the host. */
export function createAgentSession(options: SessionOptions) {
  const turns: ModelMessage[][] = [];
  const maxSteps = options.maxSteps ?? 6;
  const maxOutputTokens = options.maxOutputTokens ?? 1500;
  const timeoutMs = options.timeoutMs ?? 45000;
  const historyTurns = options.historyTurns ?? 10;
  for (const [name, value, max] of [
    ['maxSteps', maxSteps, 20], ['maxOutputTokens', maxOutputTokens, 16000],
    ['timeoutMs', timeoutMs, 120000], ['historyTurns', historyTurns, 30],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new Error(`Invalid ${name}.`);
  }
  let active: AbortController | undefined;

  return {
    get busy() { return active !== undefined; },
    cancel() { active?.abort(); },
    clear() {
      if (active) throw new Error('Cancel and await the current request before clearing the conversation.');
      turns.length = 0;
    },
    async send(prompt: string, settings: { signal?: AbortSignal; onEvent?: (event: AgentEvent) => void } = {}): Promise<TurnResult> {
      if (active) throw new Error('An agent request is already running.');
      if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 8000) {
        throw new Error('Use a message between 1 and 8000 characters.');
      }
      active = new AbortController();
      const signal = AbortSignal.any([active.signal, AbortSignal.timeout(timeoutMs), ...(settings.signal ? [settings.signal] : [])]);
      const user: ModelMessage = { role: 'user', content: prompt.trim() };
      const completed: ModelMessage[] = [];
      const emit = (event: AgentEvent) => {
        // UI observers cannot interrupt a tool after it has changed the room.
        try { settings.onEvent?.(event); } catch { /* Observer failure is isolated. */ }
      };
      try {
        signal.throwIfAborted();
        const binding = await abortable(options.bindTurn({ turnId: randomUUID(), signal, prompt: prompt.trim() }), signal);
        signal.throwIfAborted();
        const agent = new ToolLoopAgent({
          model: options.model,
          tools: binding.tools,
          maxOutputTokens,
          maxRetries: 1,
          stopWhen: isStepCount(maxSteps),
          providerOptions: { openai: { store: false, parallelToolCalls: false } },
          prepareStep: async () => {
            signal.throwIfAborted();
            return { instructions: await abortable(binding.instructions(), signal) };
          },
          onToolExecutionStart: ({ toolCall }) => emit({ type: 'tool-start', toolName: toolCall.toolName, toolCallId: toolCall.toolCallId }),
          onToolExecutionEnd: ({ toolCall }) => emit({ type: 'tool-end', toolName: toolCall.toolName, toolCallId: toolCall.toolCallId }),
          onStepEnd: step => { completed.push(...step.response.messages); },
        });
        const result = await abortable(agent.generate({ messages: [...turns.flat(), user], abortSignal: signal }), signal);
        const status = result.finishReason === 'stop' ? 'complete' : 'incomplete';
        const modelText = result.text || 'The request ended before a final reply. Check the action results before continuing.';
        const text = binding.formatReply?.({ text: modelText, toolNames: result.steps.flatMap(step => step.toolCalls.map(call => call.toolName)) }) ?? modelText;
        // Follow-ups must remember the same confirmed reply shown to the user, not
        // a discarded model claim. Keep tool calls/results intact for API history.
        const messages: ModelMessage[] = text === result.text ? result.responseMessages : [
          ...result.responseMessages.flatMap((message): ModelMessage[] => {
            if (message.role !== 'assistant') return [message];
            if (typeof message.content === 'string') return [];
            const content = message.content.filter(part => part.type !== 'text');
            return content.length ? [{ ...message, content }] : [];
          }),
          { role: 'assistant', content: text },
        ];
        turns.push([user, ...messages]);
        return {
          text,
          status,
          steps: result.steps.length,
          finishReason: result.finishReason,
          usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, totalTokens: result.usage.totalTokens },
          tools: result.steps.flatMap(step => step.toolResults.map(item => ({ toolName: item.toolName, toolCallId: item.toolCallId, output: item.output }))),
        };
      } catch {
        // Keep completed tool receipts when a later model request fails. Never replay the turn automatically.
        const interrupted = signal.aborted;
        turns.push([user, ...completed, { role: 'assistant', content:
          'This request was interrupted. Some actions may already have been applied. Inspect the current room before continuing; do not repeat completed actions.' }]);
        throw new AgentTurnError(interrupted ? 'cancelled' : 'request_failed', interrupted
          ? 'Request cancelled or timed out. Actions already applied remain in the room.'
          : 'The AI request failed. Check the API key, model access and connection. Actions already applied remain in the room.');
      } finally {
        // Trim whole turns so a tool result never outlives its corresponding call.
        if (turns.length > historyTurns) turns.splice(0, turns.length - historyTurns);
        active = undefined;
      }
    },
  };
}
