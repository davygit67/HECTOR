# HECTOR architecture

HECTOR is an Electron desktop app with two renderer windows (Studio and Output) and one authoritative main process. This document describes the code as it exists on `feat/hector-studio`. Verification status lives in [FEATURE_PARITY.md](FEATURE_PARITY.md) and [QUALIFICATION.md](QUALIFICATION.md).

## Layers and ownership

| Responsibility | Files | Owns |
|---|---|---|
| Desktop lifecycle, displays, files, permissions, IPC | `electron/main.ts`, `electron/preload.ts`, `electron/persistence.ts`, `electron/output-policy.ts`, `electron/media-protocol.ts` | Windows, display selection, blackout, transport clock, file and capture grants, disk I/O, media serving |
| Studio interface | `src/main.tsx`, `src/style.css` | Selection, panels, drag gestures, dialogs. It never renders frames |
| Scene model, validation, commands, undo/redo | `src/core/model.ts`, `src/core/session.ts` | Zod schemas, `reduceScene`, the `SceneSession` draft/applied/saved authority |
| Media and playback | `src/media/registry.ts` | One stable element per source per renderer, decoder lifetime, transport sync |
| YouTube sources | `electron/youtube.ts`, `electron/youtube-preload.ts`, `src/core/youtube.ts` | Link parsing, one official player window per source, player status, playback commands |
| Ambient backlight | `src/ambient/` (adknate05's analysis, adapted; see [THIRD_PARTY.md](THIRD_PARTY.md)), `src/render/ambient.ts` | Edge-colour analysis, smoothing and light field (in a worker); GPU sampling and glow compositing |
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

- **Main owns state.** Renderers receive full snapshots over `hector:state` and send typed requests over `hector:request`. Every request is parsed by a strict Zod union. Writes are accepted only from the Studio window's main frame. Output may read snapshots, arm captures its applied scene uses, and send a bounded error report (`hector:report`, at most 16 short strings, only when they change). It cannot mutate anything.
- **Relative edits resolve in main.** Keyboard nudges (`surface.nudge`) and rotate/scale (`surface.transform`) are applied to the authoritative draft, so rapid or held keys never overwrite each other with stale renderer state. Drags send one absolute `surface.update` on release.
- **Draft, applied, saved.** `SceneSession.update` changes only `draft` in Preview mode, and both `draft` and `applied` in Live mode. `save(apply)` validates, persists, and only then updates `saved` and `applied`. A thrown persist leaves both untouched. `switchMode('live')` with pending changes requires an explicit `apply` or `discard` resolution; `cancel` keeps the current mode. Undo/redo walks a bounded 100-entry history and mirrors into `applied` only in Live mode.
- **Operational controls are immediate.** `blackout` and `transport` (play/pause/seek) bypass the file-operation lock and the draft. They affect the running session, are not part of the scene, and are not saved. Loop, speed and volume are per-source scene settings, so they are staged in Preview mode.

## Rendering

- Each window creates one `ProjectionRenderer` on mount and keeps it for the window's lifetime. React calls `update(scene, assets, transport)` when a snapshot changes. That only stores the scene and reconciles media. Frames are driven by the renderer's own `requestAnimationFrame` loop, not by React.
- Each surface is drawn as two triangles. The fragment shader applies the inverse homography from `inverseQuad`, then discards outside the unit square and outside the ellipse mask. It then applies crop, samples the source (texture, gradient, or grid), adjusts saturation and brightness, and blends with opacity. Surfaces composite in array order, bottom to top.
- Lit surfaces (ambient backlight on) draw their glow first, before any surface, so light reaches only the wall around them and never covers projected content. See [Ambient backlight](#ambient-backlight).
- Textures are keyed by media identity (`kind:asset:url`). Geometry, effects, crop and order changes do not change identity, so they reuse the existing element and texture. A video texture is re-uploaded only when `requestVideoFrameCallback` marks a new decoded frame.
- Preview resolution scales with the studio's quality setting (0.4/0.65/1.0). Output always renders at full device resolution.
- `window.hectorProbe` is a read-only measurement API in each window. `snapshot()` returns frame counts and intervals plus per-source decoder state: generation, time, rate, loop, mute, dropped frames, capture liveness. `startTrace()`/`stopTrace()` record a bounded trace (at most 50,000 entries per list) of rAF timestamps, decoded frames, texture uploads with frame age, quality samples and media events. It is used by the tests and `npm run measure`, and is never polled per frame across IPC.

## Media

- Local files are granted only via a native file dialog in main. Main maps a random asset ID to a real path and serves it through the privileged `hector-media://asset/<id>` scheme. The renderer never sees filesystem paths.
- `media-protocol.ts` serves files with real byte ranges: `206` with `Content-Range`, `416` when unsatisfiable, and `Accept-Ranges`. Chromium seeks with range requests. `net.fetch` on `file://` returns the requested bytes with status 200, which made backward seeks land at 0.
- Responses carry `Access-Control-Allow-Origin: *` so WebGL can sample frames from elements loaded in CORS mode, and `Cache-Control: no-store` to keep private media out of the HTTP disk cache. CSP limits `media-src`/`img-src` to the scheme, and only HECTOR's own non-navigable pages can request it.
- Studio and Output each have their own decoder per source. They share the main transport anchor (`position`, `anchor`, `playing`, `revision`) but are **not frame-locked**. The studio preview is always muted, and new sources start at volume 0, so output is silent until a volume is applied.
- A transport revision change re-seeks to `position + elapsed`. Seeking requires a finite media duration; files without duration metadata (for example raw MediaRecorder WebM) play but ignore seek.
- Delayed media events (`loadedmetadata`) read the entry's latest source and transport, so settings changed while a file loads are not lost.
- Asset grants are pruned after each request. A grant survives while any scene reachable from the draft, applied output, saved project, or undo/redo history references it.

## Screen and window capture

- **Picker.** The Studio opens an in-app picker. Main lists sources with `desktopCapturer.getSources` and excludes HECTOR's own Studio and Output windows. Picking one creates a session-only capture grant: a random `captureId` → `{desktopId, name, kind}`. The OS source ID never leaves main. The scene stores only `kind: 'capture'` and the `captureId`.
- **Starting a stream.** A renderer calls `armCapture(captureId)`. Main accepts only captures used by the scene that window renders: the Studio's draft, or Output's applied scene. The renderer then calls `getDisplayMedia` (video only), with up to 30 fps for the preview and 60 fps for output. Main grants the `display-capture` permission only to an armed Studio or Output main frame. The display-media handler hands over exactly the armed source and refuses everything else. Arm and request pairs are serialized per window.
- **Lifetime.** Each window owns its own stream, like media decoders. Draft edits never touch Output's stream, and grants stay alive while any reachable scene references them. A track that ends (window closed, display gone) is reported: Output sends it to main and the Studio shows "Output: Capture ended …". The surface renders black.
- **No resume after restart.** Grants are not resumed after a restart or in imported projects; the source shows as not connected until the user picks again. *Change capture source* stages a fresh grant like a relink.
- **Limits.** Transport, loop, speed and volume do not apply to captures, and there is no audio. On macOS the app needs Screen Recording permission; this is untested (see [QUALIFICATION.md](QUALIFICATION.md)).

## YouTube sources

- **Why a window, not an element.** YouTube plays only in its official player, a cross-origin iframe, whose pixels a page cannot read into WebGL. Downloading the stream would breach YouTube's terms. So each YouTube source gets a visible window running the official IFrame Player API, and Studio and Output mirror that window through the same armed `getDisplayMedia` path used for window capture. No pixels cross IPC, and nothing is downloaded.
- **Links.** `parseYouTubeLink` accepts watch, `youtu.be`, embed, Shorts, live and `youtube-nocookie` links, an optional `t`/`start` offset, or a bare ID. It rejects playlists, channels and other hosts with specific messages. Main parses again on `youtube.add`. The scene stores only `kind: 'youtube'`, the 11-character `videoId` and `start`, so projects, setups and undo carry no URL and no grant.
- **Players.** `YouTubePlayers` keeps exactly one player window per `playerKey` (source, video, start) in the draft or applied scene. Removing a draft source never closes a player that applied output still uses. Players start at `start` and are re-created on restart from the scene alone. Player windows are excluded from the capture picker.
- **Isolation.** Players use their own in-memory session (`hector-youtube`) that denies every permission, download, navigation, webview and new window; YouTube links open in the system browser. The page is served from the `hector-player://` scheme with a strict CSP that allows only YouTube's API, player and image hosts. Its preload exposes just `report` and `onCommand`, and main validates every report with Zod and checks its sender and frame. YouTube requires an embedding client identity, so requests to YouTube hosts carry `Referer: https://app.hector.studio/`, matching the app ID. Without it, embeds fail with error 153.
- **Control.** Main pushes desired state (play, pause, seek, rate, volume, mute, loop) only when it changes, never per frame. The player follows the transport: play, pause, and seek to `start + position × speed`. It is not frame-locked to local media. Rate snaps to YouTube's 0.25×–2× steps. Sound comes from the player window: it is muted unless the source is in the applied scene, its volume is above 0, and the output is open.
- **Status and errors.** Player state (loading, playing, paused, buffering, ended, minimized, closed, error), title and duration reach the Studio in snapshots. IFrame API error codes become plain messages; YouTube also answers 150 for unknown videos, so that message names both causes. A missing API script means the network is down, and no ready signal within 25 s is a timeout. Errors and closed players blank the surface; loading and paused players do not.
- **Limits.** A minimized player window cannot be captured, so its surfaces keep the last frame; the Studio says so. The player's own overlays (title, ads, captions chosen by YouTube) are part of what is projected. On macOS, mirroring needs Screen Recording permission, as for capture (untested). Videos that need sign-in, age verification or DRM, or whose owners disable embedding, do not play.

## Ambient backlight

- **Settings.** `surface.ambient` (optional, so older projects load without light) holds `enabled`, `intensity`, `spread`, `smoothingMs`, `toneProfile`, `opacity` and `vibrance`, validated with the limits of adknate05's implementation. It is a scene edit: staged in Preview, immediate in Live Edit, and covered by undo, save, setups and export.
- **Sampling.** Each renderer samples its own frames; Studio and Output never share light. At most one lit surface per frame, at most about 15 Hz per surface, is drawn into a 96×54 target with crop, brightness and saturation, exactly as the surface shows it, for every source type, generators included. On WebGL2 (the default) the readback goes through a pixel buffer and a fence and is collected a later frame, so it never stalls the GPU; WebGL1 falls back to a synchronous 20 KB read. A still image is sampled until its letterbox settles, then only when it or its look changes.
- **Analysis.** A Web Worker per renderer runs adknate05's pipeline: letterbox detection, 100 edge colour zones in seam and diffusion bands, highlight clamping, contour continuation, Oklab smoothing with cut detection, tone profiles, and a light field of at most 224 px. The field is rebuilt only when the smoothed colours, the surface's size or the settings change. If a worker cannot start, the same code runs on the render thread.
- **Compositing.** The field texture is drawn in the surface's own projective space: screen pixels are mapped through the inverse homography, those beyond the vanishing line are rejected, and the result is screen-blended in linear light, as in the original compositor.
- **No fabricated light.** Light exists only while real samples arrive. It holds 350 ms after the last sample and fades out over 650 ms, so a missing, failed or removed source goes dark. Dark edges give dark light. Blackout draws nothing.
- **Live view.** Turning the Studio's Live view off disposes its renderer and with it the Studio's sampling and worker; Output keeps its own.
- **Limits.** The glow follows the quad's edges, not the ellipse mask, and starts at the surface edge even when the source is letterboxed (the colours still come from the picture). Room fill from the original needs a 3D room model and is not included.

## Windows and displays

- Both windows (and YouTube player windows) run with `contextIsolation`, `sandbox`, no Node integration, and denied navigation, `window.open`, webviews, and permission requests. Native titles are pinned (`page-title-updated` is prevented).
- Output is created once and reused. Apply, panels, selection and the AI drawer never recreate it. Escape leaves output fullscreen and focuses the Studio. Closing Output only closes that window; reopening rebuilds it from the applied scene.
- When the selected display disappears, output exits fullscreen, hides, and blacks out (`output-policy.ts`). It is never moved onto the laptop screen. Recovery is explicit: the user reopens output on a display, then restores. A late `ready-to-show` will not reveal a window whose display is gone.

## Persistence

- `current.json` in the user-data `projects` folder holds the last saved scene plus its asset paths. Named setups live in `projects/setups/<name>.json`. Writes go to a unique temporary file and are then renamed. File size is checked with `stat` before reading (4 MB limit), and the document is strictly validated.
- Opening a project or recalling a named setup stages it like any other edit: it stays in the draft in Preview mode and publishes immediately in Live mode. Fresh asset IDs are assigned, so a staged project can never retarget media still used by applied output. Named setups reference local files; only portable export copies media.
- Portable export writes the current draft as `<name>.hector.json` plus a uniquely named sibling `*.hector-media` folder. It neither publishes the draft nor marks it saved. If a copy or write fails, the media folder is removed and nothing is reported as exported.

## Build

Vite builds the renderer into `dist/`. esbuild bundles `electron/main.ts` and `electron/preload.ts` to CommonJS in `dist-electron/`. `scripts/dev.mjs` serves Vite on `127.0.0.1:5173` and launches Electron with `HECTOR_DEV_URL`, which is honored only when unpackaged and exactly equal to that origin. Electron 45 downloads its binary lazily; `npm run electron:install` provisions it ahead of time.
