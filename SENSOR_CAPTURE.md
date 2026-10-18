# Sensor input, replay and pattern capture

This is the acquisition layer in the existing Projection Mapper site. Open **Hardware setup**, or `http://127.0.0.1:5173/#hardware`. Studio and Hardware setup remain mounted when switching tabs. The scene schema, agent tools and user content are unchanged.

## Try it before the hardware arrives

1. Choose **Demo sensor → Start demo sensor**. Color and depth previews use a deterministic virtual tilted plane. Depth zero means invalid; the demo has no physical sensing.
2. **Record session** collects up to five frames per second for 5, 10 or 30 seconds. Stop early with **Stop & save recording**. Limits stop recording with an explanation and retain completed frames.
3. Select a saved recording or use **Review**. Play/pause, speed and the frame slider operate on original timestamps. Replay has no audio and cannot masquerade as live acquisition.
4. Choose **Quick check** or **Gray code**, select settling time, then **Capture sequence**. A 1920×1080 Gray sequence has 46 observations: white and black references, then normal/inverse pairs for 11 horizontal-coordinate bits and 11 vertical-coordinate bits, most-significant bit first.
5. Cancel keeps completed observations with a `cancelled` status. Retry creates a new session. A failed sequence never reports complete.
6. Recordings persist locally in IndexedDB, separately from the scene. Download `.pmsession` files for backup or import them on another local origin/device. Browser and desktop origins do not share a recording library.

For projector output, choose **Projection output window** and use **Open output**. Position the window on the projector and make it full screen before capture. The desktop app also offers display selection and full-screen controls. In a normal browser, use the browser/window full-screen command on the output. The in-app browser may hide a background tab; use a genuinely visible output window for physical capture.

Patterns temporarily cover the existing output using an unwarped raster. They are not scene assets and do not use the manual four-corner warp. Restore content, finish, cancel, loss of the studio lease, output resize/visibility change, or Escape in the output clears the override. The content underneath keeps its state.

## Scope

Implemented: source-independent RGB/depth contract, synthetic source, local WebSocket receiver, binary recordings, local library, import/export/replay, reference/grid/Gray-code patterns, acknowledged output presentation, settling, fresh-frame association, cancellation, partial-result retention and retry.

The Windows Kinect helper is maintained in [`sensor-helper/`](sensor-helper/README.md); its demo/replay relay is portable. The browser receiver is not a USB driver. Native Windows execution and physical Kinect capture still require hardware verification. Not implemented: measured calibration solve, Gray-code observation decoding, surface discovery, calibrated geometry import, body/hand tracking or physical accuracy validation. No calibration matrices are invented by the agent.

## Live adapter contract

`src/shared/sensor.ts` is canonical. A helper on the same computer can send each binary frame over WebSocket. The UI accepts only loopback addresses (`127.0.0.1`, `localhost`, `[::1]`), default `ws://127.0.0.1:5174`. It receives binary frames plus bounded status messages and sends no scene data, audio, credentials or camera data to remote services.

The helper should bind only to loopback, validate permitted studio Origin headers, and keep a latest-frame queue with bounded backpressure. It should never expose a public listener. Device IDs should be stable hardware serial identifiers, not indices that change on reconnect. A single connection currently represents one sensor; changing device/mode/calibration or restarting sequence numbers requires reconnecting. Multiple independent connections and fusion remain future work, but frames retain sensor identity.

Frame fields:

- `device`: ID, label, kind (`kinect-v2` or `rgbd` for a real source), independent color/depth dimensions, depth scale in meters, optional per-camera intrinsics and optional depth-to-color transform.
- `sequence`: monotonically increasing nonnegative safe integer.
- `capturedAtMs`: exposure midpoint normalized into the host's Unix millisecond clock. Do not substitute network receipt time. Map device timestamps against the host monotonic clock and Unix epoch; report uncertainty.
- `clockUncertaintyMs`: nonnegative bound on that timestamp conversion uncertainty. Capture will wait longer when this is large.
- `exposureMs`: exposure duration, or `null` if unknown. Unknown exposure is preserved as unknown; it is not proof of optical synchronization.
- `color`: tightly packed RGB8, row-major, top-left origin, exactly width × height × 3 bytes.
- `depth`: Uint16 depth, row-major, top-left origin, exactly width × height samples. Zero is invalid. Multiply by `depthScaleMeters` for meters. Kinect millimeter output uses `0.001`.

Intrinsics specify matching image dimensions, `fx`, `fy`, `cx`, `cy`, and OpenCV-style distortion coefficients (empty means none). Raw sensor coordinates use +X right, +Y down, +Z forward. `depthToColor` is a row-major 4×4 rigid transform with meter translation: `colorPoint = depthToColor × depthPoint`; `null` means unknown. Color and depth resolution/calibration are separate. This contract does not claim that same-index RGB and depth pixels are registered. Bridge synchronization of their exposure times must also be established on hardware.

### PMF1 binary frame

All integer framing and depth samples use little endian:

1. Four ASCII bytes: `PMF1`.
2. A uint32 JSON-header byte length.
3. UTF-8 JSON containing `device`, `sequence`, `capturedAtMs`, `exposureMs` and `clockUncertaintyMs`.
4. RGB bytes, followed by unsigned 16-bit depth samples, with lengths derived from validated dimensions.

Use `encodeSensorFrame` / `decodeSensorFrame` rather than duplicating layout rules when using TypeScript. The helper can implement this same small envelope in C++ or Python. Frames use binary payloads, not JSON pixel arrays. Invalid dimensions, lengths, units, clock values and reordered frames are rejected.

### Status and provenance

`src/shared/sensorBridge.ts` defines additive text messages: `{protocol:'pm-sensor', version:1, type:'status', mode:'live'|'demo'|'replay', state:'starting'|'waiting'|'streaming'|'error'|'ended', message:string}`. JSON is limited to 4096 UTF-8 bytes and messages to 500 characters. The mode is fixed for the WebSocket lifetime. An announced source sends `streaming` before binary frames, including after recovery. Legacy binary-only PMF1 streams remain live by default and may not send synthetic frames.

Send status heartbeats at least every two seconds while waiting/replaying. Waiting clears the current observation and invalidates acquisition, but permits a subsequent streaming recovery on the same connection. Errors/end close the receiver; reconnect explicitly. Lost status traffic times out after 15 seconds; live/demo frame stalls after 5 seconds and missing first frames after 6 seconds also fail. Replay may contain longer original time gaps if heartbeats continue. Status text is descriptive, not proof of frame delivery.

Bridge demo and replay are visibly labeled **view only** and cannot record or capture calibration in the UI. Demo frames must identify as synthetic. Replay preserves original device identity, kind and timestamps; it must never be mislabeled as live. The in-app demo sensor remains the generated source that responds to calibration patterns. IR and body data are not part of PMF1.

### PMS1 session

Four ASCII bytes `PMS1`, uint32 JSON length and UTF-8 session metadata are followed by a sequence of uint32 frame lengths and complete PMF1 frames. Metadata includes version, ID, name, kind, provenance, status, message, creation time, frame count, planned patterns and capture associations. Completed observations remain available in cancelled/failed sessions. Import validates the whole recording before adding it to the library.

Acquisition bounds: 300 frames or 384 MiB of raw image payload, whichever is reached first. A frame is at most 12 MiB with no more than 2.5 million pixels per image. The library allows 12 recordings and 768 MiB of stored binary data; it never silently deletes older sessions. Storage failure leaves the current session available for download. Native RGB recordings can reach the memory limit before the chosen duration.

## Presentation and capture ordering

Each pattern requests presentation through a same-origin BroadcastChannel to the existing clean output window. The output acknowledges after drawing the requested source raster and passing animation-frame boundaries. An ownership lease prevents competing studio tabs from changing an active output. An expired lease restores scene output.

Acquisition waits until `presentedAtMs + settleMs`. It accepts only a fresh frame whose earliest estimated exposure time (`capturedAtMs - clockUncertaintyMs - exposureMs/2`, when exposure is supplied) and client receipt time are beyond that gate. Frames from a previous pattern are not accepted merely because they arrived late. Output identity, viewport, display scale and active ownership are checked; a resized, hidden or lost output fails the sequence.

Each observation saves its pattern parameters, presentation time, output ID, source raster dimensions, actual displayed raster rectangle, viewport and display scale, settling duration, frame identity/time and client receipt time. These facts support later decoding, pixel-coordinate conversion and timing diagnosis.

A browser paint acknowledgement is not proof of photons reaching the wall at that instant. Projector buffering, automatic image adjustments, camera exposure and registration still require physical testing. Choose generous settling initially and validate observations. A completed capture means observations were collected; it does not mean calibration succeeded.

## Verification

The production build and 122 automated app tests pass. The local `tests/pattern-output.html` fixture also checks the real browser output component: generated raster pixels, recorded aspect ratio, presentation/capture association, cancellation restoring the original mounted content, retry and resize invalidation. It uses generated frames and an isolated visible iframe; it does not test physical optical timing. The Hardware setup UI has been exercised for recording, complete 46-pattern capture, cancellation, import, replay/seek and persistent storage. Actual helper-to-browser demo/replay, shutdown/reconnect, honest provenance labels and acquisition gating have also been verified using an isolated local port. Windows execution and physical Kinect/projector tests remain outstanding.

## Precedents

- [Microsoft RoomAlive calibration workflow](https://github.com/microsoft/RoomAliveToolkit/blob/master/ProCamCalibration/README.md): separate observation acquisition, offline solve and inspection.
- [OpenCV GrayCodePattern](https://docs.opencv.org/4.x/d1/dec/classcv_1_1structured__light_1_1GrayCodePattern.html): existing generation/decoding primitives to evaluate when implementing the solver.
- [libfreenect2](https://github.com/OpenKinect/libfreenect2): candidate RGB/depth driver; exact Mac/USB compatibility is still unverified.

## Registered geometry and planar solve (October 17)

PMF1 optionally declares `device.colorRegistration: "depth"`, requiring color/depth dimensions to match. If header `cameraPointsFormat` is `"xyz-f32-le"`, append exactly `depthWidth * depthHeight * 3` little-endian float32 values after the existing RGB and uint16 depth data. They are SDK camera-space XYZ meters; zero triples mean missing geometry. Header `floorPlane` may contain a fresh normalized four-coefficient SDK floor equation. Legacy frames have no appended geometry and remain readable. Copying, recording, size accounting and replay preserve these additions.

The full complementary Gray sequence is decoded only where every bit has sufficient measured contrast. The worker fits depth planes, connected patches and robust plane-to-projector homographies. It retains an observed 96×96 coverage mask with a one-cell inset, rather than filling a convex hull over occluders. Imported surface evidence includes source/session/sensor identity, fit residual, dimensions, viewport, saved quad, coverage and a sparse depth witness. Synthetic fixtures never become physical measurements. Canonical `surface.measure` is not a model command; `surface.fill` uses the already imported surface. The agent receives fresh sensor identity and currently valid measured surface IDs, not raw image arrays.

A low reprojection residual is an internal consistency check, not physical optical accuracy. Independent laptop/projector acceptance remains necessary. Full-room SLAM and point-cloud export are reused from [RTAB-Map](RTABMAP_INTEGRATION.md); point-cloud inspection does not imply world-frame/projector registration.
