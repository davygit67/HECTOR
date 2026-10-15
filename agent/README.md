# Projection Mapper agent

This package uses Vercel AI SDK with **OpenAI directly**. It runs in a trusted Node process, such as Electron main. Vercel hosting and an AI Gateway account are not required.

The AI interprets requests and invokes canvas operations. The canvas owns room geometry, rendering, content state and continuous behavior. No model call is needed for each animation frame or timer tick.

## Setup

From the project folder:

```sh
cd agent
npm ci
cp -n .env.example .env
```

The copy command preserves an existing `.env`. Open `agent/.env` locally and replace `replace-me` with your OpenAI API key if needed. Do not paste the key into a chat or use a `VITE_` environment variable. The package's `.gitignore` excludes local environment files. Keep keys in the trusted host process, never a projected page or browser renderer.

```sh
npm run doctor
npm run check
```

`doctor` checks configuration without displaying the key or calling OpenAI. A successful doctor check does **not** prove model access, API billing or connectivity. `check` builds the package and runs offline tests; it does not spend API credits.

After configuring your key, `npm run smoke` makes a small, paid OpenAI request to check the connection. It sends no room data and controls no canvas. This is separate from testing an action inside the simulator.

The default model is `gpt-5.4-mini`. Change `OPENAI_MODEL` to a tool-capable Responses API model available to your account. The default is a starting point for evaluating responsiveness, not a guarantee about model quality or latency. [OpenAI model documentation](https://developers.openai.com/api/docs/models/gpt-5.4-mini).

| Setting | Default | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | Required | OpenAI API credential |
| `OPENAI_MODEL` | `gpt-5.4-mini` | Model used for conversation and tools |
| `AGENT_MAX_STEPS` | `6` | Maximum model steps in one request |
| `AGENT_MAX_OUTPUT_TOKENS` | `1500` | Output limit per model step |
| `AGENT_TIMEOUT_MS` | `45000` | Total request deadline |
| `AGENT_HISTORY_TURNS` | `10` | Whole conversation turns retained in memory |

The limits bound requests, not total account spending. Conversation history is process-local and disappears on restart. OpenAI requests use `store: false`; this is not a promise of zero provider retention.

## Package interface

`readAgentConfig()` reads process environment; the host is responsible for loading `agent/.env` explicitly. The `doctor` and `smoke` scripts load that file automatically when present.

`createOpenAIModel(config)` creates the direct Responses API model. Tests can inject an AI SDK model without an API key.

`createProjectionAgent({ canvas, config })` is the main application entry point. `canvas` is the existing `getSnapshot`/`dispatch` port; its types are imported from the app. `createProjectionAgentFromEnv(canvas)` reads config from the host environment. See [the Electron integration handoff](INTEGRATION.md).

`createAgentSession({ model, bindTurn, ...limits })` creates a conversation with:

- `send(text, { signal?, onEvent? })` — returns text, completion status, token usage and tool receipts.
- `cancel()` — interrupts the active request. Completed canvas actions remain applied.
- `clear()` — resets conversation history when idle.
- `busy` — indicates an active turn. Concurrent turns are refused to avoid interleaving actions.

`bindTurn` supplies tools and an instructions callback. Instructions refresh before each model step; history is not treated as the source of current room state. The SDK executes tools directly and returns their results. A failed request is never automatically replayed as a whole.

The package exports a Node ESM bundle at `agent/dist/index.js`. It must not be imported into the browser UI. The canvas owner controls the Electron main/preload connection.

## Integration status

The provider, conversation service and seventeen agent tools are implemented against schema v3, including YouTube search, placement and dynamic-backlight configuration. Build/typecheck and 77 offline tests pass, including source provenance, bounded search/metadata retrieval, cancellation, real canvas reducer operations, strict OpenAI schemas and confirmations derived from accepted state. Live checks of “put a rain sounds youtube video on the wall with backlight effect” completed new placement in 7.2 s and existing-player replacement in 7.876 s using isolated canonical rooms, preserving artwork and geometry. The canvas owner also verified the exact request in the running browser: search and existing-player replacement succeeded with the same bounds and backlighting enabled. A natural different-video follow-up also preserved placement and lighting. The selected rain video displayed its scene and reached Playing in the actual user tab; it was later observed paused. Hidden test-tab iframes timed out for the same source, which was not proof of video unavailability. Metadata verification alone is not a playback guarantee. Current host integration and rendered validation are tracked in [agent status](../coordination/agent-status.md).

In the running studio, choose **Ask assistant** to open chat. Enter sends a message; Shift+Enter adds a line. Follow-up messages share the current conversation and refresh room context. **Stop request** cancels ongoing work; already-applied edits remain. **Clear conversation** clears conversation history while keeping canvas content. Browser chat requires the local development server; the API key and SDK run in its Node host. Electron uses its main process. Static web hosting alone does not provide the AI service.

| Tool | Behavior |
| --- | --- |
| `inspect_room` | Read the current room, simulated geometry, content, capabilities, timers and persistence state |
| `search_youtube` | Find grounded video candidates for a topic, including title, channel and canonical link |
| `create_timer` | Create a timer on an existing surface; optionally start it |
| `control_timer` | Start/resume, pause, reset or remove an existing timer |
| `attach_timer` | Move an existing timer to another surface without resetting its clock |
| `set_grid` | Show/hide the existing grid overlay |
| `create_note` | Create a text/checklist card |
| `create_recipe` | Display supplied or model-authored ingredients and steps, with source provenance |
| `create_artwork` | Set an animated background, reusing existing art on the surface or creating it when absent |
| `create_reaction_game` | Create a local pointer reaction game; optionally start it |
| `display_youtube` | Place a supplied or searched YouTube video with dynamic backlight enabled by default |
| `set_youtube_backlight` | Turn an existing YouTube panel's glow on or off without reloading the video |
| `configure_video_backlight` | Adjust room fill, opacity, vibrance, tone, brightness, spread and smoothing, optionally on/off, in one atomic edit |
| `update_content` | Edit a title or replace the full configuration of the same content kind |
| `control_content` | Use the actions supported by that content kind |
| `attach_content` | Move content to another surface while preserving runtime state |
| `remove_content` | Remove an existing content instance |

Surface IDs are enumerated from the canvas snapshot. Content capabilities and limits come from the canonical shared registry. No model-facing tool accepts arbitrary room coordinates or edits calibration. Layout is an intrinsic canvas operation; the tool returns its accepted bounds. Tool schema validation remains a local defensive check, not another model round trip. Timer/game creation followed by start uses two ordered commands; if start fails, the receipt reports the instance was created but did not start.

The built-in matrix/ripple line demo is permanently retired. `set_effect` is removed and `effect.set` is excluded from the agent transport allowlist. Legacy effect state is omitted from model context; stale calls cannot restore it. The canvas retains disabled legacy fields only for save compatibility. User-created artwork, the optional calibration grid and video backlight remain separate supported features; the agent must not recreate the retired demo as artwork.

Panels prefer open space but may overlap other assets, while remaining inside surface boundaries and outside exclusions. Each surface permits five assets total, counting timers and all content together, including artwork and videos. This limits new assets and transfers into a different surface; editing, controls and same-surface attachment remain available at capacity. Older saves above the limit remain readable and editable. The agent receives fresh per-surface occupied/remaining counts from the canonical scene and never deletes or moves unrelated content to make room. Artwork uses one background slot per surface and fills its native domain beneath the panels. Ordinary artwork requests update that existing background in place; create_artwork deterministically reuses its ID/bounds/clock and creates only if absent, including when all five asset slots are occupied. Supplied title/config are applied; unspecified existing style should be preserved. Explicitly requesting two simultaneous artwork backgrounds remains unsupported, and attaching artwork onto another occupied background still fails without replacing either. Full recipe configuration updates return to ingredients; title edits and attachment preserve progress. Artwork edits preserve its clock. Game rule edits require idle state; scoring remains local pointer input and is never a model tool.

Artwork labels do not define behavior. The model reads actual appearance descriptions from `ART_PRESETS`, and tool receipts repeat the applied appearance. Mutation replies are built from accepted scene state rather than the model's completion claim, so a contours animation named “Fish swimming” is confirmed as **Flowing contours**. The same corrected reply is retained in conversation history. Unsupported visual subjects should produce an explanation and supported choices without silently installing a substitute. These are implemented procedural animations; arbitrary generated animation code/video is not available.

Repeated delivery of the same tool-call ID is deduplicated within a turn. This is not cross-restart or semantic deduplication: two different calls may intentionally create two timers. Do not automatically replay an entire failed request.

YouTube accepts a topic or supplied link/ID; no separate YouTube API key is required. Try **“Put a rain sounds YouTube video on the wall with backlight effect.”** The agent searches, selects a relevant returned candidate, and reuses the single existing YouTube player on that surface. If no player exists it creates one; an explicit request for an additional/separate player creates another. A request only to find/list options returns canonical links with available titles/channels or explicit unavailable-metadata labels, without changing the canvas. Search-only replies explicitly say that nothing was placed, even if the model claimed success. Supplied links still go directly to `display_youtube` and retain supported timestamps. `display_youtube` takes `surfaceId`, `video`, nullable `title`, `backlight` and `newPlayer`. `newPlayer:null/false` reuses the only existing player or creates if none; `true` explicitly allocates an additional player. Reuse preserves placement and custom lighting style. `backlight:null` preserves the existing toggle or defaults on for a new player. An explicit request with backlight uses true. Changing videos resets the source start to the new link timestamp or zero. **“Turn off the video's backlight”** and the inspector toggle work as before.

`search_youtube({query})` uses the existing model/key with [OpenAI hosted web search](https://developers.openai.com/api/docs/guides/tools-web-search), restricted to YouTube domains. Only actual provider URL sources become candidates; generated answer text cannot supply URLs. Up to five canonical videos receive bounded requests to YouTube's fixed oEmbed endpoint for title/channel metadata. Results include `title`, a canvas-sized `displayTitle`, `channel`, `videoId`, `url`, `sourceUrl`, a boolean `metadataVerified` and `playbackVerified:false`. Successful oEmbed responses retain their verified title/channel. If lookup fails, times out or returns invalid metadata, the already-grounded link remains with `metadataVerified:false`, `channel:null`, and the explicit placeholder `YouTube video <ID> (title unavailable)`. Missing metadata establishes neither watch-page availability nor embedding permission; no artist/title is invented. The agent uses the exact returned URL and displayTitle. Metadata is untrusted text and is never executed as instructions or embed HTML.

Search permits at most two distinct queries per turn (240 characters each), one hosted search call per query, a20s search timeout and5s metadata timeout, all within the existing45s turn limit. Repeated queries/call IDs are deduplicated and cancellation prevents late placement. Empty/unavailable searches still return honest errors without guessed IDs. Metadata failure falls back only to links already returned as actual search sources; user cancellation still rejects the search and prevents late placement. Production display/replacement accepts only user-supplied references, existing videos or remembered search results. A search result does not guarantee playback in every region/player, exact duration, ad-free content or suitability. Normal OpenAI search/model usage charges apply; the outer conversation's `usage` field does not currently include the nested search request's model tokens.

Choose **Use player on canvas** for the controls and use them when ready; new video sources start paused and muted. A connected native source delivers frames from an isolated official YouTube player into surface, 3D, manual and projector composition without screen sharing. The browser iframe fallback, when no native worker is connected, uses Surface layout/manual output with placement previews in spatial views. Dynamic backlighting uses matching source colors and proportional outward gradients inside the surface domain. An enabled setting or accepted scene edit does not prove actual playback or visible color matching. Source replacement re-cues the video; view/style changes preserve the native source and opened browser players. Actual muted moving video with matching gradients is verified in the localhost studio and its clean same-origin output. Precise presentation skew and physical projection remain unverified. See the [YouTube agreement](../coordination/youtube.md).

Only for the supported browser iframe fallback, click **Enable live colors** and select **this studio tab** in the sharing picker. Other tabs, windows and screens are rejected. **Stop colors** releases sharing. Sharing now persists through view, surface, source/configuration and backlight changes, and ends when the final opened player is removed, the page closes/reloads, or development teardown runs. The stop control remains available with backlighting off. Native desktop uses its isolated video source directly, independently of the visible operator view. Look for **Live colors** below the video; **Colors held · video paused** keeps a paused frame's colors, while **Dark or unavailable pixels · glow dimmed** indicates dark/capture-blocked pixels. Browsers without tab sharing and Capture Handle support need the desktop app. Missing or stale samples fade out without a fixed-color substitute.

The browser fallback was corrected to preserve opened player instances/sharing across views and to anchor glow at video edges. Controlled on/off comparisons show blue/orange light outside the image, and actual paused geography-frame screenshots showed warm spill. Earlier sample-status-only checks were insufficient proof of a visible effect. The native worker now feeds the existing localhost site, preserving its browser scene without sharing or switching apps. Canvas owner verified actual muted YouTube playback and a same-frame on/off comparison with visible colored spill outside the video; final verification passed with 85 app tests/build and 60 agent tests/build. The final 63.6 KB bundle is loaded, the existing Scene358 / Geometry5 is retained, and a read-only live chat check correctly described fish and YouTube without edits. Desktop remains separately available through [Launch Studio.command](../Launch%20Studio.command), with a separate saved layout. Avoid capture-module development edits during an active browser sharing session.

Try **“Set room fill to 75%, opacity to 80%, and vibrance to 150%.”** Room fill continuously extends the glow from a normal local backlight at 0% to immersive light across all surfaces at 100%. The renderer protects timers, foreground panels and video, plus each surface's boundaries and exclusions. It uses the existing video source without adding assets or moving content. Opacity controls the blend amount (0–100%); vibrance controls color strength (0–200%, with 100% retaining the chosen tone profile's color).

Brightness, spread, smoothing and tone profiles remain separate controls. Try **“Set brightness to 140%, spread to 30%, and smoothing to 250 milliseconds.”** Then **“Turn it off but keep those settings.”** Null preserves an unchanged setting; edits merge atomically without replacing the video. Defaults are room fill 0%, opacity 100%, vibrance 100%, brightness 100%, spread 18%, smoothing 180 ms and Cinema tone. Frame processing runs locally without per-frame model calls or scene edits. The agent cannot grant browser capture permission, inspect video frames or bypass protected-stream limitations.

The native source is implemented as a sandboxed 1920×1080 official-player renderer per content ID with capped 15 fps CPU bitmap/JPEG latest-frame delivery and matching spatial colors. Silent Electron checks passed frame delivery, identity retention, mute gating, calibrated pointer delivery and cleanup; the shared receiver/painter harness preserved the decoded image while adding/removing the expected outside gradients. Official YouTube startup reached Ready, paused+muted, with six poster frames and no Play. **Actual muted moving YouTube and visible matching gradients are now verified in the localhost studio and clean output. Physical projection remains unverified.** Native WebContents is muted before navigation and every Play; replacement/reload starts paused+muted. Future streaming providers need supported adapters. The unchanged agent tools do not control playback or grant screen-sharing permission.

Uploaded local videos and images are handled through the existing content tools after the user imports them in the interface. The agent can inspect, rename, attach or remove those items; already-uploaded videos also support explicit start/pause/reset requests while preserving mute, volume and other media settings. It cannot upload files, invent asset IDs, replace local-media configurations, seek, or change layer/display settings. Layer order, visibility, opacity, lock and output blackout/brightness are exposed as read-only context. Successful edits describe requested scene state and warn about visibility-disabled settings; they do not verify that a local file is present in this browser, decoded, visibly playing or audible. No file bytes or local paths are sent to the model.

This package does not yet provide general web browsing, weather data, calendar access, recipe retrieval, generated imagery, voice input or motion games. Those require explicit tools and corresponding canvas capabilities.

## Things to try

Try the supported content first, then add integrations:

1. **“Start a five-minute pasta timer on the table.”** Then ask **“Move that timer to the wall.”** The timer keeps its clock as it moves.
2. **“Test stars on the wall and a recipe on the table, then move the recipe without losing my place.”** This exercises the new content tools and the canvas owner's renderers.
3. **“Put a rain sounds YouTube video on the wall with backlight effect.”** Or supply a specific link. Then **“Turn its backlight off”** or **“Make its backlight brighter.”** Use Surface layout or manual output for the live player.
4. **“Add voice, then motion-driven interactions.”** Voice feeds the same agent tools. Fast movement responses and dance scoring run in the local runtime.

Describe the experience you want, the target surface, and what should happen when someone interacts. Keep agent/provider/tool work in this task and geometry/visualization work in **Simulation / UI layer**. The tasks coordinate shared interfaces directly, so you do not need to relay implementation details.

## Development ownership and references

Read [shared coordination](../coordination/README.md) and both status notes before integration changes. Dependencies, tests and source for this package stay under `agent/`. Shared scene types and command semantics remain canvas-owned; do not copy them into a second scene model.

- [Vercel AI SDK agent loop](https://ai-sdk.dev/docs/agents/building-agents)
- [Vercel OpenAI provider](https://ai-sdk.dev/providers/ai-sdk-providers/openai)
- [SDK offline testing](https://ai-sdk.dev/docs/ai-sdk-core/testing)
- [OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling)
