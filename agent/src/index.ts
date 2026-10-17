export { createOpenAIModel, readAgentConfig, DEFAULT_MODEL, type AgentConfig } from './config.js';
export { createAgentSession, AgentTurnError, type AgentEvent, type TurnResult } from './session.js';
export { createProjectionAgent, createProjectionAgentFromEnv, type ProjectionAgentOptions } from './projection-agent.js';
export type { CanvasPort } from './canvas.js';
export { AGENT_COMMAND_TYPES } from './commands.js';
export { createOpenAIYouTubeSearch, type YouTubeSearch, type YouTubeSearchResult, type YouTubeSearchResponse } from './youtube-search.js';

export { createMemoryStore, type MemoryStore, type MemoryEntry, type AdjustmentEvent } from './memory.js';
export { EXPERIENCES } from './experiences.js';
