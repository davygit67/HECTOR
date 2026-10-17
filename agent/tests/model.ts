import { MockLanguageModelV4 as RawMockLanguageModelV4 } from 'ai/test';

type Generated = Awaited<ReturnType<RawMockLanguageModelV4['doGenerate']>>;
const usage: Generated['usage'] = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

export function textReply(text: string): Generated {
  return { content: [{ type: 'text', text }], finishReason: { unified: 'stop', raw: undefined }, usage, warnings: [] };
}

export function toolReply(toolName: string, input: unknown, toolCallId = 'call-1'): Generated {
  return { content: [{ type: 'tool-call', toolCallId, toolName, input: JSON.stringify(input) }],
    finishReason: { unified: 'tool-calls', raw: undefined }, usage, warnings: [] };
}

/** Existing action-focused fixtures get a receipt-only review without consuming their
 * scripted follow-up. Completion/orchestration tests use RawMockLanguageModelV4 and
 * explicitly script every review, including malicious/invalid/missing reviews. */
export class MockLanguageModelV4 extends RawMockLanguageModelV4 {
  constructor(options: ConstructorParameters<typeof RawMockLanguageModelV4>[0] = {}) {
    const script = options.doGenerate;
    let index = 0;
    super({ ...options, doGenerate: async call => {
      if (call.toolChoice?.type === 'tool' && call.toolChoice.toolName === 'review_request') {
        let lastUser = -1;
        call.prompt.forEach((m, i) => { if (m.role === 'user') lastUser = i; });
        const user = call.prompt[lastUser];
        const request = user?.role === 'user' ? user.content.filter(p => p.type === 'text').map(p => p.text).join(' ').slice(0, 500) : 'Requested fixture action';
        const evidence = call.prompt.slice(lastUser + 1).flatMap(m => m.role === 'tool' ? m.content.flatMap(p => {
          if (p.type !== 'tool-result' || p.output.type !== 'json' || !p.output.value || typeof p.output.value !== 'object') return [];
          const result = p.output.value as { ok?: boolean; outcome?: string };
          return result.ok && result.outcome !== 'handoff' && !['select_tools', 'review_request', 'search_youtube'].includes(p.toolName) ? [p.toolCallId] : [];
        }) : []);
        return toolReply('review_request', { requirements: [{ id: 'fixture-action', request,
          status: evidence.length ? 'completed' : 'blocked', evidence,
          reason: evidence.length ? null : 'Action could not be confirmed in this fixture.' }] }, 'fixture-review');
      }
      if (Array.isArray(script)) return script[index++]!;
      if (typeof script === 'function') return script(call);
      throw new Error('No scripted model response.');
    } });
  }
}
export { RawMockLanguageModelV4 };
