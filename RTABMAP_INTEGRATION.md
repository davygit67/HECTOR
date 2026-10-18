# RTAB-Map room reconstruction

We use RTAB-Map as an optional external reconstruction engine. Our app keeps its content, agent, projection and calibration interfaces. RTAB-Map handles RGB-D odometry, combining camera views, loop closure and optimized cloud generation. Rebuilding those systems in the Studio is unnecessary.

The inspected source is **0.23.8**, commit `d069becc724905d6465a8758c40dae88e13bb9e8`, from [IntRoLab's release](https://github.com/introlab/rtabmap/releases/tag/0.23.8). Its Windows release includes Kinect for Windows SDK 2.0 support for Xbox One Kinect. Use that source with the existing Microsoft driver; installing a competing USB driver is not part of our setup. Use the normal Windows build if the laptop does not have the matching CUDA hardware/runtime.

## On the Windows laptop

1. Install the upstream Windows release and open RTAB-Map. Close Kinect Studio and stop our Kinect helper first so only one capture workflow is active.
2. Select the **Kinect for Windows v2 / K4W2** camera source in RTAB-Map's source preferences. Start with a modest resolution and avoid dense live mesh visualization on a struggling laptop. Slowly scan a textured, stationary room and save its database. RTAB-Map's odometry must remain valid; a clear image alone does not prove a valid map.
3. Close RTAB-Map. In this project, run **Export RTAB-Map.cmd** and provide the saved `.db` path and installed `rtabmap-export.exe` path (under the RTABMap `bin` directory). The wrapper uses the upstream exporter, optimized poses, 2 cm voxels, depth decimation 4 and 4 m maximum range. It creates a new local output directory every time. Alternatively, export an assembled **PLY point cloud** in RTAB-Map's GUI.
4. In our existing **Hardware** tab, use **Import room scan (.ply)**. Drag to inspect geometry; scroll to zoom. ASCII and binary PLY clouds work. Import is limited to 32 MB / one million source points and the preview samples at most 100,000 points. The preview renders only when moved/resized, avoiding a second continuous rendering workload. This inspection remains local to that Hardware session; keep the original database/export to reopen it.

Imported clouds preserve RTAB-Map's coordinate system and meter scale. They are **not automatically aligned to the simulated room, a Kinect's current pose, or a projector**. Import does not overwrite surfaces, play media or move projection. The next whole-room step is explicit registration between the RTAB-Map frame, our measured sensor frame and projector calibration. A point cloud alone is insufficient for that step.

## Tabletop projection now

Use the independent **Find the tabletop** workflow in Hardware: updated live Kinect helper → stationary projector pattern capture → registered depth/plane fit → measured coverage mask → canonical surface. The agent can fill a mapped flat surface. This does not need RTAB-Map running. Do not move the Kinect between calibration and projection. If it was moved while scanning the room, recalibrate in our app afterwards.

RTAB-Map's camera tracking does not by itself recognize a tabletop by meaning, track a moving Clorox cylinder, calibrate a projector, remove shadows, or synchronize several projectors. Our current table classification uses measured orientation/height when the SDK supplies a floor plane; otherwise a person chooses the flat patch. Curved-object segmentation/materials and live motion tracking remain future work.

## Reuse and provenance

No RTAB-Map binaries, source tree, Kinect driver, private room database or image recording are bundled in Git. The integration calls the installed upstream `rtabmap-export` executable rather than translating its reconstruction algorithms into TypeScript. Export arguments were checked against [the pinned export tool source](https://github.com/introlab/rtabmap/blob/0.23.8/tools/Export/main.cpp). PLY reading and the interactive viewer reuse our existing Three.js dependency.

To inspect the same source independently:

```sh
git clone --depth 1 --branch 0.23.8 https://github.com/introlab/rtabmap.git
git -C rtabmap rev-parse HEAD
```

RTAB-Map core uses [BSD-3-Clause](https://github.com/introlab/rtabmap/blob/0.23.8/LICENSE); optional drivers and linked dependencies have their own licenses. Redistribution of a future bundled native engine must include the applicable notices and review its enabled dependencies. This release uses an external installation. Windows native scanning/export and physical projection still require testing on the actual laptop; automated import/solver fixtures are not physical qualification.
