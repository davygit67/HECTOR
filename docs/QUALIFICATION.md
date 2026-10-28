# Platform qualification

This document records what has been verified, on which platform and how. Windows and macOS are qualified separately. Mocks, the other platform, and CI runners do not count as interactive or hardware qualification. Outstanding work is tracked in [ROADMAP.md](ROADMAP.md).

## Automated suites

- `npm run check`: unit tests, typecheck, renderer and host build.
- `npm run smoke`: Playwright drives the built app in real Electron windows.
  - Media fixtures are generated at run time: constant-frame-rate VP8 WebM via WebCodecs, and PNGs.
  - Native file dialogs are stubbed in main. Everything else is real: IPC, decoding, GPU compositing, OS capture.
  - Pixels are sampled from screenshots of the projection canvas.

| Area (spec) | What is exercised | Windows 11 | macOS |
|---|---|---|---|
| Staging (`staging.e2e.ts`) | 12 categories of draft edits leave output's applied scene, pixels and decoder untouched until Apply. Apply keeps the decoder and clock. Live switch dialog: Cancel, Discard, Apply | Pass | Not run |
| Media (`media.e2e.ts`) | Video frames update; pause holds; seek lands on target; blackout keeps the clock; speed and volume staged then applied; loop wraps, ends, restarts; image orientation; missing file reported on output; relink (wrong type rejected) | Pass | Not run |
| Pixels (`pixels.e2e.ts`) | Crop (4 forms), ellipse mask, inner and perspective warps, opacity, brightness, saturation, layer order and visibility, preview vs output | Pass | Not run |
| Editing (`editing.e2e.ts`) | Mouse corner drag, surface drag, Alt fine drag, convexity guard, lock, rapid arrow-key nudges, rotate/scale; undo/redo via buttons and shortcuts in Preview and Live | Pass | Not run |
| Projects (`projects.e2e.ts`) | Named setups (validation, Preview vs Live recall, fresh asset grants); portable export, move, reopen, play; export rollback; save/apply failures keep output and draft | Pass | Not run |
| Lifecycle (`lifecycle.e2e.ts`) | Secure preferences; content-only output with hidden cursor; output cannot mutate or arm captures; UI activity never recreates output; fullscreen survives Studio focus; windowed toggle; close/reopen; restart restore | Pass (single display) | Not run |
| Ambient (`ambient.e2e.ts`) | Glow outside each edge takes that edge's source colour (real screenshots) and never covers the picture; staged until Apply; output keeps its glow with Studio Live view off; no glow without frames; undo/redo; generators; follows moved surfaces; settings persist across restart; analysis in a worker with async readback | Pass | Not run |
| YouTube (`youtube.e2e.ts`) | Link validation in Studio and main; player isolation (no bridge, sandbox, navigation locked, excluded from the picker); network-outage error with recovery; draft-only player closed on discard. **Online** (`HECTOR_YOUTUBE_TESTS=1`): real playback mirrored onto a surface; output only after Apply; ambient light from the video; Live view independence; transport pause/play; YouTube's error for an unknown video | Pass (online part run on 2026-10-28) | Not run |
| Capture (`capture.e2e.ts`) | Picker lists windows and screens (HECTOR's own excluded); staged until Apply; projected and cropped pixels; draft removal keeps output's capture live; window closure reported to the Studio and output goes black; reconnect via picker | Pass | Skipped without `HECTOR_CAPTURE_TESTS=1` (needs Screen Recording permission) |

Windows environment (2026-10-27): Windows 11 Home 10.0.26200, Node 24.14.0, Electron 45.0.0, one built-in 120 Hz display at 1646×1029 logical. No projector or second display. Result: 18 unit tests and 15 end-to-end tests pass.

YouTube and ambient branch (`feat/youtube-ambient`, 2026-10-28), same Windows machine: 86 unit tests and 20 end-to-end tests pass, including capture and the online YouTube test. Without `HECTOR_YOUTUBE_TESTS=1`, the online YouTube test is skipped and everything else runs offline.

**Ambient cost** (Windows, same machine, output windowed on the built-in 120 Hz panel, local 1280×720 30 fps clip on a 60%-width surface, 10 s per condition, one run each). Output render-loop intervals were the same with ambient off and on: 1202 frames, p50 8.3 ms, p99 8.8 ms, no intervals over 25 ms, no dropped video frames. In the worker, analysis took about 7.5 ms and the light field about 12 ms per sample, at about 15 samples per second. An earlier build that ran this work on the render thread raised p99 to 16.6 ms, with 4 intervals over 25 ms; that is why the worker exists. This is not a qualification on a projector, a fullscreen output, a slower GPU, or with several lit surfaces.

CI (`.github/workflows/ci.yml`) runs check, smoke and unsigned `dist` on `windows-latest` and `macos-latest` and uploads the installers. **It has never run**, because the branch has not been pushed yet. A green CI run would show the suites work on hosted runners; it would not qualify projectors, real displays or interactive macOS behavior.

## Local video pacing (`npm run measure`)

Method:
- Constant-frame-rate 1280×720 VP8 clips (20 s at 30 and 60 fps), two runs each.
- Output windowed on the built-in 120 Hz panel; the Studio preview decodes the same file at the same time.
- 14 s traced per run, with a seek at 6 s.
- The trace records decoded frames (`requestVideoFrameCallback`), GPU texture uploads, `getVideoPlaybackQuality` every 250 ms, and the render loop's rAF timestamps.
- Phases: startup is the first second after the first frame, seek is the second after the seek, and steady is the rest.

| Clip | Dropped (startup / seek / steady) | Source frames skipped (steady) | Frames reaching the GPU (steady) | Refreshes each frame was held | rAF interval max |
|---|---|---|---|---|---|
| 30 fps, run 1 | 0 / 0 / 0 | 0 | 360 of ~361 | 4: 354, 3: 2, 5: 2 | 9.0 ms |
| 30 fps, run 2 | 0 / 0 / 0 | 0 | 359 of ~360 | 4: 349, 3: 4, 5: 4 | 9.1 ms |
| 60 fps, run 1 | 0 / 0 / 0 | 0 | 718 of ~719 | 2: 644, 1: 36, 3: 36 | 25.0 ms |
| 60 fps, run 2 | 0 / 0 / 0 | 0 | 719 of ~722 | 2: 708, 1: 4, 3: 5 | 16.6 ms |

An earlier batch with the same method recorded 3 startup drops and 1 seek drop in one 60 fps run, and none in steady playback. Frames reached the GPU within one refresh of Chromium's reported presentation time: at most 8.7 ms, measured against a timestamp that Chromium itself sets.

**Interpretation and uncertainty:**
- Steady playback dropped no frames in any measured run.
- Cadence was mostly even. The 1-and-3 pairs at 60 fps are one frame shown early and the next late; they recur and are not explained yet.
- The 20 drops in the earlier smoke run came from a run with several seeks, window transitions and a busy encoder. That run also hit a media-serving bug, since fixed: range requests were answered without `206`, so backward seeks re-read from byte 0. Those causes overlap, so the 20 drops are not attributed to any single one.
- **Not measured yet:** fullscreen output, a projector or second display, real scan-out (needs a photodiode or external capture), H.264/HEVC hardware decode, 4K, long runs, captures and streams.

## Launch paths (Windows)

- **Development** (`npm run dev`): Electron loaded from Vite at `127.0.0.1:5173`; no console errors.
- **Portable zip** (`release/HECTOR-0.1.0-win-x64-unsigned.zip`): extracted outside the repository, it launched packaged (`app.isPackaged`) from its own `app.asar`, imported and played local video.
- **NSIS installer** (`release/HECTOR-0.1.0-win-x64-unsigned-setup.exe`): built, but **not install-tested**. Windows SmartScreen will warn because it is unsigned: choose *More info → Run anyway*.
- **Signing:** none. No Windows Authenticode signing and no macOS Developer ID signing or notarization have been performed.

## Testing on macOS

For a tester with a Mac. Allow about 30 minutes.

**Option A: build from source (most reliable).**
1. Install Node.js 22.12 or newer (24 LTS recommended) and Git. Clone the repository and check out `feat/hector-studio`.
2. In Terminal at the repository root:
   ```
   npm ci
   npm run electron:install
   npm run check            # unit tests + build
   npm run smoke            # drives real windows; capture test is skipped
   npm start                # launch HECTOR
   ```
3. YouTube: paste a link under *Media → YouTube*. Mirroring the player window uses screen capture, so the same Screen Recording permission applies. To run the online test: `HECTOR_YOUTUBE_TESTS=1 npm run smoke`.
4. Screen capture: open *Media → Screen / window capture*. macOS asks for Screen Recording permission, for "Electron" when started with `npm start`. Allow it in *System Settings → Privacy & Security → Screen Recording*, quit HECTOR, then run `HECTOR_CAPTURE_TESTS=1 npm run smoke` and try capture by hand.

**Option B: unsigned build from CI.** Download the `hector-macOS-unsigned` artifact from the GitHub Actions run. Use `-arm64` for Apple Silicon and `-x64` for Intel. The app is only ad-hoc signed and not notarized, so Gatekeeper blocks it:
- Open the DMG and drag HECTOR to Applications.
- Run `xattr -dr com.apple.quarantine /Applications/HECTOR.app`, or open it once and approve it in *System Settings → Privacy & Security → Open Anyway*.
- Screen Recording permission is tied to the app's signature; an ad-hoc build may need it granted again after each update.

Report back: macOS and chip, which option, the full `npm run smoke` output, and results for the checklist below.

## Manual hardware checklist (pending on both platforms)

Use a real projector or second display in **extended desktop** mode, not mirrored. Record the OS, the GPU, and the display or projector model.

- [ ] **Extended desktop:** select the projector in the top bar's display menu and click *Full screen*. Output fills the projector with no cursor or controls, and the Studio stays on the laptop.
- [ ] **Fullscreen while working:** with output fullscreen, edit in the Studio, open panels and the AI drawer, switch to other apps (Cmd/Alt-Tab), and use the dock or taskbar. Output stays fullscreen on the projector and never jumps to the laptop. On macOS, check Spaces and Mission Control.
- [ ] **Preview & Apply vs Live Edit:** in Preview, move corners and change crop, effects and media; the projector must not change until *Apply & Save*. In Live, the same edits appear immediately. Switching to Live with pending edits offers Apply, Discard or Cancel.
- [ ] **Playback continuity:** play a long video. Moving corners, cropping and Apply must not restart it or cause visible hitches. Note any stutter, with the file's codec and resolution.
- [ ] **Disconnect and reconnect:** unplug the projector during playback. Output hides and blacks out, nothing appears on the laptop, and the Studio shows the disconnect. Replug, reselect the display, open output, then *Restore output*.
- [ ] **Sleep and wake:** sleep the laptop with output fullscreen, then wake it. Does output return to the projector? Is playback still running? Is blackout or the disconnect notice shown when needed?
- [ ] **Capture on hardware:** capture a window and a screen, then project and crop them. Close the captured window and confirm the Studio reports it. Never capture the projector's own screen (that creates a feedback loop).
- [ ] **YouTube on hardware:** project a YouTube video fullscreen while editing. Check that the player window can sit behind the Studio or on another display without freezing the projection, and note audio sync against the projected image.
- [ ] **Ambient on hardware:** turn the backlight on for a video surface on the projector. Judge flicker and lag by eye, and check render pacing with several lit surfaces.
- [ ] **Long run:** at least 1 hour with 1080p and 4K H.264 and VP9 files. Watch memory in Task Manager or Activity Monitor and note any visible stutter.
