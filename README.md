# Projection Mapper · spatial studio 0.3

Current Kinect update: [map a stationary tabletop on Windows](WINDOWS_SETUP.md#update-and-map-a-tabletop), then ask the agent to fill its measured surface. Optional [RTAB-Map 0.23.8 integration](RTABMAP_INTEGRATION.md) provides room-cloud export and inspection in the existing Hardware page. Windows hardware qualification and whole-room projector registration remain pending.


**Working with a co-founder:** see [collaboration and GitHub setup](COLLABORATING.md) for cloning, local API-key setup, reviewed commits, and safe automatic synchronization. GitHub contains the integrated source; room layouts, media, sign-in sessions and credentials remain local.

**Hardware setup:** the same studio now has a Hardware setup tab for demo RGB/depth input, recordings, import/export/replay, and grid/Gray-code pattern capture. Start a demo sensor and run Quick check before connecting hardware. The local helper connection distinguishes live, generated and replayed frames, with waiting/recovery states. Physical Kinect verification and automatic calibration solving remain pending. See [sensor capture guide](SENSOR_CAPTURE.md).

A local 3D room canvas with native surface boundaries, a human viewpoint, two simulated projector outputs, and conversational content creation. The table and wall share one scene. Local content controls work without hardware or an API key. YouTube requires an internet connection.

## Open the studio

**Windows:** use **Setup Windows.cmd**, **Check Windows.cmd** and **Launch Preview.cmd**. The same site connects to the Windows Kinect helper locally; Mac can test its portable demo/replay modes. See [Windows setup](WINDOWS_SETUP.md) and [sensor helper](sensor-helper/README.md). Actual Windows/USB operation remains unverified until tested there.

Browser: double-click **Launch Preview.command** to start the server in the background, then open [the studio](http://127.0.0.1:5173/). Click **Ask assistant** or the **AI** inspector tab. Refresh an older tab if that button is missing. The [clean output](http://127.0.0.1:5173/?view=output) has no editor or chat controls.

Desktop: double-click **Launch Studio.command**, or run `npm start`. Quit/relaunch an older desktop instance to load its updated main process. It may appear as Electron in the Dock. Browser and desktop keep separate saved layouts.

On a fresh checkout use Node 22.12+ and `npm ci`. To enable AI, also run `npm --prefix agent ci` and `npm --prefix agent run build`, then configure `agent/.env` from its example. The API key is read only by the local Node/Electron host, never the renderer. Existing launcher environment values take precedence. Missing settings leave the manual canvas usable and display a chat setup message. Reconnect after fixing a missing key; restart the host to change an already connected model/key configuration.

Browser chat and the connected video renderer require the local Vite development server. The preview launcher builds missing renderer assets automatically on first launch; after renderer source changes, run `npm run build` and restart the preview. The preview launcher reuses an already running server and writes startup logs to .local-data/preview.log. It survives the launching terminal closing; after a Mac restart, run the launcher again. You can still use npm run dev for a foreground development server. A static build preview has no AI host. The desktop build uses Electron IPC. This is a local prototype, not an authenticated public Vercel deployment; Vercel AI SDK runs in the local host.

## Create and arrange content

Choose **Tabletop** or **Back wall**, then use the content buttons:

| Content | What works now |
| --- | --- |
| Timer | Create, resize, attach, start/pause/reset; up to eight |
| Note | Edit title, text, accent color; drag, resize, attach |
| Recipe | Ingredients and individual steps; next/previous/reset |
| Living art | Aurora, stars, contours, swimming fish; palette, speed, seed, pause/reset |
| YouTube | Search by topic or supply a link; official player, live color backlight, brightness/spread/smoothing |
| Target game | Configurable rounds; start/pause/reset and click the lit cell |
| Generated program | AI-authored 2D animations and pointer/keyboard games; offstage tests, parameter controls, pause/reset and rollback |

Use **Surface layout** to arrange panels; the **Content** inspector edits their configuration. Panels may overlap. Initial placement prefers free space, then overlaps while keeping the requested size where the boundary permits. Moves and attachments preserve size and may overlap other content; native boundaries and enabled exclusions remain enforced. Each surface supports five assets total, including timers and its single artwork background. Living art opens the existing background for editing; ordinary assistant artwork requests update that background instead of attempting a duplicate. Editing, playback controls and same-surface moves use no extra slots. Older over-capacity saves remain readable and editable; additions are blocked until a slot is available. Covered items remain selectable from the content list.

Use **Create with AI** to request original animations or games. Generated programs are tested offstage and use the same Content list, surface geometry and projection controls. See [generated programs](GENERATED_PROGRAMS.md) for the workflow, limits and storage.

Start a target game, then use **Play on canvas**. **Arrange panels** returns to dragging/resizing. Scoring and round progression run locally; the AI cannot award hits. This is pointer interaction, not Kinect/hand tracking.

Attach an item to another surface without resetting its timer, recipe page, animation clock, or game progress. Recipe configuration changes return to ingredients. Reset a game before changing its rules. Running clocks persist across reloads and use wall time; changing the system clock affects them.

## YouTube and live backlight

Ask the assistant **“Put a rain sounds YouTube video on the wall with backlight.”** It can search by topic, select a relevant result, and place it on the requested surface. Search uses the existing host-side OpenAI connection and provider-grounded YouTube links. It verifies titles with YouTube when available; otherwise it labels the title unavailable instead of dropping a valid watch link. It needs no separate YouTube API key. Search results are not playback guarantees.

An ordinary play/show request reuses a single existing YouTube player on the requested surface, keeping its position, size, and lighting style. Ask for an additional player explicitly to create another. Other content is not removed or rearranged to make room.

To choose a specific video yourself, use **YouTube**, paste a video link or its ID, and press **Place video**. For a video placed through chat, choose **Use player on canvas**, then press Play in the player or in its controls below the preview. The Content inspector includes its current video link for copying. **Interact with content** enables the player; **Arrange panels** hides the browser player for layout editing without destroying it. A video/start-time change re-cues paused and muted; title, placement and backlight settings preserve the source. Connected local sources are independent of the current view. **Play muted** always starts silently; **Unmute** is an explicit operator action.

The connected local renderer now opens **youtube.com/watch** in a sandboxed browser source, rather than loading an embed. Its real YouTube player fills a 1920 × 1080 source viewport, then the existing surface renderer applies placement, perspective alignment, black-bar detection and backlight. This avoids the iframe-only embedding permission check; it does not change YouTube's account, age, region, removal or protected-content restrictions. A small editor preview does not block playback. Source resolution is not a guarantee that YouTube delivers a 1080p stream; its quality setting and connection still apply.

**Open YouTube window** shows that source's normal page for consent, sign-in or playback/quality settings. **Return to projection**, or closing that source window, returns the same player to its full source size. Only the player region is sent to the canvas; account/consent pages are not projected. Browser audio remains gated by the Studio's explicit **Unmute** control. Account authentication may be restricted by Google in this browser; the adapter cannot guarantee access to every signed-in or protected video. Reload creates a new paused, muted source. Source cookies remain in the local media profile, outside scene state and AI context.

**Next video** advances using YouTube's next suggested/playlist control. **Skip ad** becomes available only when YouTube offers its own skip button; unskippable ads and their countdowns remain. **Autoplay next video** is an explicit runtime-session toggle, off for new sources. It continues after playback has started, retaining the current sound setting; enabling it alone never starts a paused source. Transitions share the same asset, geometry and backlight. The playback heading shows the current video's title. Returning from the YouTube window and Reload video retain the advanced video; Reload still pauses/mutes. A complete renderer/app restart returns to the scene's configured starting video with autoplay off. These controls require the normal local renderer and do not apply to the static iframe fallback.

The backlight defaults on and follows actual sampled video colors, keeping their approximate positions and proportions. **Ambient backlight** toggles it; **Lighting style** offers Cinema, Vivid, Soft and Natural; **Backlight intensity**, **spread**, and **smoothing** adjust its appearance. Ask the assistant to change these too. Lighting runs locally without ongoing model calls. There is no fixed-color fallback when a source is missing.

- **Live local site:** the preview server starts a private local video worker automatically. Stay at the same studio URL; no desktop app switch or screen-sharing prompt is needed. The existing browser room remains authoritative. Each ordinary YouTube watch player renders its own 1920 × 1080 frames, which supply both video pixels and spatial color analysis. The studio and same-origin output share one source and playback clock across surface, manual and 3D views.
- **Desktop:** uses the same source renderer directly. Browser and desktop retain separate saved rooms. Sources start paused and muted; **Play muted** always starts silently and only **Unmute** enables sound.
- The worker captures only its own browser player through Electron capturePage and uses the existing surface painter. The bitmap path targets 30 fps by default (60 opt-in), keeps one capture in flight, and skips encoding when the receiver is congested. This is not a measured frame-rate guarantee on every computer. No desktop/screen capture, source pixels in AI requests or extra scene store is involved. Removing/replacing a video releases its source. A short reconnect grace period keeps browser reloads from immediately destroying the source.
- **Static browser fallback:** without the local host, the older iframe path still needs explicit tab sharing for color sampling and has separate players per window. It is not the normal Launch Preview path. Shared source time is not hardware frame synchronization; physical overlap/blending and output timing remain unmeasured.
- Embedding restrictions still apply to the static-site iframe fallback. The normal local renderer uses the watch page; page failures include an Open YouTube window action. General streaming-provider and DRM capture are not implemented.

The native runtime uses [Electron capturePage](https://www.electronjs.org/docs/latest/api/web-contents#contentscapturepagerect-opts) for its own rendered player. The static fallback retains the [YouTube iframe API](https://developers.google.com/youtube/iframe_api_reference) and [Capture Handle](https://developer.chrome.com/docs/web-platform/capture-handle) interfaces. Browser sampling rectifies the projected quadrilateral; native sampling reads the source frame before any placement or projection warp. Both paths sample 50 stable perimeter zones at two depths in linear light, with conservative black-bar detection and suppression of small bright outliers. Oklab temporal smoothing and hue-preserving tone mapping feed one continuous light field, composited within native surface boundaries/exclusions. Local color-gradient tensors estimate broad contour direction and curvature for a bounded outer extension; low-confidence regions fall back to diffusion and the immediate seam stays edge-matched. The field is blurred as light, not copied as sharp image content. This is geometric color extrapolation, not neural scene outpainting; captions and complex motion can still affect it.

Current normal-watch validation (October 15): 169 root tests/build and isolated native checks pass. A real official music video was played muted through the new source, with changing backlight colors; the live Studio showed a clean picture/glow and retained manual alignment controls. Native fixtures cover page-overlay exclusion, sign-in-page noncapture, source-window return, reload and lifecycle. Windows, physical projector output, actual account sign-in and the user's exact embed-restricted video are not yet verified. If a source stalls, Reload video or Restart video renderer remains available. The source layout uses YouTube's current DOM and may require maintenance if YouTube changes it.

## Talk to the canvas

Try “Put a rain sounds YouTube video on the wall with backlight,” “Put a lemon pasta recipe on the wall,” “Create violet stars on the table,” or “Add a five-minute timer.” Follow-up messages can change existing content. The assistant sees the current simulated room, content, and available capabilities; placements are resolved by the canvas reducer.

The panel shows progress and a final reply. **Stop request** cancels remaining work; edits already applied stay. **Clear conversation** clears conversational context and keeps the scene. If the server disconnects, **Reconnect** checks whether it is available and refreshes the connection; when it is stopped, the loaded canvas stays visible with launcher instructions. Unsent drafts are kept in this tab through reconnect/reload and are never submitted automatically. Browser conversations last for the studio connection; refreshing/restarting resets that conversation, while the saved scene remains. Desktop conversation history lasts for the running app process.

Only one AI turn runs per browser room origin at a time. Use one studio tab for editing. Browser and desktop have independent conversations and stores. Lost canvas receipts stop the active turn and prevent subsequent edits in it; commands are never automatically replayed. Check the visible canvas before retrying.

## Agent controls, memory and saved compositions

The agent now uses the same validated scene operations as Studio for placement, size, layers, visibility, opacity, media presentation, manual alignment, projector/viewer settings and display controls. Studio actions also expose the existing inspector/view toggles, YouTube source controls, output commands and hardware connection/record/replay/pattern/capture workflow. Browser fullscreen and file pickers appear as a prepared button in the main interface when a real click is required. Source-window login remains a human action. The retired matrix demo stays unavailable.

Open **AI → Assistant memory** to review, edit or forget preferences and accepted examples. **Use and learn from memory** pauses both recording and retrieval when off; stored entries remain. Completed manual adjustments are coalesced into bounded records rather than recording every pointer frame. Agent changes are not attributed to the user. Calibration records remain setup facts, not aesthetic preferences. This is retrieval of local examples, not model training or reinforcement learning. Save failures stay visible and never undo the manual canvas edit.

Open **Content → Saved compositions** to save or recall a complete arrangement. Recall replaces the scene's assets and lighting while retaining current physical geometry/manual alignment, and starts media paused with sound muted. Changed surface shapes are rejected instead of applying an obsolete layout. Saved local-media references require the files to remain on this device; saving a composition does not package media for another computer. The library holds up to 20 compositions.

The agent can request a bounded rendered surface image with its scene/geometry revision, source readiness, save/output status and an explicit stale flag. It reuses the existing compositor, including native source frames when available. Unavailable frames are labeled; a placeholder does not prove playback. These are software previews, not camera measurements of focus, physical alignment or brightness. Video decoding, animation and backlight processing remain local and do not run through the language model.

The coordinated agent supplies 27 typed tools, selective tool/context retrieval, persistent scoped memory and adaptable experiences such as immersive music, underwater art, cooking and tabletop play. Ask it to list the available experiences. It still cannot solve measured room geometry, authenticate accounts, generate arbitrary executable games or bypass browser/player permissions.

Desktop compositions and per-room memory are saved under the private data directory; desktop room identity survives the local server's changing port. Browser compositions and room identity belong to that browser origin, with agent memory stored privately by the local host. New conversations load the latest completed agent build. Refresh Studio after an update; relaunch the native app to activate rebuilt native IPC code. No API key is sent to the renderer.

## Explore the spatial canvas

1. In **3D room**, drag to orbit, scroll to zoom, or click a surface. The editor camera is independent of the human viewpoint.
2. Toggle **Coverage** to see A/B, overlap, and uncovered regions. Under **Outputs**, move/disable a simulated projector.
3. Under **Surface**, change a position coordinate; its content follows and coverage is recomputed.
4. **Content** lists every asset across all surfaces, including hidden items. Select an asset to expand its controls. Empty surfaces have no built-in animation; the retired ripple demo cannot be re-enabled.
5. Under **Viewer**, move the nominated human viewpoint.
6. Choose a manual or simulated **Output window source**, then **Open output**. The same scene and runtime state feed every view.

## When the hardware arrives

Connect HDMI as an extended desktop. In Electron, choose the projector under **Output display**, click **Full screen**, and use Escape in the output window to exit.

Choose **Manual alignment**, select its target surface, and use **Align full screen** to calibrate at the final output size. Drag the picture to move the whole projection, a corner to reshape it, or an outline edge to move both endpoints together. **Shift-click** corners to add/remove them from a highlighted selection, then drag any selected corner to move the group with its spacing fixed. Clicking an unselected corner selects it alone. Arrow keys nudge the selected group by one output pixel; Shift + arrows moves 10 pixels. Alt-drag provides fine adjustment. Switch to **Project** for the identical alignment without controls. Enable **Test grid** as needed. Changing the target resets this adapter's alignment; resetting corners keeps content.

The manual adapter uses a 1920 × 1080 logical canvas with letterboxing. It maps intrinsic surface UVs into output pixels; it does not measure metric room geometry or calibrate multiple physical surfaces. Let internal projector adjustments settle before aligning. Re-aim and realign when changing physical surfaces.

## Current limits

- Geometry, dimensions, projector poses and the viewer are simulated. The sensor capture/record/replay software exists, but native Windows/Kinect qualification, measured surface discovery and automatic calibration remain unverified or future work.
- Visibility uses plane occlusion and sampled 128 × 128 weight masks. Overlap is nominal, without measured brightness/gamma/black-level matching or hardware synchronization.
- The 3D views share 768 × 432 surface textures; procedural artwork updates at 20 Hz. These are preview limits, not native projector resolution claims.
- Chat is typed. Voice, other streaming providers, generated images/video and physical motion interaction are not implemented. Original 2D animation/game programs are available through the tested generated-program runtime.
- Recipes are supplied/generated text, not verified web recipes. Art is parameterized procedural rendering. Titles are labels; the selected preset determines appearance. The inspector describes the actual preset. Generated programs are a separate content kind running in an isolated interpreter with bounded drawing commands.
- The fixed human view previews attached content, not head tracking or viewpoint-dependent portals. Timers have visual completion but no alarm yet.

## Persistence and development

Desktop state is `.local-data/scene.json`; writes are debounced/atomically replaced and flushed on normal quit. Invalid saves are preserved separately when possible. Failures appear in the studio.

Schema v1/v2 saves migrate to v3 while preserving timer identity/deadlines, geometry and manual alignment. Desktop creates `scene.json.pre-v3-backup`; browser writes `projection-mapper.scene.v3` and retains older keys. Browser updates travel through local storage/BroadcastChannel. This is not distributed multi-writer state.

- `npm test`: app/domain/host tests, including sensor transport and capture recovery.
- `npm run build`: renderer and Electron typechecks/build.
- `npm --prefix agent run check`: agent typechecks, tests and bundle.
- `PM_DATA_DIR=/tmp/projection-mapper-test npm start`: isolated desktop data.

| Code | Responsibility |
| --- | --- |
| `src/shared/domain.ts` | Versioned scene, validated commands, migration |
| `src/shared/content.ts`, `layout.ts` | Content registry, runtime state, valid panel placement |
| `src/shared/spatial.ts`, `geometry.ts` | Surface/world frames, visibility, coverage, manual warp |
| `src/contentPainter.ts`, `SpatialView.tsx`, `SurfaceEditor.tsx` | Shared artwork, 3D views, surface editing/output |
| `src/ContentControls.tsx`, `ChatPanel.tsx` | Content inspector and conversational UI |
| `src/shared/bridge.ts`, `src/bridge.ts` | Accepted scene commands and browser persistence |
| `host/chat-controller.ts` | One SDK conversation bound to the existing scene port |
| `host/vite-chat.ts`, `canvas-rpc.ts`, `src/chatBridge.ts` | Local browser connection, correlated replies, cancellation |
| `electron/main.ts`, `electron/preload.cjs` | Desktop scene authority, persistence, isolated scene/chat IPC |
| `agent/` | Vercel AI SDK orchestration, 27 typed tools, scoped memory and adaptable experiences |

Validation: all 65 app tests and production build pass. Browser checks covered each content type, artwork attachment/pause, recipe navigation, complete game scoring and reload, note editing, clean output, real AI edit/follow-up, cancellation and clearing chat without clearing the room. The agent task separately passed 34 tests and a real creation/follow-up against the shared reducer. Live browser checks used an isolated localhost origin, preserving the user's 127.0.0.1 scene. Electron wiring is typechecked and shares the tested controller; its new chat IPC path and native projector switching still need interactive desktop/hardware validation.

Fish follow-up validation (2026-10-13): 50 app tests and 34 agent tests pass. The agent task applied Swimming fish to the existing wall artwork through live chat and verified visible motion in successive screenshots. Mutation replies now name accepted presets and state; unsupported dinosaur/dragon artwork requests were declined without edits in an isolated live check.

YouTube/backlight validation (2026-10-13): 65 app tests and 45 agent tests pass. Isolated desktop QA played an actual YouTube video in Surface layout and fullscreen manual output, with live spatial color gradients. Warm capture/analysis samples observed around 5–10 ms (initial sample 128 ms); this is not a guaranteed throughput or total-latency measurement. Pausing held the colors; toggling off retained the paused frame at 38 seconds; intensity/spread changes preserved playback. Offscreen sampling stopped and the light faded, then recovered when the player returned. Pure tests cover spatial proportions, perspective rectification without surrounding-light feedback, dark frames, smoothing, stale fade, and setting validation. Browser checks verified persistent sharing errors and no fabricated glow; successful browser tab capture is not yet verified. Agent settings/configuration passed real OpenAI calls against an isolated canonical reducer; the live browser chat also configured the actual inspector to 140% intensity, 30% spread and 250 ms smoothing without changing the video/start time. A new desktop chat-to-settings interaction was not separately exercised. Physical projection and protected-content capture remain unverified.

Search/sizing follow-up (2026-10-13): 68 app tests, 56 agent tests and both builds pass. The exact rain-sounds request searched and updated an existing wall player without changing its bounds or unrelated content. A different-video follow-up selected another real candidate; it loaded and reached Playing in the user's studio. Background test-tab timeouts did not establish video unavailability. A 160 × 90 source video also played in a 43 × 24-pixel editor preview, and resizing preserved its iframe. Physical pixel size still depends on alignment and optics; browser color sharing was not granted or verified in this follow-up.

Overlap/cutout/loading follow-up (2026-10-13): 78 root tests and 58 agent tests pass; both builds pass. Panels can overlap with five assets per surface, including timers. The known demo hole can be disabled without moving content or resetting alignment. Player startup now waits for visibility and retries one stalled load without resetting ready playback. In the actual 127.0.0.1 room, I5QMtbO-DNk played after a fresh load, the demo hole was disabled, and user-authorized browser sharing delivered live color samples. No physical projection or multi-window playback synchronization is claimed.


## Native frame renderer update · October 13

Desktop video rendering now uses `electron/media-sources.ts` and `src/NativeSource.tsx`, with a narrow source preload that has no scene/AI/filesystem access. `src/shared/media.ts` defines transient frames, generation/sequence identity and explicit playback controls; `src/nativeMedia.ts` keeps only the latest decoded frame and matching color samples. The existing content painter and surface textures consume this frame in every desktop view. No video or color pixels go to the agent or scene saves. Playback remains outside the agent tool interface.

The first implementation caps source rendering at 15 fps and transports 1080p JPEG frames inside the app. This is a functional CPU-based prototype, not a 60 fps production compositor. A shared GPU texture path can replace this transport later without changing surface placement or assistant tools. File/video, generated animation and other providers can use the frame interface; they are not added as new source types yet. Protected streaming services are not supported or validated; provider playback and access to renderable pixels must be evaluated separately.

Current validation: **83 root tests and the production build pass**. `tests/native-media.integration.cjs` runs a local, silent Electron fixture and verifies 1080p source frames, corresponding blue/orange color regions, mute-before-load, explicit unmute, muted Play, source retention through style edits, pointer forwarding, retry identity and cleanup. `tests/native-compositor.html` verifies the actual frame decoder/painter and visible colored glow outside the unchanged image, plus off/removal behavior. `tests/native-youtube-ready.cjs` is an optional network test: the official player loaded Ready with six poster frames, remained paused and muted, and received no Play command. Moving YouTube playback/backlight acceptance and real projector output remain unverified on this new path; no YouTube playback was started during the user's Zoom call.

Run the native fixture after building with `./node_modules/.bin/electron tests/native-media.integration.cjs`. Open the compositor fixture through the local preview at `/tests/native-compositor.html`. The older app-window sampler remains only as a tested helper; its desktop IPC endpoint has been retired.

## Live-site renderer integration · October 13, evening

The live Vite site now connects to the native source renderer through private, loopback-checked HMR messages (`host/vite-media.ts`, `host/media-worker-client.ts`, `electron/media-worker.ts`, `src/browserMedia.ts`). Output clients receive frames but cannot control or mutate sources. Origins retain separate scenes/workers. Backpressure drops obsolete frames; worker restart re-synchronizes the latest scene and generation stamps reject stale frames.

Latest validation: **85 root tests and build pass; the coordinated agent reports 60 tests and build passing.** Actual I5QMtbO-DNk playback in the user's 127.0.0.1 studio was observed advancing while muted, with no screen sharing. Paused-frame backlight off/on comparisons visibly removed/restored red, tan and blue spill outside the same unchanged video image. Fish artwork and Geometry v5 were preserved. The final live assistant correctly described both wall assets without editing them. Living art opens the current fish artwork instead of producing the duplicate-background error. Older validation entries above describe previous implementations and do not supersede this result. Physical projection and other streaming providers remain untested/unimplemented.

Final clean-output check: same-origin `?view=output` visibly showed the shared moving geography video with red lower-left and pale right exterior light over the retained fish artwork. Output has no separate player/audio or screen-sharing request.


## Backlight quality pass · October 13

The live localhost site now uses a continuous, tone-mapped light field with optional contour continuation. Source pixels are unchanged. AI configures the persistent local effect through the existing tool; it does not receive frames or run a model on each frame. Old three-number settings remain compatible with the optional four-profile tone setting.

Validation: **93 root tests and build pass; agent owner reports62 tests/typecheck/build passing**. Silent native integration verifies1080p source frames, mute-before-load/Play, color correspondence, retained source identity and cleanup. The browser compositor fixture verifies unchanged video pixels, visible blue/orange exterior light, off/removal behavior and an excluded patch that remains black. The actual current video was verified advancing muted in Scene557/Geometry5; the read-only comparison uses the identical decoded frame on both sides. Fish artwork and geometry were preserved.

Useful local comparisons: [same live source, old/new lighting](http://127.0.0.1:5173/tests/backlight-comparison.html?view=output), [curved test-pattern extension](http://127.0.0.1:5173/tests/contour-extension.html), [silent compositor check](http://127.0.0.1:5173/tests/native-compositor.html). These are development fixtures, not alternate scene stores. The live comparison needs the studio's video source and playback controls.

Warm100-sample CPU benchmark at192×108: analysis median6.70ms/p95 8.51ms; field generation median5.29ms/p95 7.01ms at maximum224px field size. One actual browser frame measured5.9ms analysis and5.2ms field/composition. These exclude capture, transport, frame decode and physical projector latency; they are not end-to-end frame-rate guarantees.

Color processing uses [Oklab](https://bottosson.github.io/posts/oklab/). Directional extension is a bounded local approximation. Microsoft's [IllumiRoom](https://www.microsoft.com/en-us/research/project/illumiroom-peripheral-projected-illusions-for-interactive-experiences/) motivates peripheral projection, but does not establish general real-time semantic outpainting of arbitrary videos. Physical color/brightness calibration, protected-stream playback, learned scene completion and multi-projector timing remain separate work.


## Room fill, opacity and vibrance · October13

The video Content inspector includes **Room fill** (0–100%), **Backlight opacity** (0–1) and **Backlight vibrance** (0–2). Room fill0 retains the normal local halo; intermediate values expand the spatial field and introduce light onto other surfaces;100 fills all drawable surfaces. Opacity independently fades the light, and vibrance adjusts perceptual color richness (0 grayscale,1 profile default). Legacy settings default to0 fill/1 opacity/1 vibrance. The assistant controls the same settings through its existing configure tool.

Room-wide light uses one viewer-relative extension of the source video plane, sampled at each surface's world positions. Surface boundaries, exclusions, timer bounds and all foreground panel bounds mask the light before composition. Overlapping protected panels remain protected as a union. This adds no content assets or duplicate video players; shared video frames still feed every view/output. The simulated geometry remains uncalibrated to physical hardware.

**97 root tests and build pass;64 agent tests/typecheck/build pass**. The [room-fill compositor fixture](http://127.0.0.1:5173/tests/room-light-compositor.html) verifies0/50/100% extent, colored wall/table at full fill, protected timer/video/overlap pixels, black native holes/outside-domain pixels and exact no-change at opacity0. The0→1% halo transition sampled42/32/143→43/33/145, avoiding a sudden local/room switch. Pure tests cover shared viewer-ray coordinates, increasing table light, vibrance/black behavior, legacy/atomic settings and invalid limits.

Live Scene568/Geometry5 was verified with the user's new UDTmUzu05BE video, fish removed, ripple disabled and existing tabletop timer retained. Room fill100%,opacity1,vibrance1.4 were applied through visible controls;Cinema/intensity1/spread.18/smoothing180 and20%left/16%top/1152×713 placement were preserved. Actual3D view shows matching video-derived colors over both surfaces with the timer clear; playback advanced muted to42s. This verifies software output, not physical projector brightness or protected-stream compatibility.
