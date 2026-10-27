# Feature parity audit

Audit date: 2026-10-27. This is a release scope register, not a claim of complete parity. HECTOR is independently written; no reference code, assets, or history are imported.

## Evidence and confidence

- **P**: [projection-mapper README](https://github.com/adknate05/projection-mapper/blob/main/README.md), blob `22ddacfcb1b76cb3f7a101d52f51b6a8802e95e0`; [desktop host](https://github.com/adknate05/projection-mapper/blob/main/electron/main.ts), blob `aa6b012b85671519091b6c48fb21f23ee9b66ce2`, first 160 lines inspected; package manifest inspected. Access succeeded through connected GitHub. README describes a prototype, including tests performed by its author; these were not independently run.
- **F**: [FREEkMapper](https://github.com/v-prgmr/FREEkMapper) and its [PyPI distribution](https://pypi.org/project/freekmapper/) agree on project identity and author. No second matching projection-mapping project was found. [main.py](https://github.com/v-prgmr/FREEkMapper/blob/main/src/freekmapper/main.py), blob `ecf5eec55c3f2150ef5bd95250b8d2af4b16684e`, and pyproject inspected. Python/Tk editor, OpenGL output, OpenCV media thread, NumPy configuration persistence. No reference app was installed or executed.
- **U**: user's requested HECTOR behavior; not assumed to exist in either reference.

“Code” below means source evidence, not runtime verification. “Documented” means a reference claims the behavior but its implementation has not yet been audited. The advanced P audit remains incomplete; inspect relevant modules before declaring parity. Hardware claims remain unverified even where prototype code exists.

## Scope before implementation

All features started as Pending. The final column was updated on 2026-10-27 from code review and the Windows smoke run (`npm run smoke`, Windows 11, one built-in display, no projector). “Implemented” without a platform note means implemented in code only, not runtime-verified. No macOS evidence exists yet.

| Feature | Source / reference confidence | Dependencies | Acceptance criterion | HECTOR status |
|---|---|---|---|---|
| Quad creation, corner warp, opacity, rotation | F code; P documented | GPU compositor, command model | Independent corners; stable output under edits; opaque black outside | Implemented. Windows smoke: warped quad and opacity seen in output screenshot. Corner drag and rotate buttons not automated |
| Precise nudge, scale, crop, masks | P documented; U | Geometry validation, inspector | Pixel nudge, bounded crop and masks agree in preview/output | Implemented in code (nudge, scale, crop, ellipse mask). Not checked at the pixel level. Freeform polygon masks pending |
| Layers, groups, collapsing, visibility, locking | P documented for layers/visibility/opacity; groups unverified | Command history, editor | Reorder and group without changing media identity; locked objects cannot move | Partial. Order, visibility and lock implemented and unit-tested. Groups are labels with collapse, not transform hierarchies |
| Local image/video, play/pause/seek/loop/speed/volume | F code for files/concurrent playback; P documented | Media registry, runtime clocks | Each control works; geometry apply never restarts unchanged media | Implemented. Windows smoke: local WebM decode, play, pause, seek (files with duration metadata), and the decoder and clock surviving geometry/effects Apply. Loop/speed/volume and image sources not yet runtime-tested. Files without duration metadata cannot seek |
| Missing media relink | U; reference implementation unverified | File grants, persistence | Missing media reported; relink repairs references | Implemented in code. Not runtime-tested (needs the native dialog) |
| Screen/window capture and crop | U; P explicitly uses owned browser capture for normal YouTube, not desktop capture | OS permission flow, direct GPU transport | Select source, crop, stop/reconnect; qualify both OSes | Not started; control disabled with explanation |
| YouTube and live content | P documented normal watch-page worker and static iframe fallback | Sandboxed source adapter; service restrictions | Real playback, consent isolation, bounded transport, measured timing | Not started; control disabled; unavailable until adapter exists |
| Ambient/backlight, color adjustment | P documented sampled colors, smoothing, spread, room fill | GPU effects, source analysis | Actual source-derived colors; no fabricated missing-source glow | Not started; control disabled. Brightness/saturation per surface implemented |
| Generated visuals, notes, recipe panels, timers, target game | P documented; U expands clock/effects target | Procedural/text renderer, clock model | Controls and saved state work, no executable untrusted code | Partial. Gradient, calibration grid and elapsed clock implemented. Notes, recipes, countdown timers and game pending |
| AI-authored programs | P documented sandbox/offstage testing; no implementation inspected | Isolation, resource limits, provider | Validated and tested artifacts; rollback; no privilege escape | Not started |
| Named setups, save/load | F code; P documented compositions | Versioned schema, atomic persistence | Reload preserves geometry and settings; invalid file rejected | Implemented. Windows smoke: saved project and media grant restored after restart. Named-setup UI not automated |
| Portable projects with media | U; P says compositions do not package media | Export/import manifest and media copy | Move package between machines without absolute paths | Implemented in code (failed exports roll back the media folder). Not runtime-tested across machines |
| Two windows, fullscreen, display choice | F code; P host code | Electron output lifecycle | Studio focus/panels do not recreate output or exit fullscreen | Implemented. Windows smoke, single built-in display: stable output identity, fullscreen survives studio focus, windowed toggle, close/reopen. Projector, multi-display and macOS pending |
| Blackout | F code; U | Immediate operation path | Immediate black while media clock continues | Implemented. Windows smoke: immediate, and video keeps advancing underneath |
| Disconnect/reconnect | U; reference behavior unverified | Display event policy | No accidental projection onto laptop; explicit recovery | Implemented (hide + blackout, explicit reopen); pure policy unit-tested. Physical disconnect not tested |
| Draft/applied/saved and Live/Preview modes | U; P inspected host mutates scene and queues saves | Transactional controller | Save failure leaves applied output intact; clear status and switch resolution | Implemented. Unit tests plus Windows smoke staging/Apply & Save |
| Undo/redo | U; P documents object-edge undo | Bounded history | Undo/redo respects staging and locking | Implemented; unit-tested for mode awareness and locking |
| AI command assistant and memory | P documented; host command routing inspected | Provider, secret storage, validated command API | Draft-only in Preview; cannot invoke Apply implicitly | Not started; drawer explains it is unavailable. Validated command boundary exists |
| Room/3D visualization | P documented simulated room/projectors/viewpoint | Three.js scene, calibrated coordinate model | Clearly separate simulation from physical measurement | Not started; control disabled |
| Kinect, scan/replay, calibration | P documented demo/replay/prototype; physical verification pending | Hardware helper, fixtures, real device tests | Identify generated/replayed/live data; measured calibration error | Not started; hardware unavailable; control disabled |
| Curved/slow-moving object mapping | P documented experimental workflow; not qualified | Calibration, depth segmentation, tracking | Physical accuracy and latency measured; loss-of-track handling | Not started |
| Sequencing/live slots | F code | Cue clock and transitions | User confirms need before prioritization | Deferred by user; scope decision to confirm |
| Diagnostics and preview quality | F code for preview quality/FPS; P documented bounded transport | Timing counters, profiling fixtures | Report measured frame pacing/drop counts by source type | Partial. Preview fps, frames over 25 ms and decoder drops shown in studio. Output renderer probe measured once on Windows (local video, windowed). Capture/YouTube profiling not applicable yet |

## Independent design decisions

Use JSON with strict bounded validation instead of executable configuration formats. Use direct HTML media textures for local media, with a stable registry in each renderer; no per-frame IPC. Separate preview/output decoders are acceptable for this milestone but are not frame-locked. Operational playback and blackout are immediate; media configuration and geometry are scene edits. No reference implementation is considered a security or performance specification.
