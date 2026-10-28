# Third-party software

HECTOR contains no code, assets, or Git history from [v-prgmr/FREEkMapper](https://github.com/v-prgmr/FREEkMapper), and none from [adknate05/projection-mapper](https://github.com/adknate05/projection-mapper) except the ambient backlight code below. Both were otherwise studied for behavior only; see [FEATURE_PARITY.md](FEATURE_PARITY.md).

## Code used with permission

**Ambient backlight, by adknate05.** Supplied on this repository's `codex/nate-projection-mapper` branch, commit `912f609aabfaef130c6e5b52e07747e9b01d0460`. Its Git history was not merged. The repository owner explicitly authorized reusing this code for HECTOR's ambient backlight on 2026-10-28. The branch has no license file, and the reused files carry no license or copyright notice, so there was no notice to carry over. Attribution is recorded here and in a header in every adapted file.

| HECTOR file | Original file | Changes |
|---|---|---|
| `src/ambient/activePicture.ts` | `src/shared/activePicture.ts` | Import paths only |
| `src/ambient/colorContinuation.ts` | `src/shared/colorContinuation.ts` | Import paths only |
| `src/ambient/lightColor.ts` | `src/shared/lightColor.ts` | Import paths only. Its sRGB transfer and Oklab matrices follow [Björn Ottosson's published Oklab definition](https://bottosson.github.io/posts/oklab/), as the original comment notes |
| `src/ambient/backlight.ts` | `src/shared/backlight.ts` | Removed the YouTube-player rectifier, edge helper and bridge types, room fill, and the settings validator; HECTOR's scene schema validates the same limits |
| `src/ambient/lightField.ts` | `src/shared/lightField.ts` | Room fill removed; with room fill at 0 the math is unchanged |
| `src/ambient/field.ts` | `src/backlightField.ts` | The module-level store became a per-instance class; the fade rule is exported as `fade()` |
| `tests/ambient.test.ts` | `tests/backlight.test.ts`, `tests/active-picture.test.ts` | The pure-algorithm tests, with assertions unchanged; the runner changed from `node:test` to Vitest |

HECTOR's own code drives it: GPU sampling and glow compositing (`src/render/ambient.ts`), the worker wrapper (`src/ambient/processor.ts`, `src/ambient/worker.ts`) and the UI. The original canvas-2D compositor was reimplemented in HECTOR's WebGL renderer with the same linear-light screen blend. Nothing else from that branch is used: not its YouTube player, agent, Kinect, room or cloud code.

## Online services

YouTube sources load YouTube's official IFrame Player API (`https://www.youtube.com/iframe_api`) and the embedded player from `youtube-nocookie.com` at run time. Nothing from YouTube is bundled or downloaded. Use is subject to YouTube's Terms of Service and the YouTube API Services Terms; see [ARCHITECTURE.md](ARCHITECTURE.md#youtube-sources).

HECTOR bundles no third-party fonts, images, or media. The smoke test generates its own video fixture at runtime.

## Runtime dependencies (shipped)

| Package | Version | License |
|---|---|---|
| [Electron](https://github.com/electron/electron) (includes Chromium, Node.js, FFmpeg; see `LICENSES.chromium.html` in the Electron distribution) | 45.0.0 | MIT |
| [React](https://github.com/facebook/react) | 19.3.1 | MIT |
| [React DOM](https://github.com/facebook/react) | 19.3.1 | MIT |
| [Zod](https://github.com/colinhacks/zod) | 4.6.7 | MIT |

## Build and test tools (not shipped)

| Package | Version | License |
|---|---|---|
| Vite | 8.3.5 | MIT |
| esbuild | 0.28.x | MIT |
| TypeScript | 5.9.3 | Apache-2.0 |
| Vitest | 5.0.5 | MIT |
| Playwright (`@playwright/test`) | 1.64.x | Apache-2.0 |
| electron-builder | 26.18.0 | MIT |

Exact resolved versions, including transitive dependencies, are in `package-lock.json`. Codec availability depends on the FFmpeg build shipped with Electron; proprietary codec licensing for distribution must be reviewed before release.
