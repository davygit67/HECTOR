# HECTOR

An independently implemented Windows/macOS projection-mapping studio built with Electron, React, TypeScript, Vite, and WebGL.

**Status: basic-mapper milestone, not a completed release.** On Windows 11, 14 unit tests, the production build, and the desktop smoke test pass. The smoke test launches real Electron windows and plays a local video on the output. macOS, physical projectors, multiple displays, and installers are **not yet verified**. See [docs/QUALIFICATION.md](docs/QUALIFICATION.md).

## Run it

Requires Node 22.12+ (developed on Node 24.14). The first install and the first Electron launch need internet access, because Electron 45 downloads its binary on first use.

Windows PowerShell (use `npm.cmd`; PowerShell may block `npm.ps1`):

```powershell
npm.cmd ci
npm.cmd run electron:install   # provision the Electron binary
npm.cmd run dev                # development: Vite on 127.0.0.1:5173 + Electron
```

macOS: the same commands with `npm`.

| Command | What it does |
|---|---|
| `npm run dev` | Builds the desktop host, serves the UI with hot reload, and launches Electron. Edits to host/preload need a restart. |
| `npm start` | Production build, then launch. |
| `npm run check` | Unit tests, TypeScript, renderer and desktop build. |
| `npm run smoke` | Launches the built app with a throwaway profile and drives both windows (run `npm run build` first). Writes screenshots and frame metrics to `artifacts/`. |
| `npm run package` | electron-builder (NSIS on Windows, DMG on macOS). Unsigned; installers not yet qualified. |

## Using HECTOR

1. **Output:** pick a display at the top right and click **Full screen**. Output is a separate, content-only window. Press **Esc** on it to leave fullscreen.
2. **Media:** under **Media → Import images / videos**, choose PNG, JPEG, WebP, MP4, WebM, MOV or M4V. Which codecs play depends on Chromium. You can also add generators (gradient, calibration grid, elapsed clock).
3. **Surfaces:** under **Layers → +**, add a quad. Drag corners to warp, or drag the surface to move it; Alt-drag gives fine adjustment. Arrow keys nudge the selected corner (Shift moves 10 px). The inspector on the right has Transform, Crop and Effects (opacity, brightness, saturation, ellipse mask).
4. **Editing modes:**
   - **Preview & Apply** (default): edits change only the studio preview. **Apply & Save** validates and saves, then publishes to output. A failed save leaves both the output and your draft as they were. **Discard** reverts the draft to what is on output.
   - **Live Edit:** edits publish immediately; **Save** persists them. Switching to Live with pending changes asks you to Apply, Discard, or Cancel.
5. **Immediate controls:** **Blackout** and play/pause/seek act on output immediately in either mode and are not saved. Blackout leaves playback running. Loop, speed and volume are per-source scene settings, so they are staged like other edits.
6. **Projects:**
   - The last saved state is restored on launch.
   - **Setups** stores named snapshots that reference local files.
   - **Export portable** writes `name.hector.json` plus a sibling `.hector-media` folder; move them together.
   - **Open project** loads either as a draft.

Unavailable today, with controls visibly disabled: screen capture, YouTube/live streams, ambient backlight, AI assistant, 3D room view, Kinect/calibration/object mapping. See [docs/ROADMAP.md](docs/ROADMAP.md).

Known limits:
- Studio preview and output decode separately and are not frame-locked.
- Studio preview is always muted.
- Videos without duration metadata cannot be seeked.
- Transport is global to all sources.

## Documentation

- [AGENTS.md](AGENTS.md): contributor rules.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): process, state, rendering and media design.
- [docs/FEATURE_PARITY.md](docs/FEATURE_PARITY.md): full release scope, reference evidence, current status.
- [docs/ROADMAP.md](docs/ROADMAP.md): milestones and the pending show-sequencing scope decision.
- [docs/QUALIFICATION.md](docs/QUALIFICATION.md): per-platform results and the hardware checklist.
- [docs/THIRD_PARTY.md](docs/THIRD_PARTY.md): dependency attribution.
- [docs/SESSION_HANDOFF.md](docs/SESSION_HANDOFF.md): where the last session stopped.

HECTOR contains no code, assets, or history from the projects it studied ([projection-mapper](https://github.com/adknate05/projection-mapper), [FREEkMapper](https://github.com/v-prgmr/FREEkMapper)).
