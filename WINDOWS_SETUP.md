# Windows prototype setup

The Windows route runs the same Projection Mapper site and content canvas, with a separate local Kinect capture helper. It does not replace the Mac project or move its saved scene automatically. The helper and browser must run on the same computer; this release does not stream camera data across the network.

## Prepared private handoff

If Nate supplied **Projection Mapper Windows - PRIVATE.zip**, choose **Extract All**, open the extracted folder, and double-click **Start Projection Mapper.cmd**. This handoff includes portable Windows x64 Node.js and, at Nate's explicit request, his configured `agent/.env`. No separate Node installation or API-key entry is needed. First launch downloads dependencies and builds the app; later launches reuse the installed app. Internet is required for setup and the agent. Share this private archive directly with the intended friend; its API usage is billed to the included key's account.

This packaging exception applies only to the prepared private handoff. Ordinary source copies should follow the credential exclusions below. The handoff opens Studio for projector use; Kinect setup can wait until its powered adapter arrives. Current Mac scenes, conversations and browser profiles are not included. Actual Windows execution still needs verification on the recipient's computer.

## Before connecting hardware

1. Copy the source project to the Windows computer. Exclude `agent/.env` and all other local `.env` configuration files, every `node_modules`, `dist`, `dist-electron`, `bin` and `obj` directory at any depth (including `sensor-helper/native/bin` and `sensor-helper/native/obj`), and `.local-data`. Keep `.env.example` templates, source files and lockfiles; configure credentials locally on Windows. Install Node.js 22.12 or newer with npm.
2. Double-click **Setup Windows.cmd**. It installs the studio, assistant and sensor-helper dependencies, then builds their software. It requires internet for package downloads. It preserves existing API configuration and scene files. Close a running studio before repeating setup.
3. Double-click **Check Windows.cmd**. This reports the Node version, available builds, native-helper executable and local studio status. It does not read or print secrets. A green build check does not establish that a Kinect is connected.
4. Double-click **Launch Preview.cmd**. The existing site opens at **Hardware setup**. The launcher reuses an existing studio; otherwise it starts a background server at `http://127.0.0.1:5173/`. It never kills another service to free the port. Logs are in `.local-data/preview.log`.
5. Start the sensor helper in demo mode in a separate terminal: `node sensor-helper/dist/cli.js --mode demo`. In the site, choose **Local Kinect / RGB-depth bridge**, then **Connect sensor**. The badge says **Helper demo · view only**. The existing in-app **Demo sensor** remains the option for simulated pattern captures.

Helper replay uses `node sensor-helper/dist/cli.js --mode replay --file "C:\path\recording.pmsession"`. It preserves the original recording timestamps and is also view-only. Reconnect after the recording ends to play it again. The site already supports importing the same file for local seek/speed controls.

The assistant is optional. Configure `agent/.env` from its example if needed; setup does not invent an API key or copy one from another computer. Manual content controls, sensor previews and calibration-pattern capture do not require a model API key.

## Native Kinect capture

Follow [the sensor helper guide](sensor-helper/README.md) for the Microsoft Kinect SDK, adapter/power/USB prerequisites, the native build and helper launch. The native executable is built separately with `sensor-helper/scripts/Build-Kinect.ps1`; root setup only builds the portable relay. Native acquisition targets Windows x64. Neither Windows device access nor projector alignment has been verified on this Mac.

The same Hardware setup page then connects to `ws://127.0.0.1:5174`. **Waiting for sensor** means the helper is reachable but has no usable device frames. **Receiving frames** requires actual decoded RGB/depth frames; an open socket alone is insufficient. Connection loss clears stale previews, stops recording with a partial result and fails an in-progress pattern capture. Device recovery can resume previews; starting a new capture is deliberate. Fatal errors offer **Reconnect sensor** after the underlying issue is fixed.

The browser path is the target for this helper integration. **Launch Studio.cmd** also builds/opens the existing Electron app, but helper access from the Electron app's custom origin needs separate support. Browser and desktop retain independent scene/recording storage.

## What this prepares

Use HDMI as an extended display, open the clean projection output, and position/full-screen it on the projector. Begin with the grid and one stationary surface. Pattern capture collects observations; decoding, a measured calibration solve, measured-scene import, physical validation and Kinect hand/body interaction remain separate work.

The launch logic avoids shell interpolation when invoking npm on Windows, following [Node's process-launch behavior](https://nodejs.org/api/child_process.html#spawning-bat-and-cmd-files-on-windows). Software tests exercise argument handling and failures on Mac; actual `.cmd` execution still needs a Windows run.
