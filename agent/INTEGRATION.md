# Canvas host handoff

Owner of host edits: **Simulation / UI layer** (formerly Plan projection mapping assistant). Agent source remains owned by **Define projection content layer**. Shared contract v3 is released in `coordination/canvas-status.md`; the agent implements eighteen tools against it, including the additive [YouTube/search/dynamic-backlight contract](../coordination/youtube.md).

The host implementation is in `host/chat-controller.ts`, `host/canvas-rpc.ts` and `host/vite-chat.ts`, with `src/chatBridge.ts`, `src/ChatPanel.tsx` and Electron main/preload adapters. Both host paths reuse the same agent package. Browser preview chat uses client-bound Vite HMR RPC to the existing browser scene owner; Electron binds directly to the existing main-process scene owner. The studio's **Ask assistant** button opens the panel.

## Build and load

Run `npm --prefix agent run check` from the project root. This produces `agent/dist/index.js`; the package's runtime dependencies live under `agent/node_modules/`. The bundle contains the agent implementation, with SDK packages external. It does not contain a second scene runtime.

In a trusted Node/Electron-main process, load `agent/.env` by its explicit project-relative path if present, preserving any environment already supplied by the launcher. Node's `loadEnvFile(path)` can be used where supported by the host runtime. Do not load the file from a renderer or print its contents. Missing credentials should produce a visible configuration message while the canvas remains usable.

Then import the built ESM module by its absolute file URL. Resolve it from the application root, not the current working directory; the root's compiled Electron main is nested under `dist-electron/electron/`. This is an application-local private package, so do not assume a published npm package exists.

```ts
// Trusted host only. Bind these functions to the host's existing authoritative state.
const { createProjectionAgentFromEnv } = await import(agentBundleFileUrl);
const agent = createProjectionAgentFromEnv({
  getSnapshot: async () => existingSnapshot(),
  dispatch: async command => existingDispatch(command),
});

const result = await agent.send('Start a five-minute pasta timer on the table.', {
  onEvent: event => sendProgressToChat(event),
});
```

The function names above stand for the host's existing functions; this is an integration sketch, not a new state API. Import shared types from `src/shared/bridge.ts` and `src/shared/domain.ts` if typing the adapter. Content types, limits and the capability registry are imported from `src/shared/content.ts`. Use the existing reducer, persistence scheduling and snapshot broadcasts in `dispatch`; success returns `{ ok: true, scene }`, failure `{ ok: false, error }`.

The host must migrate saved v1/v2 scenes through its canonical `readScene` before exposing snapshots. The agent expects schema v3 and does not maintain a second migration or scene store. Existing timer commands remain compatible. Content tools expose typed creation/update/control/attachment/removal; raw runtime state, calibration commands and `game.hit` are not model inputs.

`AGENT_COMMAND_TYPES` is an exported, frozen allowlist of the thirteen command discriminators emitted by the tools. A transport can reject other command types before dispatch. This list does not validate payloads; use the canonical reducer for that. Bind RPC replies to their originating client and request ID, stop pending work on disconnect/timeout, and never retry a dispatch automatically when its receipt is lost.

## Renderer-facing API

Expose a narrow chat API through preload: send a string, cancel the current request, clear conversation while idle, and optionally receive tool-start/tool-end events. The host validates IPC sender and input; the agent additionally limits messages to 8000 characters and refuses concurrent turns.

Do not expose model configuration, the API key, an arbitrary dispatch proxy, filesystem reads or arbitrary tool execution as chat IPC. The existing canvas command bridge remains separate. Use one agent session for the initial desktop chat; do not create a fresh session for every message or follow-up references will be lost.

The first version returns final text rather than token-by-token text streaming. Tool progress events are available while it works. Display `status: incomplete` distinctly when a request limit is reached. On an `AgentTurnError`, show its message and leave the existing scene visible. Cancellation does not undo already-applied commands. Clear conversation is not clear room.

Response shape:

```ts
{
  text: string;
  status: 'complete' | 'incomplete';
  steps: number;
  finishReason: string;
  usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  tools: { toolName: string; toolCallId: string; output: unknown }[];
}
```

Tool success confirms an accepted edit. Check the existing snapshot save status separately; a tool must not be presented as proof of durable saving. Model context preserves simulated geometry provenance. Output-window opening/calibration are not agent tools in this milestone.

The YouTube extension adds `youtube.backlight` and `youtube.backlight.configure` to `AGENT_COMMAND_TYPES`; browser transport includes both. `display_youtube` uses `content.create`, so it needs no new transport endpoint. `configure_video_backlight` issues one atomic command for nullable enable/intensity/spread/smoothing/toneProfile/opacity/vibrance/roomFill settings. Canonical profiles are `cinema` (default), `vivid`, `soft`, `neutral` (UI label Natural). Opacity is 0–1/default1, vibrance 0–2/default1, and roomFill 0–1/default0. Room fill continuously expands the existing video light from a normal halo to all surfaces, with renderer-owned masks protecting timers and foreground panels. It neither creates assets nor changes placements. The unreleased binary coverage proposal was replaced by roomFill. Full-config replacement requires all four optional canonical fields as nullable provider-schema keys; null is omitted on translation, while explicit zero is retained. Preserve custom values when changing video. Continuous analysis, blending and tone mapping run locally; AI selects policy and never receives video frames. Receipts report playback/capture verified:false because scene acceptance is not runtime visual evidence. Rebuild the agent and reload the trusted host after bundle changes; existing Node module imports are cached. Current release/QA status is in the coordination notes.

**Earlier source-delivery milestone:** a connected local native worker supplies official-player frames/colors to the existing localhost site and compositor without screen sharing or an app switch; plain iframe fallback remains separate. Agent schemas/commands are unchanged. Receipt output descriptions come from the canonical YouTube registry; playback/capture remain `verified:false` because model scene receipts do not carry authoritative runtime state. New sources default paused+muted, and native Play is mute-gated. Final live verification passed with muted moving YouTube and visible matching gradients in Surface layout and clean same-origin output, including same-frame off/on checks. A read-only live AI request correctly described fish and YouTube without edits. The final 63.6 KB bundle is loaded by PID66318; Scene358 / Geometry5 and fish are preserved. Root has 85 passing tests/build and agent has 60. No further reload is needed. Physical projection and other providers remain unverified.

`search_youtube({query})` is a trusted-host read tool, so the command allowlist stays at13 entries. `createProjectionAgent({config})` automatically binds OpenAI search using the existing key/model; it does not need a new host route or scene field. An injected test/custom model can provide `youtubeSearch: YouTubeSearch`; otherwise search honestly reports unavailable. `bindTurn` now receives the current `prompt` for conversation-local user-link provenance. Search result IDs and explicit user references are remembered in the agent session (bounded to200 references at turn start); clearing the conversation clears that memory, and current scene videos remain available. No second room store is introduced.

The hosted search request uses only the concise topic, not room snapshots or chat history. It has YouTube domain filters, `store:false`, at most one hosted call, no automatic retries,20s timeout, and turn cancellation. Only provider-returned sources are parsed. Up to five candidates are checked through the fixed official oEmbed endpoint, with redirect rejection,5s deadline and64KiB response limit. Only plain metadata is returned, never oEmbed HTML. UI can show **Finding YouTube videos…** for `search_youtube`. Results use canonical watch URLs; successful placement/update replies include the chosen label and URL. Search-only replies are also canonical and explicitly say no player was placed. `display_youtube` now requires nullable `newPlayer`: null/false reuses the only player on the target surface (or creates if none); true asks for an additional player. Reuse issues the existing content.update command and preserves bounds/custom lighting style. No new renderer contract is required. Preserve source access through the current video ID even after reload. Nested search usage is billed separately and its model-token count is not currently merged into the outer `TurnResult.usage` field.

Canvas mutation replies now come from canonical accepted command/scene records. Artwork confirmations identify the actual `ART_PRESETS` label and clock state, never infer visible behavior from a user/model title. Normal read-only answers remain model-authored. If an operation fails, its failure is reported alongside any partial accepted changes. No extra model pass is needed for these confirmations, and discarded model success narration is removed from follow-up history while keeping tool calls/results intact. Acceptance still does not establish that physical projection or rendered pixels were verified.

## Acceptance checks

1. With no API key, app and canvas still work; chat reports how to configure the key.
2. With an injected mock model, create/start a 300-second timer on `tabletop`, attach it to `wall`, then pause it. The same timer ID and deadline survive attachment, accepted bounds remain valid, and the UI receives existing snapshot updates.
3. Create a recipe on one surface and artwork on the other. Navigate a recipe step, attach it and confirm the step survives. Panels can overlap while respecting native boundaries/exclusions. Five assets per surface count timers and all content together; only net additions/transfers are limited. Check that a sixth asset is rejected without deleting/reflowing existing panels, existing assets can still be edited/controlled, and older over-limit saves remain editable. `roomContext.surfaceCapacity` uses canonical `surfaceAssetCount` and `CONTENT_LIMITS.maxPerSurface` to report occupied/remaining counts without introducing a second validator. Ordinary create_artwork requests reuse an existing same-surface background through content.update, preserving ID/bounds/clock even at capacity; true creation only occurs when absent. Attaching artwork onto another occupied background must still fail atomically. Game scoring comes only from local input.
4. Cancel a pending request and verify the canvas remains responsive. Do not replay prior tools on a retry.
5. A local key is configured and one small live connectivity request succeeded. After chat wiring, run a small live canvas request and observe tool receipts and actual scene changes. Connectivity and offline mocks do not establish natural-language accuracy, rendered behavior or real tool-call latency.
6. Display a supplied YouTube link on a free surface. With an active local color source, turn its backlight off and on. Confirm the same ID, source and start timestamp remain and the embedded player stays mounted; browser sharing must survive the lighting toggle and view/source changes; Stop colors, final opened-player removal, page close/reload and development teardown release it. Repeat via the inspector toggle and verify partial style changes preserve unspecified settings. A topic request should search for grounded candidates; ask for a link only when discovery is unavailable or unsuccessful. A failed placement must not claim playback. Check manual output separately from the explicitly labeled spatial placement preview.
7. Check live source behavior separately from agent acceptance. For connected native sources, verify frames and colors in the existing compositor without a sharing prompt. Only the browser iframe fallback uses **Enable live colors** and sharing of this studio tab. Verify spatial color tracking, paused colors, dark/stale dimming, exclusion clipping and readable permission/unsupported-source feedback. Never treat the enabled setting or a successful tool receipt as proof that frames were captured.

The browser renderer never reads the API key. The Vite development host loads it in Node and sends private client-bound chat/RPC messages. A studio-ready handshake, loopback origin/remote checks, Vite token protections and one active turn per origin constrain that development transport. Output windows are not chat clients. A static production web build has no AI host; use the local dev server or Electron.
