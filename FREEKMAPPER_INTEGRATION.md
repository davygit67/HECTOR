# FREEkMapper integration

The existing studio now includes the selected advantages from FREEkMapperV67. Its Python UI cannot be dropped into React, so the relevant algorithms and interaction patterns were adapted around the current scene, rendering and command paths. No app rewrite, Python process, new package dependency or second scene store was added. See [source mapping and license](THIRD_PARTY_NOTICES.md).

## Using the controls

- Choose **Upload media** in the content library. Video and image files are decoded locally. The desktop app copies them into its data folder; the browser version uses IndexedDB. Files stay on this computer. New video imports are paused and muted. MP4/H.264, WebM, PNG and JPEG are recommended; codec support depends on the browser. Files must be no larger than 2 GB and fit available local storage.
- Select the uploaded asset to play/pause/reset/seek, loop, change speed/volume, unmute, rotate, flip, fit/crop/stretch or adjust brightness, contrast and saturation. **Replace file** relinks a missing file or changes the source while retaining placement and layer settings. Replacing the source starts it paused/muted.
- Use **Layers** below the preview to select covered assets, move them forward/backward, hide them, lock their position or change opacity. Top of list is front. Timers, YouTube and other panels participate in the same stack. Living art stays the surface background. Hiding a video does not pause its clock or mute its audio.
- **Display settings** controls render quality, output brightness and blackout. Fast uses a 640-wide editor/720p output; Balanced keeps a 960-wide editor/1080p output; Sharp uses 1080p previews. This controls compositing resolution, not the source video codec or hardware projector resolution. Blackout hides output while the editor and playback continue.
- Alignment markers now have an 8-pixel visible center and a 24-pixel grab region. Dragging preserves the grab offset. Hold Shift for 1/10 movement or Alt for 1/100 movement. Arrow keys nudge one source pixel; Shift + arrows nudges ten and Alt + arrows nudges one tenth. Controls follow the fitted image/video edge, including rotation and fitting. Whole-image dragging remains rigid.

Corner movement previews locally on animation frames. A transient, validated BroadcastChannel message keeps other studio/output views moving with it; the existing bridge saves the final quad on release. Align and Project use the identical mapping. Project continues to hide all editor labels, handles, toolbar and cursor.

Simulated projector presentation also bypasses the old 10 fps thumbnail throttle. Preview cards retain their lower refresh rate; actual output renders on available animation frames. This removes a software cap, not a promise of a particular measured frame rate.

## Architecture and compatibility

The v3 scene has additive optional layer/display settings and a typed media content kind. Old scenes preserve their legacy order and defaults; no existing geometry is reset. File bytes and transient blob URLs never enter JSON scenes or AI context. Media has a shared clock; previews in one window reuse one browser decoder, and separate windows follow the saved clock with muted output audio. Frame drawing avoids CPU pixel readback and JPEG encoding for local files. This does not replace the separate YouTube/native-source path.

The AI package was updated by its owner to understand uploaded media and visibility/blackout without claiming playback has been verified. Upload/replacement, seek, layer and display settings remain operator controls. Existing explicit play/pause/reset, title, attach and remove tools work on uploaded videos. The rebuilt agent must be loaded by a fresh host process.

Desktop asset copies survive restarts and changes to the app's local server address. The preload accepts operator-selected Files, keeps their original paths out of the renderer, and passes opaque IDs to the scene. Authorized control-window IPC imports/removes copies; both app windows can resolve them. A same-origin route streams byte ranges for seeking and rotates its URL prefix on each launch. Browser media belongs to its profile and origin. A scene copied to another computer, another browser or between desktop and browser may need **Replace file**. Removing a layer does not delete the original file or automatically purge stored asset copies. There is no new asset-export bundle. Existing delivered Windows ZIPs have not been altered.

## Verification and boundaries

Automated regression coverage includes scene persistence, legacy defaults, media clock continuity through speed/seek/loop/pause, atomic invalid-input rejection, layer ordering/locking/opacity, image-fit anchors and output command permissions. Desktop storage tests exercise asset copies across new origins, byte-range seeking, invalid paths, symlinks, method restrictions and preservation of source files. The isolated browser fixture tests real local decoding, image pixels/flip, play/pause, resource disposal and IndexedDB reload, plus manual layer and fullscreen controls. It never changes the user's saved room.

Physical projector latency and the friend's Windows machine still need hardware validation. No numerical end-to-end latency improvement is claimed. The source's cue sequencing, configuration slots, Python/OpenGL runtime and unsafe NumPy configuration-file loading were not imported; they are separate workflows outside this integration. Local-file playback does not acquire the YouTube ambient-light feature automatically.
