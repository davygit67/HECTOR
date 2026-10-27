# Platform qualification

Record results per platform. Windows and macOS are qualified separately. Results from mocks or the other platform do not count.

## Automated (`npm run smoke`)

| Check | Windows 11 (2026-10-27) | macOS |
|---|---|---|
| Studio launches; native titles stable | Pass | Not run |
| Output content-only (no controls), cursor hidden | Pass | Not run |
| Preview edits stay out of output until Apply & Save | Pass | Not run |
| Output window cannot send privileged requests | Pass | Not run |
| contextIsolation / sandbox / no nodeIntegration on both windows | Pass | Not run |
| Imported local video absent from output until applied | Pass | Not run |
| Output decodes and plays local WebM; projected pixels change | Pass | Not run |
| Geometry + effects Apply, AI drawer, panel switches: same decoder generation, clock advances, same output window | Pass | Not run |
| Blackout immediate; media clock continues | Pass | Not run |
| Pause holds; seek lands on target (finite-duration file); resume | Pass | Not run |
| Output fullscreen survives Studio focus; windowed toggle keeps window | Pass (single display) | Not run |
| Output close/reopen restores applied scene and video | Pass | Not run |
| Restart restores saved scene and reopens media | Pass | Not run |
| No renderer page/console errors | Pass | Not run |

Windows environment: Windows 11 Home 10.0.26200, Node 24.14.0, Electron 45.0.0, one built-in display (1646×1029 logical), no projector attached.

### Measured output frame pacing (Windows, smoke run)

Output windowed on the built-in display, playing an 8 s 320×180 VP8 WebM. These are the last 180 frame intervals from the output renderer:

| Mean | p95 | p99 | Max | Intervals > 25 ms | Decoder dropped frames (whole run) |
|---|---|---|---|---|---|
| 8.33 ms | 8.70 ms | 8.90 ms | 9.00 ms | 0 | 20 |

This is one short sample on one machine (a 120 Hz panel). It says nothing about projector output, fullscreen, high-resolution video, capture, or streams. Decoder drops were counted across the whole run, which includes fixture recording and window changes; their cause has not been analyzed. Raw numbers are written to `artifacts/smoke-metrics.json` (ignored by Git).

## Launch paths (Windows, 2026-10-27)

- Dev server path: Electron loaded `http://127.0.0.1:5173/` with `HECTOR_DEV_URL`, the studio rendered, and there were no console errors.
- Unpacked package: `electron-builder --dir` produced `release/win-unpacked/HECTOR.exe`, unsigned with the default Electron icon. It launched with `app.isPackaged === true`, and the studio rendered frames. The NSIS installer itself has not been built or installed.

## Manual hardware checklist (pending on both platforms)

- [ ] Second display/projector selected by name; output opens on it and goes fullscreen.
- [ ] Studio click/focus on the laptop does not exit projector fullscreen (macOS: separate Space behavior).
- [ ] Unplug projector during playback: output hides and blacks out, nothing appears on the laptop; replug, reopen, restore.
- [ ] Display resolution/scale change while output is fullscreen.
- [ ] Sleep/wake with output open.
- [ ] Long run (≥ 1 h) with 1080p and 4K H.264/VP9 video: memory stable, pacing measured fullscreen.
- [ ] Native file dialogs: import, relink, open, export portable, then move the package to another machine.
- [ ] Packaged app (`npm run package`): installer runs; app launches outside the dev tree.
- [ ] Signing (Windows) and signing + notarization (macOS): **pending; never performed**.
