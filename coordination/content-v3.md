# Content milestone: canvas and agent agreement

The canvas task relayed the user's request to expand content beyond timers and prepare the AI handoff. **The canonical v3 contract, agent adapter and chat host/UI are implemented.** The canvas owner reports 50 root tests and the production build passing, plus browser content/editor and live chat validation. The agent package builds and passes 34 offline tests, including strict OpenAI tool-schema serialization and accepted-state confirmations. Browser chat is verified; the new Electron IPC path is implemented/typechecked but has not been interactively exercised.

## Ownership and scope

The canvas task owns source types, state migration, command validation, content widgets, intrinsic placement, rendering, pointer input, runtime clocks and scoring. The agent task owns `agent/` context, model tool schemas, command translation, tests and setup/handoff documentation. Existing file ownership remains unchanged.

Runtime scope:

1. Text/note cards.
2. Recipe displays with ingredients, steps and next/back controls.
3. Animated artwork presets with palette/speed and pause/resume.
4. A deterministic pointer reaction game with score/reset. Mouse input first; no Kinect or motion tracking claim.

This original milestone does not imply live feeds, recipe retrieval, generated media or arbitrary generated game code. YouTube is now covered by the additive [YouTube/backlight agreement](youtube.md), with current release status in the task notes. Chat host/UI wiring is canvas-owned and uses the released adapter.

## Agreed direction

- Scene schema advances to v3 with automatic migration from v1/v2 saves. Existing timer commands stay compatible.
- Add `Scene.contents` and `selectedContentId`. Use a discriminated content union with stable IDs, surface attachment and accepted intrinsic bounds.
- Keep the existing `getSnapshot` / `dispatch` port and accepted-scene receipt. A successful receipt confirms an edit, with persistence reported separately.
- The canvas owns all runtime state: current recipe step, animation timing and game score/targets. Agent tools do not compute frames, advance time or award hits.
- The agent imports canonical types. After release, it expects the host to migrate legacy saves to the current schema, rather than performing a second migration itself.

## Agreed contract requirements

1. Export typed creation/update input unions separately from full runtime state. Commands specify caller-generated ID and surface handle; the canvas allocates bounds and initializes runtime state.
2. Export a serializable capability/limits registry from a shared source file: supported kinds/actions, preset and palette IDs, speed limits, text/recipe limits, and capacity. Use it in canvas validation and agent schemas/context so the two layers stay aligned.
3. Preserve idempotent creation by ID and non-mutating rejection. Document whether capacity is shared with timers or separate.
4. Preserve clocks, recipe position and game state when attaching/moving content. Updates must document which fields reset state.
5. Define recipe next/back at the first/last step, and artwork/game pause/resume/reset semantics. A command response must reflect actual applied state.
6. Keep game input/hit/score operations separate from model-facing controls. Agent actions can configure or control the game; pointer input determines scoring.

The canvas owner refined the proposed source contract, and the agent owner confirmed this direction:

- `src/shared/content.ts`: `ContentKind` (`note | recipe | art | game`), discriminated `ContentInstance` / `ContentSpec`, `CONTENT_REGISTRY`, `ContentCommand`.
- `content.create`: `id`, `surfaceId`, `title`, `spec: { kind, config }`.
- `content.update`: `id`, optional `title` / `spec`; full typed configuration replacement, same kind only.
- `content.select`, `content.move`, `content.attach`, `content.remove`.
- `content.action`: `start | pause | reset | next | previous`, with allowed actions defined per kind.
- `game.hit`: separate local-input command with ID, round and target; stale rounds rejected. This is not an agent tool.
- Note configuration: text/accent. Recipe: ingredients/steps/source, with runtime step `-1` showing ingredients. Art: preset (`aurora | stars | contours | fish`), palette (`lagoon | ember | violet`), speed/seed and persisted clock. Game: rounds/seed, runtime status/score/round/clock. `ART_PRESETS` supplies actual appearance labels/descriptions and is included in the artwork registry entry; titles never define rendered behavior.

Art is a single native-surface background per surface. Other content uses the canvas panel allocator, which prefers open space at the requested size but allows overlap with existing assets while enforcing native boundaries and holes. Explicit moves honor the selected valid bounds even when another panel overlaps. The registry distinguishes background and panel layouts. The canonical reducer still rejects a second artwork; the agent create_artwork tool treats an ordinary set-art request as an explicit update of the existing background when present, preserving ID/bounds/clock and applying the requested title/config. It creates only if absent. A request for two simultaneous backgrounds is unsupported, and cross-surface attachment onto an occupied art background is rejected without replacing either. Model-authored recipes must not imply retrieved sources.

These names are released in the canonical source. Import `CONTENT_LIMITS` and `CONTENT_REGISTRY` rather than copying this document into code. `CONTENT_LIMITS.maxPerSurface` is five, counting timers and all content (including artwork and videos) together through `surfaceAssetCount`. The limit applies only to creation and transfer into a different surface. Same-surface attachment, edits, controls, removal and transfers out remain available; older saves with more than five assets on a surface remain readable and editable. This is not a tool-call limit. Existing global limits of 12 content instances and 8 timers remain.

Creation may shrink a panel to the allocator's bounded minimum if its requested size cannot fit the native domain. Existing panels are not hard exclusions. Attachment and movement preserve size and runtime state; attachment can still fail due to destination capacity, the one-background constraint, or a panel that cannot fit the native boundary/exclusions. Recipe navigation clamps at ingredients/last step; reset or full-config replacement returns to ingredients. Artwork configuration preserves its clock; reset pauses at elapsed zero. Game configuration requires idle state; reset discards progress. Title-only edits preserve runtime state. Recipe source may be empty; a model-authored draft is identified as such.

## Agent implementation

- Add current content, selection, supported capabilities and runtime status to room context; preserve simulated spatial provenance.
- Add explicit creation tools for notes, recipes, artwork and the reaction game. Add typed content updates, controls, attachment and removal supported by the released commands.
- Continue deriving available surface handles from the snapshot. Do not expose arbitrary XYZ, geometry editing, raw canvas dispatch or executable code to the model.
- Read creation/update results from accepted-scene receipts; preserve per-turn tool-call deduplication and sequential dispatch.
- Require schema v3 snapshots and receipts after host migration. Retain all timer behavior and cancellation/history handling.

Implemented tools: the original six plus `create_note`, `create_recipe`, `create_artwork`, `create_reaction_game`, `update_content`, `control_content`, `attach_content`, `remove_content`. Runtime type validation uses distinct literal kind/config branches. The provider's nested union uses `anyOf` so all tools serialize in the supported strict schema shape.

## Acceptance checks

Canvas owner: migrations preserve existing timers/manual mapping; content stays within intrinsic domains; attachment preserves runtime state; command failures leave state unchanged; widgets render in both the room and projector outputs; pointer hits and score are deterministic locally.

Agent owner: SDK-driven creation/control of each kind using the actual shared reducer; follow-up edits reference stable IDs; attachment preserves state; invalid presets/limits cannot reach dispatch; duplicate creation delivery is safe; unsupported actions report accurate failures; model tools cannot inject game hits or arbitrary content code; existing timer tests stay green; mocked OpenAI requests serialize compatible tool schemas.

Canvas release readiness, canonical source paths, command/action inventory, migration behavior and renderer checks are tracked in `coordination/canvas-status.md`. Agent readiness and checks are reported separately in `coordination/agent-status.md`. Local key setup, live in-memory conversational creation/editing and browser chat edit/follow-up/cancel/clear/output checks succeeded. Physical projection remains untested.
