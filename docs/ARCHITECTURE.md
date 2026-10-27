# HECTOR architecture

HECTOR is an Electron desktop app with two renderer windows (Studio and Output) and one authoritative main process. This document describes the code as it exists on `feat/hector-studio`. Verification status lives in [FEATURE_PARITY.md](FEATURE_PARITY.md) and [QUALIFICATION.md](QUALIFICATION.md).

## Layers and ownership

| Responsibility | Files | Owns |
|---|---|---|
| Desktop lifecycle, displays, files, permissions, IPC | `electron/main.ts`, `electron/preload.ts`, `electron/persistence.ts`, `electron/output-policy.ts` | Windows, display selection, blackout, transport clock, asset grants, disk I/O |
| Studio interface | `src/main.tsx`, `src/style.css` | Selection, panels, drag gestures, dialogs. It never renders frames |
| Scene model, validation, commands, undo/redo | `src/core/model.ts`, `src/core/session.ts` | Zod schemas, `reduceScene`, the `SceneSession` draft/applied/saved authority |
| Media and playback | `src/media/registry.ts` | One stable element per source per renderer, decoder lifetime, transport sync |
| GPU rendering | `src/render/renderer.ts`, `src/render/geometry.ts` | WebGL program, projective warp, compositing, textures, frame measurements |
| AI and hardware adapters | — | Not implemented. Must enter through `commandSchema` and `SceneSession` |

## State flow

```
Studio UI ──request()──► main: requestSchema.parse ─► authorize(sender, mainFrame)
                                     │
                                     ▼
                             SceneSession (draft / applied / saved, history)
                                     │ broadcast(snapshot)
                    ┌────────────────┴────────────────┐
                    ▼                                 ▼
          Studio renders snapshot.draft     Output renders snapshot.applied
```

- **Main owns state.** Renderers receive full snapshots over `hector:state` and send typed requests over `hector:request`. Every request is parsed by a strict Zod union. Writes are accepted only from the Studio window's main frame. Output may read snapshots but cannot mutate anything.
- **Draft, applied, saved.** `SceneSession.update` changes only `draft` in Preview mode, and both `draft` and `applied` in Live mode. `save(apply)` validates, persists, and only then updates `saved` and `applied`. A thrown persist leaves both untouched. `switchMode('live')` with pending changes requires an explicit `apply` or `discard` resolution; `cancel` keeps the current mode. Undo/redo walks a bounded 100-entry history and mirrors into `applied` only in Live mode.
- **Operational controls are immediate.** `blackout` and `transport` (play/pause/seek) bypass the file-operation lock and the draft. They affect the running session, are not part of the scene, and are not saved. Loop, speed and volume are per-source scene settings, so they are staged in Preview mode.

## Rendering

- Each window creates one `ProjectionRenderer` on mount and keeps it for the window's lifetime. React calls `update(scene, assets, transport)` when a snapshot changes. That only stores the scene and reconciles media. Frames are driven by the renderer's own `requestAnimationFrame` loop, not by React.
- Each surface is drawn as two triangles. The fragment shader applies the inverse homography from `inverseQuad`, then discards outside the unit square and outside the ellipse mask. It then applies crop, samples the source (texture, gradient, or grid), adjusts saturation and brightness, and blends with opacity. Surfaces composite in array order, bottom to top.
- Textures are keyed by media identity (`kind:asset:url`). Geometry, effects, crop and order changes do not change identity, so they reuse the existing element and texture. A video texture is re-uploaded only when `requestVideoFrameCallback` marks a new decoded frame.
- Preview resolution scales with the studio's quality setting (0.4/0.65/1.0). Output always renders at full device resolution.
- `window.hectorProbe()` returns read-only measurements: total frames, frames over 25 ms, max interval, the last 600 frame intervals, and per-source decoder state (generation, time, paused, ready state, dropped frames). The smoke test uses it. It is never polled per frame across IPC.

## Media

- Local files are granted only via a native file dialog in main. Main maps a random asset ID to a real path and serves it through the privileged `hector-media://asset/<id>` scheme. The renderer never sees filesystem paths. Responses carry `Access-Control-Allow-Origin: *` so WebGL can sample the frames: the elements load in CORS mode, and without that header the textures would be cross-origin tainted. CSP limits `media-src`/`img-src` to that scheme, and only HECTOR's own non-navigable pages can request it.
- Studio and Output each have their own decoder per source. They share the main transport anchor (`position`, `anchor`, `playing`, `revision`) but are **not frame-locked**. The studio preview is always muted, and new sources start at volume 0, so output is silent until a volume is applied.
- A transport revision change re-seeks to `position + elapsed`. Seeking requires a finite media duration; files without duration metadata (for example raw MediaRecorder WebM) play but ignore seek.
- Delayed media events (`loadedmetadata`) read the entry's latest source and transport, so settings changed while a file loads are not lost.
- Asset grants are pruned after each request. A grant survives while any scene reachable from the draft, applied output, saved project, or undo/redo history references it.

## Windows and displays

- Both windows run with `contextIsolation`, `sandbox`, no Node integration, and denied navigation, `window.open`, webviews, and permission requests. Native titles are pinned (`page-title-updated` is prevented).
- Output is created once and reused. Apply, panels, selection and the AI drawer never recreate it. Escape leaves output fullscreen and focuses the Studio. Closing Output only closes that window; reopening rebuilds it from the applied scene.
- When the selected display disappears, output exits fullscreen, hides, and blacks out (`output-policy.ts`). It is never moved onto the laptop screen. Recovery is explicit: the user reopens output on a display, then restores. A late `ready-to-show` will not reveal a window whose display is gone.

## Persistence

- `current.json` in the user-data `projects` folder holds the last saved scene plus its asset paths. Named setups live in `projects/setups/<name>.json`. Writes go to a unique temporary file and are then renamed. File size is checked with `stat` before reading (4 MB limit), and the document is strictly validated.
- Opening a project or recalling a named setup stages it like any other edit: it stays in the draft in Preview mode and publishes immediately in Live mode. Fresh asset IDs are assigned, so a staged project can never retarget media still used by applied output. Named setups reference local files; only portable export copies media.
- Portable export writes the current draft as `<name>.hector.json` plus a uniquely named sibling `*.hector-media` folder. It neither publishes the draft nor marks it saved. If a copy or write fails, the media folder is removed and nothing is reported as exported.

## Build

Vite builds the renderer into `dist/`. esbuild bundles `electron/main.ts` and `electron/preload.ts` to CommonJS in `dist-electron/`. `scripts/dev.mjs` serves Vite on `127.0.0.1:5173` and launches Electron with `HECTOR_DEV_URL`, which is honored only when unpackaged and exactly equal to that origin. Electron 45 downloads its binary lazily; `npm run electron:install` provisions it ahead of time.
