import type { LanguageModel } from 'ai';
import { bindCanvasTurn, type CanvasPort } from './canvas.js';
import { createOpenAIModel, readAgentConfig, type AgentConfig } from './config.js';
import { createAgentSession } from './session.js';
import { createOpenAIYouTubeSearch, type YouTubeSearch } from './youtube-search.js';

export type ProjectionAgentOptions = { canvas: CanvasPort; youtubeSearch?: YouTubeSearch } & (
  | { config: AgentConfig; model?: never }
  | { model: LanguageModel; config?: never; maxSteps?: number; maxOutputTokens?: number; timeoutMs?: number; historyTurns?: number }
);

/** Inject the host's existing scene port. This factory never creates a scene store. */
export function createProjectionAgent(options: ProjectionAgentOptions) {
  const { canvas } = options;
  const youtubeSearch = options.youtubeSearch ?? (options.config ? createOpenAIYouTubeSearch(options.config) : undefined);
  const videoSources = new Set<string>();
  const settings = options.config ? {
    model: createOpenAIModel(options.config), maxSteps: options.config.maxSteps,
    maxOutputTokens: options.config.maxOutputTokens, timeoutMs: options.config.timeoutMs, historyTurns: options.config.historyTurns,
  } : options;
  const session = createAgentSession({ ...settings, bindTurn: context => bindCanvasTurn(canvas, context, { youtubeSearch, videoSources }) });
  return { get busy() { return session.busy; }, send: session.send, cancel: session.cancel,
    clear() { session.clear(); videoSources.clear(); } };
}

export function createProjectionAgentFromEnv(canvas: CanvasPort, env: NodeJS.ProcessEnv = process.env) {
  return createProjectionAgent({ canvas, config: readAgentConfig(env) });
}
