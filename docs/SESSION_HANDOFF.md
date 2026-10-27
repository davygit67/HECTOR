# HECTOR session handoff — 2026-10-27 (session 2)

## Last working milestone

**M1 basic mapper runs on Windows.** `npm.cmd run check` (14 tests, typecheck, build) and `npm.cmd run smoke` (real Electron windows, local video on output) pass on Windows 11. Nothing is verified on macOS, projectors, multiple displays, or as an installer. This is not the completed first release; the remaining scope is in [ROADMAP.md](ROADMAP.md) and [FEATURE_PARITY.md](FEATURE_PARITY.md).

## Prompt for the next session

```text
Continue building HECTOR in this repository from the existing work on branch feat/hector-studio. Read AGENTS.md, docs/SESSION_HANDOFF.md, docs/ARCHITECTURE.md, docs/FEATURE_PARITY.md, docs/ROADMAP.md and docs/QUALIFICATION.md first. Inspect Git status and preserve existing work. M1 runs on Windows (check + smoke pass). Next: run check/smoke on macOS or CI; extend smoke coverage (images, loop/speed/volume, relink, setups, portable export/import, crop/mask pixel tests); then start M2 per ROADMAP. Never copy reference code. Keep docs honest about what is verified and on which platform.
```

## What this session did

1. **Diagnosed the launch "failure".** Electron 45 downloads its binary lazily on first resolution (`node_modules/electron/install.js` via `@electron/get`). The earlier 30 s timeout covered that download. The binary is now present. `npm run electron:install` (also run automatically as `presmoke`, and in CI) provisions it explicitly. Launch timeout raised to 120 s.
2. **Fixed the smoke harness.** The brand locator never matched (`H HECTOR STUDIO`). Output was found by window title, but the HTML `<title>` renamed both windows, so the lookup returned `undefined === undefined`. Titles are now pinned in main (`page-title-updated` prevented), and output is identified by its `output=1` URL with a non-null assertion.
3. **Real bug: imported media could not reach the GPU.** WebGL rejected every video/image upload because `hector-media://` responses were cross-origin to the page. Elements now load with `crossOrigin='anonymous'` and the protocol adds `Access-Control-Allow-Origin: *`. Upload errors now include the browser message.
4. **Fixed the review risks from session 1:**
   - Stale `loadedmetadata` config: entries now hold their latest source/transport.
   - Output ready-to-show/disconnect race: a late ready event won't reveal output on a missing display.
   - Asset grant lifetime: grants are pruned against draft, applied, saved and undo/redo history.
   - Size guard: file size is now checked with `stat` before reading.
   - Portable export: a failed export removes its unique media folder.
5. **Added `window.hectorProbe()`.** It is a read-only renderer measurement: the last 600 frame intervals plus per-source decoder generation, time, paused, ready state and drops.
6. **Expanded the smoke test** (see [QUALIFICATION.md](QUALIFICATION.md) for every check):
   - It records an 8 s VP8 WebM in Chromium and inserts a WebM Duration element so the clip is seekable.
   - It imports the clip through a stubbed main-process dialog.
   - It verifies staged-until-Apply, playback with changing pixels, decoder/clock continuity across geometry+effects Apply and UI activity, blackout with the clock running, pause/seek, fullscreen surviving studio focus, output close/reopen, and restore after restart.
7. **Added unit tests:** asset reachability (applied plus history keeps grants; discard releases them) and oversized project rejection.
8. **Docs written or updated:** README, ARCHITECTURE, ROADMAP, THIRD_PARTY, QUALIFICATION, and parity statuses with evidence.

## Checks performed (Windows 11 Home 10.0.26200, Node 24.14.0, Electron 45.0.0, one built-in display)

- `npm.cmd run check`: 14/14 tests pass; typecheck and build pass.
- `npm.cmd run smoke`: PASS. Output pacing sample (windowed, 120 Hz panel, last 180 frames): mean 8.33 ms, p99 8.9 ms, 0 intervals > 25 ms. 20 decoder-dropped frames over the whole run, cause not analyzed.
- Screenshots inspected (`artifacts/`, ignored): warp, texture orientation, and opacity render correctly on output.
- `electron-builder --dir`: succeeded (unsigned, default icon). The packaged `HECTOR.exe` launched and rendered (`app.isPackaged` true). The NSIS installer was not built.
- Dev path (Vite on 127.0.0.1:5173 + Electron with `HECTOR_DEV_URL`): studio rendered with no console errors.

## Known gaps / risks

- **No macOS evidence.** CI is configured for both OSes but has never run (nothing pushed).
- **No physical hardware.** Projector, second display, real disconnect/reconnect, and sleep/wake are untested.
- **Not runtime-tested yet:** image sources, loop/speed/volume, relink, named-setup recall, open/export portable (native dialogs), crop/mask pixels, rotate/scale buttons, corner dragging.
- **Media limits:**
  - Videos without duration metadata ignore seek.
  - Transport is global to all sources.
  - Preview and output decoders are not frame-locked.
- **`hector-media` CORS is `*`.** This is acceptable because only HECTOR's own non-navigable pages can request the scheme, but revisit it if any remote content is ever loaded.
- **Unsigned.** Signing and notarization were never performed.
- **Commits:** see the Git section below for what was committed this session.

## Commands

```powershell
npm.cmd ci
npm.cmd run electron:install
npm.cmd run check
npm.cmd run smoke
npm.cmd run dev      # development launch (dev-URL path verified on Windows)
npm.cmd start        # production build + launch
```

Use `npm` on macOS.
