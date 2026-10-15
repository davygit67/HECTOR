import { MockLanguageModelV4 } from 'ai/test';

type Generated = Awaited<ReturnType<MockLanguageModelV4['doGenerate']>>;
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

export { MockLanguageModelV4 };
