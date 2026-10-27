# Third-party software

HECTOR contains no code, assets, or Git history from the reference projects ([adknate05/projection-mapper](https://github.com/adknate05/projection-mapper), [v-prgmr/FREEkMapper](https://github.com/v-prgmr/FREEkMapper)). They were studied for behavior only; see [FEATURE_PARITY.md](FEATURE_PARITY.md).

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
