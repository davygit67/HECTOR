# Feature parity audit

Audit date: 2026-10-27. This is a release scope register, not a claim of complete parity. HECTOR is independently written; no reference code, assets, or history are imported.

## Evidence and confidence

- **P**: [projection-mapper README](https://github.com/adknate05/projection-mapper/blob/main/README.md), blob `22ddacfcb1b76cb3f7a101d52f51b6a8802e95e0`; [desktop host](https://github.com/adknate05/projection-mapper/blob/main/electron/main.ts), blob `aa6b012b85671519091b6c48fb21f23ee9b66ce2`, first 160 lines inspected; package manifest inspected. Access succeeded through connected GitHub. README describes a prototype, including tests performed by its author; these were not independently run.
- **F**: [FREEkMapper](https://github.com/v-prgmr/FREEkMapper) and its [PyPI distribution](https://pypi.org/project/freekmapper/) agree on project identity and author. No second matching projection-mapping project was found. [main.py](https://github.com/v-prgmr/FREEkMapper/blob/main/src/freekmapper/main.py), blob `ecf5eec55c3f2150ef5bd95250b8d2af4b16684e`, and pyproject inspected. Python/Tk editor, OpenGL output, OpenCV media thread, NumPy configuration persistence. No reference app was installed or executed.
- **U**: user's requested HECTOR behavior; not assumed to exist in either reference.

“Code” below means source evidence, not runtime verification. “Documented” means a reference claims the behavior but its implementation has not yet been audited. The advanced P audit remains incomplete; inspect relevant modules before declaring parity. Hardware claims remain unverified even where prototype code exists.

## Scope register

Status vocabulary:

- **Verified (platform):** exercised in the running app on that platform. The evidence and remaining checks are in [QUALIFICATION.md](QUALIFICATION.md).
- **Implemented:** in code, not yet runtime-verified.
- **Partial:** only part of the scope exists.
- **Not started**
- **Deferred:** waiting on a user scope decision.

There is no macOS evidence for any row yet. Next steps live in [ROADMAP.md](ROADMAP.md).

| Feature | Source / reference confidence | Dependencies | Acceptance criterion | HECTOR status |
|---|---|---|---|---|
| Quad creation, corner warp, opacity, rotation | F code; P documented | GPU compositor, command model | Independent corners; stable output under edits; opaque black outside | Verified (Windows) |
| Precise nudge, scale, crop, masks | P documented; U | Geometry validation, inspector | Pixel nudge, bounded crop and masks agree in preview/output | Verified (Windows): nudge, scale, crop, ellipse. Freeform masks not started |
| Layers, groups, collapsing, visibility, locking | P documented for layers/visibility/opacity; groups unverified | Command history, editor | Reorder and group without changing media identity; locked objects cannot move | Partial: order, visibility, lock verified (Windows); groups are labels, not transforms |
| Local image/video, play/pause/seek/loop/speed/volume | F code for files/concurrent playback; P documented | Media registry, runtime clocks | Each control works; geometry apply never restarts unchanged media | Verified (Windows) |
| Missing media relink | U; reference implementation unverified | File grants, persistence | Missing media reported; relink repairs references | Verified (Windows) |
| Screen/window capture and crop | U; P explicitly uses owned browser capture for normal YouTube, not desktop capture | OS permission flow, direct GPU transport | Select source, crop, stop/reconnect; qualify both OSes | Verified (Windows); macOS permission flow untested; no audio |
| YouTube and live content | P documented normal watch-page worker and static iframe fallback | Sandboxed source adapter; service restrictions | Real playback, consent isolation, bounded transport, measured timing | Not started; control disabled |
| Ambient/backlight, color adjustment | P documented sampled colors, smoothing, spread, room fill | GPU effects, source analysis | Actual source-derived colors; no fabricated missing-source glow | Not started; control disabled |
| Generated visuals, notes, recipe panels, timers, target game | P documented; U expands clock/effects target | Procedural/text renderer, clock model | Controls and saved state work, no executable untrusted code | Partial: gradient, grid, elapsed clock |
| AI-authored programs | P documented sandbox/offstage testing; no implementation inspected | Isolation, resource limits, provider | Validated and tested artifacts; rollback; no privilege escape | Not started |
| Named setups, save/load | F code; P documented compositions | Versioned schema, atomic persistence | Reload preserves geometry and settings; invalid file rejected | Verified (Windows) |
| Portable projects with media | U; P says compositions do not package media | Export/import manifest and media copy | Move package between machines without absolute paths | Verified (Windows, moved within one machine) |
| Two windows, fullscreen, display choice | F code; P host code | Electron output lifecycle | Studio focus/panels do not recreate output or exit fullscreen | Verified (Windows, single display) |
| Blackout | F code; U | Immediate operation path | Immediate black while media clock continues | Verified (Windows) |
| Disconnect/reconnect | U; reference behavior unverified | Display event policy | No accidental projection onto laptop; explicit recovery | Implemented; physical test pending |
| Draft/applied/saved and Live/Preview modes | U; P inspected host mutates scene and queues saves | Transactional controller | Save failure leaves applied output intact; clear status and switch resolution | Verified (Windows) |
| Undo/redo | U; P documents object-edge undo | Bounded history | Undo/redo respects staging and locking | Verified (Windows) |
| AI command assistant and memory | P documented; host command routing inspected | Provider, secret storage, validated command API | Draft-only in Preview; cannot invoke Apply implicitly | Not started; drawer explains |
| Room/3D visualization | P documented simulated room/projectors/viewpoint | Three.js scene, calibrated coordinate model | Clearly separate simulation from physical measurement | Not started; control disabled |
| Kinect, scan/replay, calibration | P documented demo/replay/prototype; physical verification pending | Hardware helper, fixtures, real device tests | Identify generated/replayed/live data; measured calibration error | Not started; hardware unavailable |
| Curved/slow-moving object mapping | P documented experimental workflow; not qualified | Calibration, depth segmentation, tracking | Physical accuracy and latency measured; loss-of-track handling | Not started |
| Sequencing/live slots | F code | Cue clock and transitions | User confirms need before prioritization | Deferred: scope decision to confirm |
| Diagnostics and preview quality | F code for preview quality/FPS; P documented bounded transport | Timing counters, profiling fixtures | Report measured frame pacing/drop counts by source type | Partial: local-video pacing measured windowed (Windows); capture/stream profiling pending |

## Independent design decisions

Use JSON with strict bounded validation instead of executable configuration formats. Use direct HTML media textures for local media, with a stable registry in each renderer; no per-frame IPC. Separate preview/output decoders are acceptable for this milestone but are not frame-locked. Operational playback and blackout are immediate; media configuration and geometry are scene edits. No reference implementation is considered a security or performance specification.
