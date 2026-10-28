# Nate's complete Projection Mapper version in HECTOR

Shared repository: [davygit67/HECTOR](https://github.com/davygit67/HECTOR). Import branch: **`codex/nate-projection-mapper`**.

This branch carries the complete tracked Projection Mapper project and its Git history. It is a separate implementation for comparison and integration; HECTOR's existing `main` is not merged or replaced. The two histories have no common ancestor at the time of this import.

## Run this version on Windows

Keep your existing HECTOR checkout. Clone this branch into a separate folder:

```sh
git clone --branch codex/nate-projection-mapper https://github.com/davygit67/HECTOR.git HECTOR-nate
cd HECTOR-nate
```

Install Git and Node.js 22.12 or newer. In the new folder, run **Setup Windows.cmd**, then **Check Windows.cmd**, then **Launch Preview.cmd**. Do not run both versions on the same local port at once. Configure the optional assistant by copying `agent/.env.example` to `agent/.env` and entering an API key locally. Run `npm run collaboration:setup` once in this clone to install the repository guards.

Follow [Windows setup](../WINDOWS_SETUP.md) and [the Kinect helper guide](../sensor-helper/README.md) for hardware prerequisites. Where an older guide says to pull `main`, stay on this import branch for this version. Source publication does not qualify native Windows SDK compilation, camera/USB behavior or physical optical alignment.

## Included capabilities

| Area | Source and guides |
| --- | --- |
| Studio, 3D room/surface views, layers, manual alignment, clean projector output, scene storage | `src/`, `electron/`, `host/`; [project README](../README.md) |
| Timers, notes, recipes, living art, local images/videos, YouTube, pointer games | `src/shared/`, `src/`; [content architecture](../CONTENT_ARCHITECTURE.md) |
| Live spatial video backlight, smoothing/tone profiles, opacity/vibrance and room fill | App renderer and native video source; [performance audit](../PERFORMANCE_AUDIT.md) |
| OpenAI/Vercel AI SDK agent, multipart execution/review, Studio controls, scoped adjustment memory | `agent/src/`; [agent guide](README.md) |
| Generated procedural visuals/games with bounded execution, testing, repair, parameters and revisions | [generated programs](../GENERATED_PROGRAMS.md) |
| Kinect native helper, registered RGB/depth data, demo/replay/recording, room reference and projector calibration | `sensor-helper/`; [room guide](../KINECT_ROOM_V1.md) |
| Observed curved-object fill/tracking and iterative object-edge/mapping refinement | [curved objects](../CURVED_OBJECTS_V1.md), [mapping workshop](../OBJECT_MAPPING_WORKSHOP.md) |
| Cloud MCP task updates and creative requests, private tunnel, durable inbox, Studio receiver | `agent/src/relay/`; [cloud connection](CHATGPT_CONNECTION.md) |

The guides distinguish implemented software, simulations and hardware validation still needed. Procedural generated visuals are included; general AI video-file generation and broad semantic object recognition are not implied. The Kinect helper and physical mapping remain subject to Windows/hardware qualification. Cloud-to-Studio delivery has been verified; unattended scheduled delivery requires its own configuration and test.

## What stays on each computer

API keys, local `.env` files, tunnel credentials/profiles, saved room/calibration data, imported media, recordings, browser sign-ins, private handoff packages and downloaded/generated dependencies/builds are excluded. Source, dependency lockfiles, example configuration, test fixtures, launchers and setup instructions are included. Windows setup rebuilds the generated software. Each computer supplies its own configuration and calibration.

## Current Git policy

- Completed, appropriately tested changes may be committed and pushed automatically by Codex under `AGENTS.md`; unfinished edits and another active task's files are not swept into commits.
- `npm run repo:sync` runs only in a clean, idle checkout. It synchronizes existing commits with the configured upstream and accepts only fast-forward updates. Divergence stops for a deliberate resolution.
- The previous recurring Git-sync automation was removed. There is no active timer that silently publishes every edit. Older text in `COLLABORATING.md` describing that heartbeat is historical.
- On Nate's existing Mac checkout, `origin` still points to `adknate05/projection-mapper` and the working branch remains `main`. `hector` is an additional remote. This import does not silently retarget the other active chats or change their upstream.
- Future completed snapshots can be pushed deliberately with `git push hector HEAD:refs/heads/codex/nate-projection-mapper`, after the outgoing-history check and a fresh remote check. If someone else advances that branch, fetch and reconcile deliberately; never force-push over them.
- A fresh clone using the command above tracks the HECTOR import branch. Use separate feature branches/clones for each person's work and review before integration. Sharing a repo shares code, not live runtime state or credentials.

## Integrating the implementations later

First run and benchmark both versions on the same Windows hardware, scene, media and output settings. Record frame pacing, input-to-output latency, CPU/GPU use and Kinect throughput. HECTOR's lower latency is a working observation to validate, not a benchmark established by this import.

Then create an integration branch from HECTOR's existing `main`. Agree its scene/renderer/sensor interfaces and port features in small reviewable slices: agent/tools, content controls, video/backlight, generated programs, Kinect/mapping and cloud inbox. Reuse the tests for each slice and preserve the selected rendering architecture. Avoid a wholesale folder overwrite or an automatic unrelated-history merge; neither establishes that the combined system retains both versions' strengths.

## Import validation

Before publication on October 28: 244 app tests, 173 agent tests and 21 helper tests passed; two optional C# encoder fixture checks were skipped. App typecheck and agent/helper builds passed. The complete outgoing Git history was scanned for known credential patterns and private paths. Actual Windows/Kinect/projector qualification remains separate.
