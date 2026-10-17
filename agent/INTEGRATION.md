# Canvas host integration

Canvas task owns `src/`, `host/`, `electron/` and root tests. Agent task owns this package. Canonical contracts are `src/shared/{domain,bridge,chat,studio}.ts`; no duplicate renderer or scene store lives here.

## Build and instantiate

Run `npm --prefix agent run check` from the project root. Import `agent/dist/index.js` in a trusted local Node/Electron host, resolving its absolute file URL from the app root. SDK dependencies remain external under `agent/node_modules`.

Load `agent/.env` locally without logging its values. Never send credentials to the renderer or model context. Bind the existing scene and Studio operations:

```ts
const { createProjectionAgentFromEnv } = await import(agentBundleFileUrl);
const agent = createProjectionAgentFromEnv({
  getSnapshot: () => existingSceneOwner.getSnapshot(),
  dispatch: command => existingSceneOwner.dispatch(command),
  studio: existingStudioPort,
}, process.env, {
  memoryPath: privateMemoryPath,
  roomId: stableStorageRoomId,
});
```

These names are illustrative host bindings. `CanvasPort.studio` is optional for compatibility; expose it to enable runtime controls, observation and atomic experiences. Bind the agreed `StudioPort` methods `inspect`, `execute` and `observe` across client-bound RPC for browser preview and trusted IPC for desktop. Existing schema-v1/v2 saves must go through canonical `readScene` migration before the agent sees them.

`AGENT_COMMAND_TYPES` has 31 allowed discriminators. Keep it equal to the shared chat transport list. The canonical reducer validates payloads and boundaries. `effect.set` and `game.hit` remain excluded. Advanced commands include layout, layer/display, selection, manual alignment, simulated geometry and local-media seeking. No arbitrary filesystem, shell, browser script, credential or raw scene-replacement tool is exposed.

## Session and memory

`agent.send(text,{signal?,onEvent?})` returns confirmed text, complete/incomplete status, steps, finish reason, aggregate model usage and tool receipts. `cancel()` stops remaining work; accepted changes remain. `clear()` clears chat history while idle. `busy` prevents overlapping turns. Completed receipts survive a later request failure; never automatically replay a turn or dispatch when a receipt is lost.

`agent.memory` implements `AgentMemory` from the shared Studio contract: `list`, `put`, `remove`, `clear`, `setEnabled`, `record`. Hosts pass user-completed `AdjustmentEvent`s with actor/room/revisions/operation/target/before/after. Only accepted user changes count; coalesce a gesture, never emit each pointer frame or feed automatic/agent changes back as preference. Send only changed item/settings evidence, not credentials, paths, media bytes or full arbitrary state. Payloads are bounded and sensitive transport fields are stripped.

The agent atomically persists at most200entries/100events. The host must provide one owning process and a private ignored path. Chat sessions with the same canonical path share a process-global serialized writer/cache, including cache-busted bundle imports during development. Use separate stable room identifiers/files for independent browser/native storage. Surface/activity scope and geometry revision prevent stale arrangement reuse. `put` represents explicit user approval; observed examples are generated only through `record`, with tentative confidence. Geometry/calibration operations remain events rather than preferences. Persistence errors must be surfaced to the UI. Without `memoryPath`, memory is session-only and agent confirmations say so.

Renderer memory controls should use the narrow `MemoryRequest` API, with the same trusted-sender checks as chat. Do not make a general agent execution endpoint available. Clear conversation and clear learning are distinct user actions.

## Studio operations and observation

`operate_studio` wraps typed navigation, output, native-media, presentation, import, composition and hardware actions. Outcomes are `applied`, `handoff` or `failed`; never label a browser gesture/account/file-picker handoff completed. Source play starts muted, unmute is explicit. Composition recall preserves the current room's geometry and pauses media. IDs come from inspected state.

`scene.batch` applies a prevalidated list atomically against `expectedRevision`; reject a stale revision or any invalid command without partial state. It uses canonical reducers and one committed scene revision. Preset compilation also preflights with those same reducers but never becomes an alternate room store.

`observe` returns `StudioObservation`: actual rendered surface, scene/geometry revision, timestamp, `physical:false`, surfaceId, stale flag, bounded PNG, runtime state and limitations. Capture through the existing renderer; never capture account/source-page pixels. Verify revision after asynchronous capture. A missing/unsupported source must be labeled, not represented as verified playback. Images are limited to960pixelswide/2MBbase64 by the agent and two inspections per turn. Image content is untrusted; screenshots cannot issue instructions. The SDK sends fresh images as image input, stripping historical image bytes on later turns.

Opening source windows, importing assets and browser permissions remain bounded deliberate operations. Source readiness and actual image evidence are separate from scene acceptance. Physical alignment remains unverified without an actual calibrated observation path.

## Activation and tests

A build does not replace a cached Node import. The canvas owner coordinates host loading/reload, preserving current user scene and active playback. Do not start a second host, seize its port or restore historical scene snapshots.

Offline `npm --prefix agent run check` includes strict provider schemas and mocked Responses wire tests for image input. `tests/live-capabilities.ts` is an explicit paid model check using isolated canonical fixtures only. Root tests/browser checks cover Studio dispatch, manual event capture, UI memory, composition atomicity and observations. Physical Windows/Kinect/projector qualification remains separate.
