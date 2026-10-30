# Nector integration contract

This is the implementation contract for the user-authorized integration of the two
user-owned applications. It turns the October 30, 2026 merge review into a sequence of
runnable changes. It is intentionally not a Git merge recipe.

## Pinned source manifest

| Label | Remote branch | Commit | Role in Nector |
| --- | --- | --- | --- |
| HECTOR | `hector/main` | `6bd610a33939f91dc7feec9834d7cbbb7cc0d067` | Integration base: Studio operating model, `SceneSession`, GPU renderer, media registry, desktop host, packaging, and Electron qualification fixtures. |
| Projection Mapper | `hector/codex/nate-projection-mapper` | `912f609aabfaef130c6e5b52e07747e9b01d0460` | Rich content and room semantics, agent/memory/jobs, programs, calibration/sensor contracts, mapping safeguards, and relevant tests. |

The revisions have no common ancestor. Their source histories remain intact and
identifiable. Nector starts on HECTOR's pinned commit, imports only reviewed first-party
components through explicit adapters, and preserves existing third-party attribution.

## Authority and performance invariants

- There is one versioned project/session writer. The editable draft, durable saved
  revision, desired device revision, device-acknowledged revision, and renderer
  presentation status are distinct.
- Project edits follow Preview & Apply by default. Blackout, play, pause, seek, stop,
  and reconnect are immediate runtime operations, separately authorized and
  acknowledged. An agent uses this same command/session path and never presses Apply
  implicitly.
- The rich project model is compiled into a small render description. The renderer owns
  its frame loop. React, cloud jobs, and the agent never ship full-frame JPEG/base64 or
  drive rendering per frame.
- The projector owns local decoding, output, cache, clocks, diagnostics, blackout, and
  stale-mask expiry. The cloud coordinates projects, assets, jobs, and the agent; it is
  not the output loop. Sensor capture remains on a qualified nearby bridge when its
  timing budget requires it.
- Imports preserve IDs when safe, otherwise use one deterministic mapping for every
  reference. Missing assets/programs are reported and relinkable. Portable projects
  never contain filesystem paths, credentials, cookies, or private recordings.
- A transferred calibration is historical data, not readiness. A different output,
  installation, sensor, reference, raster, or clock domain requires fresh validation.

## Source map

| Nector responsibility | Starting source | Required integration boundary |
| --- | --- | --- |
| Transaction/session behavior | HECTOR `src/core/session.ts` | Extend with revisions, atomic batches, persistence/device outcomes, and conflict handling. |
| Project schema and imports | New shared domain; HECTOR `src/core/model.ts`; Projection Mapper `src/shared/domain.ts`, `content.ts`, `spatial.ts` | Do not flatten physical surfaces or typed content into renderer sources. Supply HECTOR v1 and Projection Mapper v3 import reports. |
| Output and media lifetime | HECTOR `src/render/`, `src/media/`, Electron host | Compile render descriptions; preserve stable identity, demand budgets, and draft/applied resource reachability. |
| Lighting | HECTOR GPU/worker execution plus Projection Mapper algorithm/room-light behavior | One maintained algorithm core with golden fixtures; local halo and room fill remain separate spatial behaviors. |
| Agent and cloud jobs | Projection Mapper `agent/` and relay contracts | Adapt ports/typed receipts; retain idempotency, expiry, cancellation, uncertainty, and scoped memory. |
| Programs | Projection Mapper program lifecycle | Portable artifact manifest, offstage test/apply/rollback, and device admission budgets. |
| Room, calibration, sensors | Projection Mapper spatial/hardware modules | Optional Studio modules; local freshness, provenance, output-raster binding, and local expiry remain authoritative. |
| Desktop host, exports, CI | HECTOR Electron, persistence, e2e | Retain narrow privileged adapters and qualification fixtures; add migration/device suites rather than remove existing coverage. |

## Ordered gates

1. **Freeze and protect:** complete this manifest, retain both source heads, and run the
   base check suite. Do not touch active projector-owner work until it is released.
2. **Device feasibility:** exercise pairing, one known local asset, quad warp, immediate
   blackout, apply/reconnect acknowledgement, and decoder/resource telemetry on the
   target. Measure memory, thermals, decoder limits, and frame behavior before choosing
   WebView or native GLES.
3. **Shared domain and migration:** add versioned project entities, revisioned/batched
   commands, render-description compilation, and representative bidirectional import
   fixtures. Preserve originals and report unsupported material.
4. **Full Studio and renderer:** retain HECTOR's workspace/output lifecycle while adding
   rich content, media controls, masks, and the shared ambient core. Keep room fill
   visibly unavailable until it is implemented.
5. **Agent and cloud jobs:** adapt ports, capability discovery, typed outcomes, memory,
   and idempotent delivery to the unified session.
6. **Programs and portable assets:** carry tested artifact lifecycles and device budgets
   across export, transfer, and reconnect.
7. **Room and physical workflows:** add optional 3D/calibration/sensor modules only with
   freshness, acknowledgement, and expiry tests; physical claims require physical
   measurement.
8. **Deployment qualification:** validate Android/desktop packaging, authentication,
   restart/recovery, cache bounds, loss, sleep/wake, thermals, and long-run output.

## Explicitly deferred

Do not represent broad semantic object recognition, arbitrary curved video mapping,
fast/general 6DOF tracking, Kinect hand/body/touch games, general AI video generation,
multi-projector frame locking, advanced cue sequencing, or unsupported Android YouTube
pixel capture as delivered capabilities. Each needs an explicit capability gate.

## Evidence standard

An accepted scene mutation is not proof of projector presentation, and presentation is
not physical verification. Keep the outcomes `staged`, `saved`, `published`,
`device-accepted`, `presented`, `rejected`, `expired`, and `uncertain` distinct. Bind
rendered inspection to the exact revision and label it nonphysical. Physical claims need
separate camera/sensor evidence with provenance.
