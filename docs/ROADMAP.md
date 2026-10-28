# HECTOR roadmap

This is the single list of outstanding work, blockers and next steps. Other documents cover:

- [FEATURE_PARITY.md](FEATURE_PARITY.md): the full first-release scope and reference evidence.
- [QUALIFICATION.md](QUALIFICATION.md): what has been verified, and on which platform.
- [ARCHITECTURE.md](ARCHITECTURE.md): how the app is built.

The first release is the full parity scope, not the basic mapper.

## Branches

`main` contains the app. Make subsequent changes on feature branches and submit them for review.

## Blockers

- **Draft PR and first CI run:** `feat/hector-studio` is pushed, but the draft PR is not open yet and the first Windows/macOS CI run has not been inspected. The agent session has no GitHub API access (no `gh`), and the repository is private. The macOS build artifacts come from that CI run.
- **macOS evidence:** none exists. It needs a CI run and an interactive run by a tester on macOS (see [QUALIFICATION.md](QUALIFICATION.md#testing-on-macos)).
- **Hardware:** no projector or second display has been tested on either OS.

## Now: close out M1 (basic mapper) and capture

- Validate the studio Live view toggle on Windows/macOS: preview resources release while output continues, and preview resumes after repeated toggles. Desktop CI and manual qualification remain pending.

- Re-run Windows/macOS CI to validate the loop-safe staging playback assertions; local Linux checks pass, desktop qualification still needs a supported display.
- Interactive macOS run of `npm run check`, `npm run smoke` (with `HECTOR_CAPTURE_TESTS=1` after granting Screen Recording) and the manual checklist.
- Physical checks in [QUALIFICATION.md](QUALIFICATION.md#manual-hardware-checklist): extended desktop, fullscreen while editing or switching apps, disconnect/reconnect, sleep/wake.
- Install-test the unsigned NSIS installer; check the ad-hoc-signed macOS DMG opens on Apple Silicon and Intel.
- Pacing: repeat `npm run measure` fullscreen on a projector, with H.264/HEVC and 4K files, and over long runs. Explain the occasional 1/3-refresh pairs at 60 fps.
- Human review of the draft PR.

## Next: M2, editing depth

- Freeform polygon masks with feathering, edited on the canvas.
- Group transforms (move/scale/rotate a group) as a real hierarchy, not labels.
- Per-source transport: independent clocks, in/out points, duration UI. Seek for files without duration metadata.
- Resizable panels with persisted layout; a keyboard shortcut map.

## M3: live sources

- Screen/window capture: works on Windows. Remaining: macOS permission flow and interactive qualification, capture audio, behavior when the captured window is minimized, capture profiling, optional auto-reconnect after restart (currently explicit by design).
- YouTube/live content through a sandboxed adapter that respects the service's terms.
- Separate profiling for each source type: local media, capture, stream.

## M4: effects, generated content, ambient

- Ambient/backlight driven by real sampled source colors, with no fabricated glow when a source is missing.
- Richer generated visuals, countdown timers, notes/recipe panels, target game. User content is data, never executable code.

## M5: AI assistant (optional drawer)

- Provider integration with secrets held in main only. The assistant emits validated scene commands; in Preview mode it still requires Apply. Memory is opt-in and local.
- AI-authored programs only inside a sandbox with resource limits, offstage testing and rollback. Needs a design review first.

## M6: spatial

- 3D room visualization with simulated projectors, clearly labeled as simulation.
- Kinect/depth helper, scan/replay, measured calibration error, and curved or slow-moving object mapping. Each requires real hardware; replayed or generated data must be labeled as such.

## M7: release

- Signed Windows installer; signed and notarized macOS build. Pending until performed with real credentials.
- Frame-pacing report per platform and source type, measured fullscreen on projectors.

## Scope decision awaiting confirmation

- **Show sequencing / live cue slots** (FREEkMapper has sequences): the user deprioritized it. It stays in scope on paper but is not scheduled until the user confirms whether it belongs in the first release.
