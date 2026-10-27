# HECTOR roadmap

The first release is the full scope in [FEATURE_PARITY.md](FEATURE_PARITY.md), not the basic mapper. Milestones keep the app runnable. Nothing below is dropped; each item stays visible (disabled with an explanation where relevant) until it ships.

## M1 — Basic mapper (current; Windows smoke passing)

Done in code: two-window app, draft/applied/saved with Live and Preview & Apply, undo/redo, quad warp, crop, ellipse mask, opacity/brightness/saturation, layers with lock/visibility/order, local image/video, generators (gradient, grid, elapsed clock), named setups, portable export, blackout, transport, display selection, and disconnect hiding.

Remaining to close M1:

- macOS run of `npm run check` and `npm run smoke`, plus a first CI run on both OSes.
- Physical projector checks from [QUALIFICATION.md](QUALIFICATION.md): second display, fullscreen with studio focus, disconnect/reconnect, sleep/wake.
- Runtime coverage for image sources, loop/speed/volume, relink, named-setup recall, portable export/import, and pixel tests for crop and masks.
- Coherent commits on `feat/hector-studio` and a PR for human review.

## M2 — Editing depth

- Freeform polygon masks and feathering; mask editing on the canvas.
- Group transforms (move/scale/rotate a group) as real hierarchy, not labels.
- Per-source transport (independent clocks, in/out points, duration UI); seek support for files without duration metadata.
- Resizable panels with persisted layout; keyboard shortcut map.
- Output profiling surfaced in the studio over a bounded, low-rate channel.

## M3 — Live sources

- Screen/window capture through an explicit OS-permission workflow, with crop, stop and reconnect. Qualify Windows and macOS (Screen Recording permission) separately.
- YouTube/live content through a sandboxed adapter that respects the service's terms. Profile timing separately from local media.
- Profiling for each source type: local media, capture, stream.

## M4 — Effects, generated content, ambient

- Ambient/backlight driven by real sampled source colors (no fabricated glow when a source is missing), with smoothing and spread.
- Richer generated visuals, countdown timers, notes/recipe panels, target game. Any user-authored content is data, not executable code.

## M5 — AI assistant (optional drawer)

- Provider integration with secrets held in main only. The assistant emits validated `commandSchema` commands, and Preview mode still requires Apply. Memory is opt-in and local.
- AI-authored programs only inside a sandbox with resource limits, offstage testing, and rollback. Design review is required before implementation.

## M6 — Spatial

- 3D room visualization with simulated projectors, clearly labeled as simulation.
- Kinect/depth helper, scan/replay, measured calibration error, curved and slow-moving object mapping. Each step requires real hardware; replayed or generated data must be labeled.

## M7 — Release

- Signed Windows installer; signed and notarized macOS DMG. Both are pending until performed with real credentials.
- Measured frame-pacing report per platform and source type. No frame-rate guarantees without data.

## Scope decision awaiting confirmation

- **Show sequencing / live cue slots** (FREEkMapper has sequences): the user deprioritized it. It is recorded here and not scheduled until the user confirms whether it belongs in the first release.
