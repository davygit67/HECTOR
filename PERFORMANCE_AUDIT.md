# Projection Mapper performance and quality audit

October 15, 2026. Scope: the existing React studio, local media, official YouTube player, native capture, transport, composition and output. Uses the engineering tech-debt prioritization framework. No root dependencies, saved scenes, agent contracts or delivered Windows packages were changed.

## Decision

Keep React as the control interface. The main YouTube bottleneck is full-frame CPU transfer and JPEG encoding, not React's choice of language. Build a lossless GPU output path first, retaining the official YouTube player. A dedicated native/OpenGL renderer is a reasonable local-file output backend, provided it reads files directly and keeps decoded frames close to the GPU. Sending frames through Python, JSON or React would recreate the current bottleneck.

**The production GPU/OpenGL replacement is not implemented in this audit.** Its isolated Electron GPU prototype works on this Mac and passes pixel-precision checks. The bounded compatibility and UI improvements below are implemented and built. The running native worker has not been restarted by this task, so its old capture settings must not be described as upgraded live playback.

## Measured evidence

Measurements used silent, generated 1920×1080 fixtures on an Apple M3 Max, macOS arm64, Electron 44.7. They are diagnostic component measurements, not friend-versus-app comparisons, YouTube playback benchmarks or physical projector latency. Runs are short and include ordinary system activity. Reproducible scripts and the recorded results are in `tests/profile-*.cjs` and [the results artifact](tests/fixtures/performance-audit-2026-10-15.json).

| Measurement | Result | What it establishes |
| --- | --- | --- |
| Original CPU frame preparation, repeated in the same comparison run | 18.52ms median /24.35ms p95 | Already exceeds the 16.67ms budget for 60fps before capture readback, network transport, receiver decode and display. Initial run was 17.56/21.17ms; variability is real. |
| Revised preparation, scheduled 30fps | 10.22ms median /18.06ms p95; 12.61ms mean | Less repeated work; 50 analyses for 150 frames. JPEG bytes identical to direct encoding at the existing quality. |
| Revised preparation, scheduled 60fps | 10.06ms median /17.62ms p95; 11.24ms mean | 25 analyses for 150 frames. CPU JPEG remains the dominant cost; this is not consistent 60fps headroom. |
| Actual offscreen bitmap capture + processing | 29.95fps at 30 target; 59.98fps at 60 target | Source-side throughput only. Completion-gap p95 was 43.77ms and 26.11ms respectively: 60fps average does not mean smooth 16.67ms pacing. No receiver/decode/display included. |
| GPU texture → receiver VideoFrame → Canvas prototype | 390/390 frames delivered, about 60.18fps over 6.48s, zero busy drops | Bounded two-frame in-flight transfer works on this Mac. About 60, not a claim of a display running above 60Hz. Receiver gap p95 was 17.40ms. |
| GPU send completion | 0.297ms median /0.364ms p95 | Transfer completion measurement, **not** capture-to-photon latency; separate from the CPU-preparation figures above. |
| GPU precision | 245,760 pixels; zero differing RGBA channels; max error 0 | Exact opaque 8-bit SDR transfer for the test pattern, at 1920×1080. Includes all 256 grayscale levels, saturated colors, one-pixel edges and varied RGB patterns. |
| Real Studio scheduling, isolated scene | 0 idle commits /7 running-timer commits in 900ms /0 expired-timer commits | The studio no longer rerenders continuously just because it is open. |

The synthetic detailed frame produced 316,458 JPEG bytes and 443,987 JSON bytes. At 60fps that is roughly 26.6MB/s of text per source before protocol overhead and client fan-out. The old full/small bitmap reads copy 8,377,344 bytes per frame: roughly 503MB/s at 60fps, before JPEG allocations and receiver decode. These are arithmetic extrapolations of this fixture, not observed network throughput or universal video sizes.

## Quality contract

The new output path must introduce **no additional lossy encode**. Passing a GPU texture/VideoFrame avoids the current JPEG generation. YouTube's already-compressed source remains as supplied by YouTube. This does not restore details absent from its selected stream.

The prototype preserved exact SDR bytes through import, transfer, drawing and readback. Reported frame color space was full-range RGB, BT.709 primaries, sRGB transfer. That establishes this tested case only. Windows adapters/drivers, HDR/10-bit, wide-gamut content, alpha, display color management and physical projector color need separate qualification. Do not label those lossless based on an SDR test.

Keep the source raster at output resolution, avoid intermediate downscaling, preserve color-space/range metadata, and warp/composite once at the final output resolution. Geometric resampling is inherent to projection mapping and is different from transport compression. Lower-resolution editor thumbnails are acceptable only when final output continues to use full-resolution source frames. Existing Fast mode explicitly selects 720p output; it cannot be a hidden quality fallback for a 1080p guarantee.

**JPEG85 remains the existing lossy compatibility transport.** This audit did not lower its quality or add another encode, and the synthetic optimized output matched direct JPEG85 bytes exactly. Raising JPEG to 100 is still lossy and would increase bandwidth/CPU. Replacing it with raw RGBA text would approach 498MB/s per 1080p60 source before copies; that is not the scalable solution. An unsupported GPU backend should be clearly reported and offer an explicit fallback, rather than silently claiming full quality.

Electron documents the GPU-to-CPU copy cost of bitmap offscreen rendering and the alternative shared-texture mode. Its import/send/receiver APIs are experimental, so production needs a small adapter, capability checks and lifetime tests. Our prototype retained sandboxing and context isolation. [Offscreen rendering](https://www.electronjs.org/docs/latest/tutorial/offscreen-rendering), [shared texture API](https://www.electronjs.org/docs/latest/api/shared-texture).

## Concrete diagnosis and fixes delivered

1. **Capture had two caps:** `electron/media-sources.ts` used `setFrameRate(15)` plus a 60ms gate. It now defaults to 30, with explicit `PM_MEDIA_FPS=60` for the CPU compatibility path. This setting changes a ceiling, not the source video's native cadence or achieved display rate. Isolated source tests verified both targets; production end-to-end60 is not established.
2. **Every video frame repeated full analysis:** new `electron/media-frame-processor.ts` separates presentation from at most 10Hz picture/color analysis. The full-resolution detector preserves pixel-precise boundaries; only light color sampling uses the existing 192×108 working image. Identical 1080p frames avoid redundant resizing. Disabling/hiding/zeroing layer opacity skips color analysis. Paused lighting changes explicitly request a fresh frame and recover after backpressure. Crop/color metadata stays from the same analyzed observation, attached to subsequent frames until the next analysis. Tradeoff: ambient/crop observations may lag by about 100ms between analyses, in addition to existing matte hysteresis/smoothing; video pixels are not downsampled or filtered by this optimization.
3. **Backpressure arrived after expensive work:** `electron/media-worker.ts` now tells `MediaSources` to skip processing before bitmap reads/analysis/JPEG when stdout is blocked. This bounds wasted work at this boundary; the existing websocket queue is still a separate issue.
4. **Every source invalidated every surface:** `src/nativeMedia.ts` and `src/backlightField.ts` now expose source-specific revisions; `src/shared/renderActivity.ts` and `src/SpatialView.tsx` track relevant foreground frames and light contributors. Room-fill dependencies remain. Stable lighting does not redraw at a fixed 20Hz, and unrelated frames no longer trigger texture repaints. Expired/paused timers stop invalidating textures. Cached sample timestamps no longer backdate light-heartbeat timing.
5. **Layer signatures were serialized every animation frame:** `src/LayerArtwork.tsx` memoizes the content signature and tracks its own source revision.
6. **The full studio rerendered every 150ms when idle:** `src/SpatialStudio.tsx` now ticks only while a timer is counting down. Media configuration runs on scene changes. Local-video clock correction remains on a separate 500ms timer while local videos are running, without React updates. The new all-surface inventory and collapsed controls are preserved.

No schema migration, alternate scene store, Python dependency or additional production UI was added. Hidden fixtures remain development checks and are not linked from the studio.

## Remaining work, ranked

Scores use impact/risk/effort from 1–5 and `(impact+risk) × (6−effort)`. They help order comparable work; the quality requirement takes precedence over the arithmetic. Effort is relative engineering scope, not a delivery estimate.

| Priority / score | Evidence and business impact | Recommended change | I/R/E |
| --- | --- | --- | --- |
| P0 /20 | `media-sources` → worker base64 → `host/media-worker-client` → `host/vite-media` → `src/browserMedia` → `src/nativeMedia`: JPEG, text copies and decode prevent a lossless low-latency foundation. | Promote the tested GPU adapter into native desktop output, including generation/sequence metadata, shutdown/context-loss cleanup and integration with the real source/compositor. |5/5/4|
| P0 /20 | Windows defaults `PM_MEDIA_SOFTWARE=1` in `host/media-worker-client.ts`; worker disables hardware acceleration. This was a compatibility recovery, but cannot enable a GPU texture path. | Probe supported hardware on Windows, keep the known recovery option explicit, then select/validate backend. Do not blindly remove the compatibility behavior without testing the target machine. |5/5/4|
| P1 /28 | `host/vite-media.ts` drops only above 2MB queued bytes; the example frame permits several queued images per client. Hidden clients receive frame traffic, while hidden source windows keep decoding. | Track active consumers, separate preview/output cadence, use a latest-frame mailbox and bounded in-flight frames per source/consumer. Keep audio/clock semantics when a visual layer is hidden. |4/3/2|
| P1 /24 | `src/NativeSource.tsx` reports state/time but no stream quality, buffering duration or stage timings. A 60fps animation can conceal a 30fps video or repeated frames. | Observe supported quality events, state 3 buffering and per-stage frame age/cadence/drop counters; report once per second outside React's frame path. Distinguish source, captured, received and presented frames. |4/4/3|
| P1 /16 | `contentPainter` CPU light-field generation measured 6.37ms median /11.54ms p95 at 640×360; `lightCompositor` uploads a Canvas to WebGL, then copies back before Three texture upload. Cost multiplies by lights/views. | Keep video, masks and lighting in one GPU compositor; move coarse color/boundary analysis off the presentation thread. Reuse textures and update only changed fields. Avoid full-frame readback merely to calculate a halo. |4/4/4|
| P1 /21 | `SpatialView` global artwork/mask maps lack eviction/disposal; keys include surface, quality, grid and view flags. `contentPainter` room-light caches also retain variants. One 1920×1080 RGBA raster alone is 8.29MB, before its GPU copy. | Add explicit ownership/reference counting and a pixel/byte budget; dispose on unmount/source removal and evict unused variants. Never evict textures still bound to another view. |4/3/3|
| P2 /18 | `localMedia` has one decoder per content **per window**; identical assets in multiple windows can repeat decoding. Same-window reuse already exists. | Native local renderer owns sources and reads opaque assets directly; reuse only when timing/rate/loop/audio identity matches. React sends small scene/control updates, not pixels. |4/2/3|
| P2 /20 | `src/main.tsx` imports the whole app and NativeSource into a ~1.025MB minified client bundle (~285KB gzip); source windows parse UI/hardware code they do not need. | Split source-player and studio entry loading; lazy-load Hardware and optional 3D previews. This improves startup/memory, but removing JPEG is the larger steady-state win. |3/2/2|
| P2 /18 | `src/bridge.ts` serializes/clones/saves the entire scene for edits; ordinary asset dragging still dispatches each animation frame in `SurfaceEditor`, unlike the optimized mapping-corner preview. | Extend transient preview/commit transactions to asset dragging, then coalesce persistence. Keep scene state separate from frame transport. |3/3/3|

Other useful boundaries already present: official embedded-player isolation, one source shared by native views, newest-pending JPEG decode instead of an unbounded decode queue, local files using browser decoding without JPEG, and transient calibration previews saved only on release. Preserve these instead of adding duplicate engines or stores.

## YouTube quality and consistency

Use the official player at a stable 1920×1080 viewport for 1080p output; changing studio preview dimensions must not recreate it. Keep one source alive through selection, layer, geometry and quality-control changes. Hardware decode eligibility, network conditions and YouTube's chosen source quality remain separate from capture settings.

The official IFrame API no longer supports forcing or retrieving playback quality through `setPlaybackQuality`, `getPlaybackQuality` or `getAvailableQualityLevels`. `onPlaybackQualityChange` remains supported. A claimed “force1080p60” switch based on those removed methods would do nothing. Log the quality event and buffering state, and retain access to the real player's quality controls. [Official revision history](https://developers.google.com/youtube/iframe_api_revision_history), [player reference](https://developers.google.com/youtube/iframe_api_reference).

Do not infer native video FPS from a 60fps capture callback. A 24/30fps source should present with its own timestamps; it cannot supply 60 distinct frames without interpolation, which is not proposed here. Separate network buffering from capture/transport drops before choosing remediation. More buffering is not a cure for main-thread JPEG stalls. Avoid automatic stream-quality reduction to hide local performance problems.

For long-term source stability, the official player stays in its own trusted wrapper. Its GPU texture can feed a dedicated Electron output renderer, or a native compositor through a platform adapter. The normal browser preview cannot import Electron GPU handles over Vite websocket. It should be a control/preview surface with a deliberate transport choice; a genuinely lossless high-rate browser transport would require its own qualified design. The native output window can remain entirely controlled from the same React interface without a separate application UI.

## Native/OpenGL boundary

Use the existing scene/layer/geometry contract as the source of truth. A native backend accepts versioned small commands (asset identity, clock, quad, order, opacity, crop, color settings), acknowledges the applied scene revision, and renders through the same output controls. UI and agent work stay off its render thread. Decoded media must retain presentation timestamps; let the compositor present to display sync, dropping obsolete work instead of building latency.

For local media: asset file → decoder → GPU texture → final warp/layer/color composition → projector. Python can coordinate this, but its decode implementation, copies and scheduling determine performance. The upstream `VideoSource`, reader-thread/frame selection and `GLFullscreenRenderer.draw` are the relevant reuse boundary; do not import its Tk interface or a second scene store. Existing attribution maps these components in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). A native window alone does not guarantee faster decoding.

For YouTube: official player → Electron shared texture → output adapter/compositor. Texture handles and synchronization are platform-specific (for example IOSurface versus Windows shared D3D resources); integrating those with an OpenGL context is real interop work. Do not treat a handle as portable across arbitrary Python/Node processes. The verified Electron-to-Electron adapter is a smaller first step for this source.

## Delivery and acceptance sequence

1. **Completed here:** diagnosis, reproducible CPU/capture/GPU precision probes, bounded compatibility/UI fixes, full build, 162 root tests, native integration and hidden browser checks. A coordinated native-worker reload remains separate from these source checks.
2. **Next production milestone:** lossless desktop YouTube texture path; latest-frame limits; capability/error reporting; measured receive/presentation telemetry. Validate source replacement, pausing, seeking, lighting, crop, input forwarding, layer order, alignment, blackout, multiple views and renderer recovery. No silent JPEG fallback under a lossless claim.
3. **Then native local-video backend:** reuse upstream renderer/source pieces behind the existing React controls, with direct asset access and shared clock contract. Consolidate light/mask passes and bound texture memory before increasing scene complexity.
4. **Qualify the target Windows projector setup:** native 1080p SDR, actual 60Hz output mode, known 30/60fps sources, multiple visible layers plus backlight, 60-second pacing runs and a longer memory/context-loss soak. Record p50/p95/p99 frame age/gaps, dropped/repeated frames, source quality/buffering, audio drift and process memory. Goal: sustained native source cadence, no unbounded queue, no added lossy encode, no new picture errors. Where hardware is 30Hz, report 30 explicitly; do not confuse a 30fps video with a 30Hz display limit.

The projector screenshot's 60Hz statement was an inference, not a verified specification. This audit did not verify its EDID/display mode or measure input-to-photon latency. Those limits remain explicit rather than being converted into a performance guarantee.

## Validation details

- `npm test`: 162 passed. New coverage checks analysis scheduling, full-pixel crop precision, unchanged compatibility quality, disabled lighting, per-surface invalidation, room fill, fade behavior and timer expiry.
- `npm run build`:passes. Existing Vite native-config extension and large-bundle advisories remain; the bundle finding is recorded above.
- `tests/native-media.integration.cjs`:silent real Electron source verifies 30fps configuration, matching colors, paused light refresh, processing skipped under backpressure, retained source generation, pointer forwarding, muted defaults and cleanup.
- `tests/letterbox-compositor.html`:hidden browser passed transparent padding/bars, opaque black picture interior, image unchanged by halo/room fill, source replacement and stale-frame rejection.
- `tests/studio-scheduling.html`:hidden real-Studio fixture uses an in-memory bridge with no media/AI service, confirms idle/expired quiescence and running-timer updates.
- GPU and bitmap profiles are development-only scripts. Their windows are hidden, profiles temporary and media synthetic. No live playback, user scene, original media files or hardware settings were changed.
