# HECTOR contributor instructions

These instructions apply to the entire repository. Follow the user's current instructions when they conflict with this file.

## Product and scope

Build HECTOR as an independently implemented Windows/macOS desktop projection-mapping app using Electron, React, TypeScript, Vite, and a dedicated GPU renderer. A basic mapper is a runnable milestone, not the completed first release.

Study these projects as behavioral and architectural references only:

- https://github.com/adknate05/projection-mapper
- https://github.com/v-prgmr/FREEkMapper

Do not copy, fork, merge, or import their code, assets, or Git history. Record source links and evidence in `docs/FEATURE_PARITY.md`. Distinguish inspected implementation, documented claims, proposals, prototypes, and hardware behavior that has not been verified. If access fails, mark the audit incomplete and continue independent work. If the FREEkMapper identity becomes ambiguous, ask for the exact URL.

Keep the broader feature scope in the parity document and `docs/ROADMAP.md`: mapping and masks; layers and groups; local media and capture; YouTube/live sources; ambient lighting and effects; generated visuals, clocks and timers; named and portable projects; command-based AI; room visualization, Kinect/scanning, calibration, and object mapping. Do not silently drop features. Show sequencing is deprioritized by the user; record it as a scope decision awaiting confirmation.

## Before changing code

- Inspect Git status and applicable instructions. Preserve unrelated changes and existing work.
- Read the README, architecture, parity, and roadmap documents when present.
- Work on a feature branch, never directly on `main`.
- Check available tools and reference access without requesting pasted credentials or exposing secrets.
- Make reasonable implementation decisions independently. Ask only when information is genuinely blocking.
- Keep each milestone runnable; do not stop at a mockup or plan when implementation is requested.

## Architecture boundaries

Keep these responsibilities separate:

1. Electron desktop lifecycle, display management, filesystem access, permissions, and IPC.
2. React studio interface and editor interaction.
3. Serializable project/scene model, validation, commands, and undo/redo.
4. Media sources, decoder ownership, and playback clocks.
5. GPU projection rendering, warping, and compositing.
6. Optional AI providers and hardware adapters.

React must not drive frame rendering. UI selection, panels, or AI activity must not recreate the output window, reset playback, or rebuild unchanged media. Reuse decoders/textures where playback semantics allow, bound queues, discard obsolete frames, and dispose unused resources. Prefer direct media/GPU paths over per-frame JPEG/base64 transport. Preview quality and output quality are independent settings.

## Editing contract

Maintain explicit **draft**, **applied**, and **saved** state.

- **Live Edit:** scene edits publish immediately; Save persists the current setup; unsaved changes remain visible.
- **Preview & Apply:** scene edits affect only the studio preview. Output retains the last applied scene and ongoing playback.
- **Apply & Save:** validate and successfully persist the draft before publishing it. A save failure retains both the current output and the draft and reports the error.
- **Discard:** restore draft from applied state.
- Switching to Live Edit with pending changes requires Apply or Discard, with Cancel available.
- Applying geometry or effects preserves unchanged media playback.
- Draft removal must not dispose a source still referenced by applied output. Undo/redo must obey the active editing mode.
- Clearly distinguish immediate operational controls, such as emergency blackout, from staged scene edits. Document playback-control semantics.
- AI uses the same validated commands as manual editing and must never bypass Apply.

## Desktop and security

- Use context isolation, no renderer Node integration, and sandboxing where supported.
- Expose a narrow, validated IPC API. Validate payloads, sender identity, and sender frame; restrict privileged mutations to the studio.
- Keep secrets and privileged file access out of the renderer. Do not commit credentials, local profiles, private media, or generated builds.
- Deny unexpected navigation, new windows, and permissions. Grant capture/file access only through explicit supported workflows.
- Keep a separate studio window and independent content-only output window. Output has no editor handles, toolbar, or cursor.
- Support output display selection, blackout, windowed/fullscreen operation, and display disconnect/reconnect handling. Studio focus must not exit output fullscreen.
- Qualify Windows and macOS separately; do not infer physical display behavior from mocks or from the other platform.

## Interface and integrations

Use a readable dark interface: Media/Layers/Setups left, mapping canvas center, Transform/Crop/Effects right, compact playback below, and mode/status/save/output/blackout above. Panels should be resizable or collapsible; AI is an optional drawer.

Do not create controls that pretend to work. Keep unavailable capabilities visibly disabled with useful explanations. State actual platform, hardware, service, and licensing limits. A simulated room, generated sensor feed, or mocked adapter is not verified physical calibration or Kinect support.

## Validation and documentation

- Choose compatible stable dependencies and commit the lockfile. Document supported Node versions and exact launch commands.
- Add focused behavioral tests for draft/live isolation, apply/save failures, undo/redo, persistence validation, media continuity, and output lifecycle.
- Run relevant type, build, and test checks; fix failures before reporting the milestone as working.
- Configure Windows and macOS CI and packaging. Signing/notarization and physical-device checks must be labeled pending until performed.
- Measure frame pacing and dropped frames. Profile local media, capture, and YouTube separately. Never claim lag-free output or a frame-rate guarantee without measurements.
- Keep `README.md`, `docs/FEATURE_PARITY.md`, `docs/ARCHITECTURE.md`, and `docs/ROADMAP.md` aligned with actual behavior. Attribute third-party dependencies/assets.
- Record precise handoff steps when work spans sessions, including the last working milestone and unresolved failures.

## Git and session handoff

Use coherent commits if Git identity is configured. Inspect diffs and staged files before committing or publishing; exclude credentials, private media, generated output, and unrelated changes. Never force-push, overwrite unrelated work, or push directly to `main`. Do not imply a commit received human review when it did not.

End each work session with:

- What now works.
- What was tested and on which platform.
- What remains incomplete or blocked.
- The exact command to launch the current build, or an explicit statement that no runnable build exists yet.

When the full scope does not fit in one session, report the milestone honestly and preserve the remaining release scope for continuation.
