import { tool } from 'ai';
import { z } from 'zod';
import type { SceneToolHost } from './scene-tools.js';

/** Solid light is a material on an existing surface, not a generated media file. */
export function createSurfaceTools(host: SceneToolHost) {
  return {
    fill_surface: tool({
      description: 'Set or clear solid color on an existing planar table/wall surface. color is #RRGGBB; null removes the fill. Consumes no asset slots. Use target=physical-surface for a real surface: this requires sensor-measured mapping tied to the current verified room reference and a fresh live sensor; inspect_studio, scan-room if needed, then map-table. Saved/stale references do not authorize physical fills. scene-preview is only for an explicitly virtual/simulated change, never a fallback for unavailable physical mapping. This cannot select or color individual objects, containers or curved surfaces; never substitute their supporting table. Preserves panels and unrelated content; existing content may cover the fill. Does not verify physical color or alignment.',
      strict: true,
      inputSchema: z.strictObject({ surfaceId: z.string().min(1).max(100), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable(), target: z.enum(['scene-preview', 'physical-surface']) }),
      execute: (input, options) => host.once('fill_surface', input, options, async () => {
        const scene = (await host.canvas.getSnapshot()).scene;
        const surface = scene.surfaces.find(s => s.id === input.surfaceId);
        if (!surface) return { ok: false, error: 'That surface does not exist. Inspect the current room; do not invent a surface ID.' };
        // Clearing light remains available even after the sensor/output is lost.
        if (input.target === 'physical-surface' && input.color !== null) {
          if (surface.provenance !== 'measured' || surface.measurement?.source !== 'sensor') return {
            ok: false, error: 'This surface has no sensor-measured projector mapping. For a stationary physical table, inspect live hardware, capture/verify the room reference with scan-room if needed, then run map-table; report any required setup or ambiguous candidate. Do not substitute scene-preview or a red rectangle.',
          };
          const hardware = (await host.canvas.studio?.inspect())?.hardware;
          if (!hardware || hardware.mode !== 'live' || hardware.provenance !== 'sensor' || !hardware.canAcquire || hardware.busy) return {
            ok: false, error: 'A fresh live sensor is required and must finish its current capture. Reconnect or finish mapping first. Saved measurement alone does not establish current alignment.',
          };
          const room = hardware.roomModel;
          if (!room || room.state !== 'ready' || !room.canMap) return {
            ok: false, error: 'The saved room reference is not currently verified. Inspect roomModel: retain the reference through a disconnect and wait for fresh compatible frames; if absent or the rig moved, scan-room and recalibrate. Do not forget-room or apply a simulated fill as automatic recovery.',
          };
          if (hardware.sensorId !== surface.measurement.sensorId || !hardware.validSurfaceIds?.includes(surface.id)) return {
            ok: false, error: 'The live sensor, depth witness or fullscreen output no longer validates this surface mapping. Check the fixed rig/output and run map-table again; do not substitute a simulated fill.',
          };
          if (!room.referenceId || room.sensorId !== hardware.sensorId || surface.measurement.roomReferenceId !== room.referenceId) return {
            ok: false, error: 'This surface is not calibrated against the current sensor and room reference. Old unanchored measurements remain visible but require map-table again before a new physical fill. Never invent a reference ID.',
          };
        }
        const result = await host.dispatch({ type: 'surface.fill', id: surface.id, color: input.color });
        if (!result.ok) return result;
        const accepted = result.scene.surfaces.find(s => s.id === surface.id)!;
        return { ok: true, revision: result.scene.revision, surfaceId: accepted.id, color: accepted.fill ?? null,
          provenance: accepted.provenance, mapping: accepted.measurement ? { source: accepted.measurement.source, rmsPx: accepted.measurement.rmsPx, capturedAtMs: accepted.measurement.capturedAtMs, roomReferenceId: accepted.measurement.roomReferenceId } : null,
          physicallyVerified: false, limitation: 'Fixed-rig planar mapping only. No semantic object selection, curved-object mapping or continuous motion tracking. Keep the surface, sensor and projector stationary.' };
      }),
    }),
  };
}
