# Projection Mapper agent

Vercel AI SDK with **OpenAI directly**, running in the trusted local Node/Electron host. Vercel hosting is not required. The agent operates the same canonical scene and Studio controls as the interface; the app owns geometry, rendering, media and sensor processing. No model request runs per frame.

## Setup

From `agent/`:

```sh
npm ci
cp -n .env.example .env
npm run doctor
npm run check
```

Enter the key locally in `agent/.env`; never paste it into chat or expose it through a `VITE_` variable. `cp -n` preserves an existing file. `doctor` checks configuration without printing the key or calling OpenAI. `check` builds and runs offline tests. `npm run smoke` makes a small paid connectivity request.

| Setting | Default | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | Required | Trusted host credential |
| `OPENAI_MODEL` | `gpt-5.4-mini` | Direct Responses API model |
| `AGENT_MAX_STEPS` | `12` | Total model steps, including completion review and continuation |
| `AGENT_MAX_OUTPUT_TOKENS` | `1500` | Output limit per step |
| `AGENT_PROGRAM_MAX_OUTPUT_TOKENS` | `6000` | Output limit when program authoring tools are enabled; final forced review uses the normal limit |
| `AGENT_PROGRAM_REASONING_EFFORT` | `medium` | OpenAI reasoning for program work; requires a model supporting reasoning, configurable as none/low/medium/high |
| `AGENT_TIMEOUT_MS` | `90000` | Whole request deadline, shared by all continuations |
| `AGENT_HISTORY_TURNS` | `10` | Maximum complete turns retained |

The model is configurable. These limits bound individual requests, not total account spending. Requests use `store:false`, which does not promise zero provider retention. Conversation history is process-local; learning memory persists separately when the host supplies `memoryPath`.

## What the agent can do

The full Studio integration exposes 36 tools. A basic snapshot/dispatch adapter exposes scene tools but omits host-dependent operations, including program authoring. Existing `.env` values override defaults; update the step/time settings locally if they still use the earlier 6-step/45-second defaults. Offline program tests also use the canvas-owned QuickJS dependencies, so install the root package as described in the project setup first.

| Tools | Purpose |
| --- | --- |
| `select_tools` | Enable additional tool categories on demand |
| `review_request` | Track every requested outcome; continue pending work and explain blocked items or user handoffs |
| `inspect_room`, `inspect_studio` | Authoritative scene, interface, runtime readiness/errors and hardware state |
| `create_timer`, `control_timer`, `attach_timer` | Timer creation, lifecycle and surface attachment |
| `create_note`, `create_recipe`, `create_artwork`, `create_reaction_game` | Implemented content; presets are not arbitrary generated animation/game code |
| `update_content`, `control_content`, `attach_content`, `remove_content` | Existing content editing and lifecycle |
| `search_youtube`, `display_youtube` | Grounded discovery and player placement/reuse |
| `set_youtube_backlight`, `configure_video_backlight` | Toggle, tone, brightness, spread, smoothing, opacity, vibrance and room fill |
| `set_grid` | Calibration grid visibility |
| `edit_scene`, `arrange_panel` | Exact or semantic layout, layers, timer settings, display, local-video seek, selection and explicit room/alignment controls |
| `configure_media` | Existing local-media fit, loop, speed, audio, rotation, flips and color |
| `fill_surface` | Solid fill/clear on an existing planar surface; explicit preview or physical target, with measured-source and live-sensor checks for physical output |
| `operate_studio` | Navigation, output, native playback/source controls, import handoff, saved compositions and hardware actions |
| `inspect_visual` | Actual revision-labeled rendered surface image, at most twice per turn |
| `manage_memory` | Inspect, remember/edit, forget, clear, pause/resume learning |
| `list_experiences`, `apply_experience` | Adaptable room experiences through atomic canonical commands |
| `author_program`, `revise_program`, `test_program` | Write and test original bounded 2D animation/game code without changing live content |
| `apply_program`, `inspect_program`, `configure_program`, `rollback_program` | Apply a passing candidate, inspect saved code/runtime, adjust numeric controls, or restore the prior version |

Examples:

- “Move the timer to the top right, 30% wide, and lock its position.”
- “Set the video layer opacity to 80% and output brightness to 120%.”
- “Play that YouTube video muted.” / “Turn on its sound.”
- “Look at the wall preview and check whether the timer is obscured.”
- “Remember that I prefer gentle lighting for movies.”
- “Set up the underwater experience on the wall and table.”
- “Save this composition as Movie night.”

File selection, browser fullscreen permissions and account sign-in may require a user action. Handoffs are reported as pending, never as completed uploads or authentication. Sensor operations expose the implemented acquisition/replay controls; they do not create body tracking, touch calibration or a physical geometry solution. Game scores are not injected by the agent. The retired matrix/ripple demo cannot return.

After attempted actions, a model text stop alone cannot complete the request. A structured review must account for the original prompt, with stable requirement IDs and actual successful action receipts for completed outcomes. Searches, failed actions and import handoffs cannot establish completion. Pending supported work continues within the same total step/time budget without replaying accepted changes. Blocked/awaiting-user items appear alongside the deterministic accepted-state summary, and the overall status is incomplete. The final available step is reserved for review when possible. No review means no complete status. Questions and read-only inspection keep their normal answer flow.

The model still interprets intent and matches requirements to receipts; this is not a mathematical guarantee of semantic or visual correctness. Program tools can create original stylized 2D figures and interactive logic using drawing primitives. They do not generate photographic posters, cinematic video, external textures or 3D assets. Missing capabilities must remain explicit; an unrelated preset or a moving static cutout is not evidence of the requested subject or rigged animation. Global subject-honesty instructions remain in context even when a subject matches no preset keywords. Accepted scene state does not prove visible playback or physical projection.

## Generated programs and follow-up adjustments

The model writes source for Projection SDK 1; the local QuickJS interpreter runs frames. A program has JSON state, numeric controls, `init`/`update`/`draw` functions and input-replay assertions. It produces bounded drawing commands and receives normalized pointer/keyboard events. Source has no access to the app, network, files, DOM or Node APIs. The canvas owner supplies worker isolation, CPU/heap/output limits, persistent artifacts, painting, clipping, input and UI controls.

`author_program` and `revise_program` run offstage tests and return the actual runtime report plus a bounded preview image when available. Failed checks are available for repair. At most three test executions are permitted per turn across author/revise/test; duplicate call delivery does not consume another attempt. After a runtime test failure the next model step is restricted to the appropriate repair tool; after a pass it is restricted to apply. The final budget step still reserves an honest review. The model must use the host-issued passing token and exact tested scene revision to apply. Tokens bind source, surface, scene and geometry; concurrent changes require retesting. A tested candidate never satisfies a request for deployed content. Explicit test/preview-only requests expose `test_program` and block apply instead of forcing a scene mutation.

New code applies paused and is started explicitly when animation/play was requested. Parameter changes preserve progress; code revisions and rollback reset and pause. A revision replaces the same content ID, preserving placement/layers and the last working version until apply succeeds. The normal content/layout tools support title, position, size, surface attachment, visibility, opacity, layering and start/pause/reset. `inspect_program` reads the current definition before a source edit; compact runtime readiness/errors enter subsequent context without large game-state payloads. A running clock is not proof of rendered output. Physical Kinect interaction and object tracking remain outside SDK 1.

Example: “Create an animated clover border with adjustable speed and density,” then “Make it slower,” or “Change its movement to respond to clicks.” The first request authors a program; a supported speed adjustment patches parameters; changed behavior creates, tests and applies a new revision. There is no per-frame model call or video regeneration.

## Learning and context

Hosts supply a stable `roomId` and private `memoryPath`. Memory uses bounded atomic local JSON, with no database/native dependency. The returned `agent.memory` API supports the interface's Memory panel. The host records accepted, completed manual adjustments, coalescing slider/drag gestures. Records include actor, before/after, target, room and geometry revision. Agent/system actions do not become examples of user preference.

Explicit preferences and tentative observed examples remain distinct. Retrieval is scoped to room, surface/activity when present, and geometry revision for observed arrangements. Calibration/setup events remain factual history, never learned aesthetic preferences. At most six relevant entries enter a step. The user can edit/delete entries, clear history or pause both recording and suggestions. Clearing conversation does not clear learning. Missing/corrupt/unwritable storage does not produce a false durable-success claim; a host without `memoryPath` has session-only memory.

This is learning through saved evidence and retrieval, not model weight training or reinforcement learning. A single adjustment is not treated as a permanent general preference. The local file is bounded to 200 entries and 100 adjustment events. One trusted host process owns each memory file; its chat sessions share a per-path cache and serialized writer.

Each model step refreshes authoritative state. Relevant tool groups are exposed first; `select_tools` can enable any category or the full set on the next step. Routine prompts omit unused geometric detail and specialized instructions; `inspect_room` retrieves full details. Whole-turn history is bounded to 28,000 characters and ten turns by default. Prior screenshot bytes are stripped from subsequent turns while tool receipts remain paired. Domain instructions are restored when matching tools are used.

Measured-surface context always preserves per-surface provenance and concise calibration evidence. Dense coverage-mask pixels stay out of model context. `fill_surface` accepts an explicit `scene-preview` or `physical-surface` target; setting physical color requires a sensor-sourced measured surface, fresh live hardware, matching sensor identity and a valid current depth/output check. It never falls back to the simulator. Clearing a fill remains available after disconnect. `operate_studio` exposes `map-table`, `solve-surfaces` and user-confirmed `use-surface`; these invoke the canvas-owned solver rather than model-authored geometry. Fullscreen/candidate handoffs are unfinished work. Fixed-rig planar mapping does not implement semantic object recognition, curved-object masks or motion tracking. In particular, a request to color a Clorox cylinder must not color its supporting table instead. See [the object projection design](../CONTENT_ARCHITECTURE.md#physical-object-request-turn-the-clorox-cylinder-red).

## Visual inspection and experiences

The Studio port returns a real surface render with revision, timestamp, readiness and limitations. The model receives it as image input. Stale, oversized or missing images are not used as visual evidence. This is a software render, not a photograph of physical projection; unsupported video capture is labeled by the host. Continuous tone mapping remains local.

Built-in experiences are Underwater room, Quiet gallery, Immersive cinema, Music room, Cooking station and Tabletop target game. They use implemented fish/aurora/stars, existing grounded YouTube sources, a cooking checklist or the pointer game. Music lighting follows video pixels, not beat detection. Cooking does not fabricate a recipe or start an unspecified timer. Presets preserve unrelated panels, geometry and playback, and preflight through the canonical reducer before a revision-checked atomic batch. Existing art is reused. Saved custom compositions live in the canvas-owned library.

## YouTube and source fidelity

Search uses OpenAI hosted web search restricted to YouTube. Only provider-returned source URLs ground candidates; generated answer URLs cannot. Official oEmbed metadata enriches up to five candidates. Failed metadata retains grounded links with explicit placeholder labels, `metadataVerified:false`, `channel:null`, `playbackVerified:false`. Never infer playback failure from metadata failure. Two distinct searches per turn, bounded query/metadata timeouts and cancellation apply. Nested web-search usage is not included in the outer conversation's model-token totals.

Normal requests reuse the one player on the requested surface, preserving placement and custom lighting. New/replaced sources begin paused and muted; requested native playback starts muted and sound is a separate explicit action. The host's ordinary YouTube source supplies frames to the existing renderer. Account/region/content restrictions remain. Browser fallback sharing permissions require the user. No stream extraction or access-control bypass is implemented.

The renderer enforces surface boundaries and exclusions, permits panel overlap and protects foregrounds from room-fill light. A successful scene receipt is not proof of decoded playback, saved-to-disk completion or physical projection. The source status, observation and persistence status are separate evidence.

## Integration and verification

See [INTEGRATION.md](INTEGRATION.md) for host APIs and [agent status](../coordination/agent-status.md) for current activation/validation. Build output is `agent/dist/index.js`; do not import it into a browser. The host owns activation and the live scene.

`npm run check` covers canonical reducer interactions, provenance, schemas, cancellation, memory persistence, stale images, image wire format and preset preflight. An optional **paid** check uses synthetic rooms only:

```sh
node --env-file-if-exists=.env --import tsx tests/live-capabilities.ts
node --env-file-if-exists=.env --import tsx tests/live-multipart.ts
```

These exercise real model layout/layer/display requests, preference memory, the screenshot's mixed supported/unsupported composition, and a fully supported four-operation composition without connecting to the user's scene. Multipart search uses a fixed grounded fixture; it does not test real search, playback or generated assets. Neither offline nor synthetic live checks establish physical Kinect/projector performance.
