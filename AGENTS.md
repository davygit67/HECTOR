# HECTOR contributor instructions

Applies to the whole repository. The user's current instructions win on conflict.

## Scope

- HECTOR is an independently implemented Windows/macOS projection-mapping app (Electron, React, TypeScript, Vite, WebGL). The first release is the full scope in `docs/FEATURE_PARITY.md`. The basic mapper is only a milestone. Never silently drop scope.
- `docs/ROADMAP.md` is the single list of outstanding work, blockers and next steps. Update it instead of writing handoff notes, and don't log completed work that Git already records.
- [projection-mapper](https://github.com/adknate05/projection-mapper) and [FREEkMapper](https://github.com/v-prgmr/FREEkMapper) are behavioral references only. Never copy, fork, merge, import or clone their code, assets or history.
  - One exception, authorized by the repository owner: the ambient backlight code in `src/ambient/` is adapted from adknate05's code on the `codex/nate-projection-mapper` branch, with attribution. See `docs/THIRD_PARTY.md`. The exception covers that supplied code only, not the rest of that branch and not third-party code.

## Workflow

- Inspect `git status` first and preserve unrelated work. Work on a feature branch, never directly on `main`. Never force-push.
- Keep every milestone runnable. Make reasonable decisions; ask only when genuinely blocked.
- Before calling work done, run `npm run check` and `npm run smoke` and fix failures.
- Commit coherent changes after inspecting the staged diff. Exclude credentials, private media, local profiles and build output.
- End a session by reporting: what works, what was tested on which platform, what is incomplete or blocked, and the exact launch command.

## Architecture constraints

See `docs/ARCHITECTURE.md`. Non-negotiable:

- Keep these separate: the Electron host (lifecycle, displays, files, permissions, IPC), the React studio UI, the serializable scene model with its commands and undo, media sources and clocks, the GPU renderer, and optional AI/hardware adapters.
- React never drives frames. UI activity (selection, panels, AI) must not recreate the output window, reset playback, or rebuild unchanged media or captures. No per-frame IPC or JPEG/base64 frame transport. Preview and output quality are independent.
- The main process owns draft, applied and saved state:
  - **Preview & Apply:** edits stay in the draft. Apply & Save validates and persists before publishing; if that fails, output and draft both stay as they were.
  - **Live Edit:** edits publish immediately. Switching to Live with pending changes requires Apply, Discard or Cancel.
  - Undo/redo obey the active mode.
  - Draft edits must never release media or captures used by applied output.
  - AI uses the same validated commands and never bypasses Apply.
- Blackout and play/pause/seek are immediate operational controls, distinct from staged scene edits.

## Desktop security

- `contextIsolation`, `sandbox`, no `nodeIntegration`. IPC is narrow and Zod-validated. Check the sender window and main frame; only the Studio may mutate state.
- Secrets and filesystem paths stay in main. Media files and screen captures are reachable only through explicit user grants (file dialog, capture picker).
- Deny navigation, new windows, webviews and any permission not tied to a granted workflow.
- Output is a separate content-only window: no controls or cursor. Studio focus must not exit its fullscreen, and a display disconnect hides it rather than moving it.

## Honesty

- No controls that pretend to work. Unavailable features stay disabled with an explanation.
- Qualify Windows and macOS separately. Mocks, simulations and CI are not interactive or hardware qualification. Record results in `docs/QUALIFICATION.md`.
- Make no performance claims without measurements. Signing, notarization and hardware checks stay "pending" until actually performed.

## Commands

Node 22.12+. In Windows PowerShell use `npm.cmd`.

```
npm ci                      # install
npm run electron:install    # fetch the Electron binary (first run)
npm run dev                 # develop: Vite + Electron
npm run check               # unit tests, typecheck, build
npm run smoke               # drive the built app (after check/build)
npm start                   # production build + launch
npm run dist                # unsigned installers/archives into release/
```
