# Kinect helper

This is the local bridge between the Xbox One Kinect (Kinect v2) and the existing Projection Mapper browser app. It has a Windows SDK capture executable and a portable Node relay. The relay also runs demo and recorded data through the same WebSocket connection. It does not introduce a second canvas, AI agent or recording format.

**Current verification:** the portable relay builds, 19 integration tests pass, and 31 checks against the actual C# shared code pass on the development Mac. Both legacy and registered RGB/XYZ output from the native C# encoder are decoded by the app's canonical TypeScript decoder. The SDK-specific Windows executable has not yet been compiled or run on Windows by this task; no physical Kinect, USB bandwidth, frame timing, object tracking or touch accuracy is claimed.

## Try it now on Mac or Windows

Use [Windows setup](../WINDOWS_SETUP.md) on your friend's laptop. On the development Mac, dependencies and `dist/cli.js` are already built. From the project folder:

```sh
node sensor-helper/dist/cli.js --mode demo
```

Open the studio's **Hardware setup**, select **Local Kinect / RGB-depth bridge**, leave `ws://127.0.0.1:5174`, and choose **Connect sensor**. You should see a moving demo marker, a depth preview and **Helper demo · view only**. The projector and Kinect are not needed. Stop the helper with Ctrl+C; the app clears stale previews and offers reconnect.

For a recording exported from Hardware setup:

```sh
node sensor-helper/dist/cli.js --mode replay --file "/path/to/recording.pmsession"
```

Replay preserves original capture timestamps and sensor labels, runs once and reports completion. Reconnect after it finishes to restart it. All viewers share the current replay; disconnect all viewers before restarting. `--speed 0.25` through `--speed 4` controls playback speed. Long gaps retain a status heartbeat. The browser's existing recording library provides frame seeking and import/export.

Bridge demo/replay is deliberately view-only: it cannot record new measurements or satisfy a fresh calibration capture. Use the app's built-in **Demo sensor** for pattern-aware simulated capture. The external demo does not know which projector pattern is being shown.

## Build and start live capture on Windows

1. Complete **Setup Windows.cmd** and **Check Windows.cmd** in the project folder. These install the portable app/relay dependencies. Node.js 22.12 or newer is required.
2. Install [Microsoft Kinect for Windows SDK 2.0](https://www.microsoft.com/en-us/download/details.aspx?id=44561). This is the Xbox One/Kinect v2 SDK, not Azure Kinect or Kinect v1. The SDK's published supported-OS list is older than Windows 11, so the actual laptop still needs a compatibility check.
3. Open PowerShell in the project folder and run the build/test script below. It uses Windows' existing .NET Framework C# compiler and the installed SDK assembly, so Visual Studio and a separate modern .NET SDK are not required on the laptop.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\sensor-helper\scripts\Test-Kinect.ps1
```

This compiles the Windows SDK adapter, runs the shared C# checks, and runs the Node relay tests including the actual C# binary fixture. The execution-policy option applies to this process, not a permanent machine setting. A managed policy may still prevent it.

4. Start the app with **Launch Preview.cmd**, then start capture in a separate terminal:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\sensor-helper\scripts\Start-Kinect.ps1
```

The start script rebuilds the capture executable before launching. Without a connected Kinect, an installed working SDK should report **Waiting for sensor**, with no fabricated frames. Connect Hardware setup to the same localhost address. Once hardware arrives, connect its powered PC adapter to a USB 3 port and use the SDK Configuration Verifier before testing capture. [Microsoft setup guidance](https://github.com/Kinect/Docs/blob/master/Kinect4Windows2.0/k4w2/Getting_Started.md).

Only Intel/AMD x64 Windows is targeted. Windows on ARM and Mac cannot run this capture adapter. Demo/replay remain portable. The SDK assembly is copied from the user's SDK installation into ignored `native/bin/` for local execution; it is not part of the source handoff.

If the SDK is installed elsewhere, run `Build-Kinect.ps1 -SdkDirectory "C:\your\SDK"` or set `KINECTSDK20_DIR`. Start/check scripts never read the OpenAI key. A model API key is not required for sensor capture.

## What the helper does

- Acquires paired RGB/depth through the Kinect SDK's `MultiSourceFrameReader`; rejects pairs whose source timestamps differ by more than 20 ms.
- Uses the SDK CoordinateMapper to register the original 1920×1080 color image onto the 512×424 depth grid. It sends 512×424 RGB8, unsigned 16-bit depth and XYZ float32 triples in Kinect camera-space meters. Raw depth is in millimeters; zero depth/zero XYZ triples represent missing or unreliable geometry. Color outside the color camera's view is black while valid depth/XYZ remain available. There is no image mirroring or invented camera geometry.
- Reuses conversion/mapping buffers and limits expensive processing to at most 5 frames per second. This is a calibration acquisition target, not a verified throughput or a moving-object tracking rate. The SDK still captures normally; only processed output is throttled.
- An independent optional BodyFrame reader supplies a normalized SDK floor plane when available within 250 ms of the depth exposure. Missing/stale/invalid floor is omitted; it never prevents RGB/XYZ acquisition. Set `PM_KINECT_FLOOR_PLANE=0` before starting to disable this optional reader. This does not send skeletons or create body interaction events.
- Sends stable device identity, sequence, acquisition-time estimate and exposure duration using the canonical PMF1 envelope. Frame acquisition and output have a one-frame mailbox: stale pending frames are replaced, not queued indefinitely.
- Keeps camera intrinsics and depth-to-color transform explicitly `null`; the SDK has already performed correspondence and camera-point conversion. New native frames declare `device.colorRegistration="depth"` and `cameraPointsFormat="xyz-f32-le"`. Only frames with this registration declaration share RGB/depth indexes. Legacy raw-RGB packets remain readable but cannot supply the new measured-geometry path.
- Reports waiting, streaming, failure and replay completion separately. Receiving frames requires successfully decoded data. A device loss invalidates any pending capture. The native process is restarted after loss/failure; a stalled stream triggers recovery before the browser's five-second stale-frame deadline. A fatal browser connection error offers manual reconnect.
- Binds only to IPv4 loopback, validates exact localhost studio Origin/Host, limits clients and message sizes, rejects client commands and drops frames for backed-up viewers. It sends no camera data to a cloud service. The default source is live; failure never switches silently to demo.

The normal browser app at `http://127.0.0.1:5173` is the supported client. Electron's opaque/custom origin is not allowlisted. `--origin` can explicitly set alternative **local HTTP(S)** origins; it cannot enable a remote website. `--port` changes the helper port. Do not expose this service on a LAN or public address.

## Timing and calibration limits

Kinect frame times are relative. The initial adapter estimates a Unix clock offset from the earliest observed delivery delay and uses a conservative **250 ms uncertainty plus half the RGB/depth skew**. This is an estimate, not a measured latency bound or proof of exposure synchronization. USB/driver buffering and projector latency must be measured with the actual setup. Begin with generous pattern settling and inspect the collected images.

The current work supplies registered geometry for fixed-rig calibration. The app can use a settled Gray-code capture to solve planar surface correspondences. This helper does not identify a Clorox container, segment a curved object, solve the projector pose, track object motion, or provide calibrated touch/skeleton interaction. Those require additional local perception, object masks, projector visibility and tracking confidence. A saved table-plane fit cannot map a cylinder or follow a moving container. The agent must not invent or relabel geometry to bridge those gaps.

## Developer checks

```sh
cd sensor-helper
npm ci
npm run check
```

By default the two tests requiring C# output fixtures are explicitly skipped if none is supplied. On a Mac with .NET 8 installed, run:

```sh
dotnet run --project native/tests/CoreTests.csproj -- /tmp/pm-native-fixture.bin /tmp/pm-native-registered.bin
PM_NATIVE_FIXTURE=/tmp/pm-native-fixture.bin PM_NATIVE_REGISTERED_FIXTURE=/tmp/pm-native-registered.bin npm run check
```

`Test-Kinect.ps1` supplies both fixtures automatically on Windows. Transport tests use temporary loopback ports and simulated child processes; no existing studio, user scene or physical camera is touched. They cover framing fragmentation/limits, exact-origin restrictions, ordered demo frames, replay timing/completion/restart, long-gap heartbeat, invalid input, bounded slow-client behavior, missing-platform reporting, child failure recovery, ordered native status/frame delivery, rejection of late frames after retirement, and cross-language RGB/depth/XYZ decoding. The shared C# tests also cover invalid registration clearing reused buffers, optional floor validation, throttling and XYZ byte order.

Use `node sensor-helper/dist/cli.js --check` for a read-only platform/build report. `nativeBuilt` means a file exists; it does not prove a connected sensor. The remaining Windows acceptance checks are: native compilation, missing-device startup, registered RGB/depth/XYZ reception, unplug/replug recovery, Configuration Verifier, sustained recording, and visible projector pattern capture. The canvas task owns the planar solver, extraction and measured-scene import; physical accuracy still needs measurement. Object selection, curved projection and touch/body games remain subsequent work.

Implementation follows the [Microsoft Kinect stream API](https://github.com/Kinect/Docs/blob/master/Kinect4Windows2.0/k4w2/Programming_Guide/Kinect_API_Overview.md) and the additive registered-geometry extension to the existing [sensor contract](../SENSOR_CAPTURE.md). PMF1 retains its magic/version and appends little-endian float32 XYZ after RGB/depth only when the header declares it; old packets remain unchanged. PMS1 stores those canonical frames.
