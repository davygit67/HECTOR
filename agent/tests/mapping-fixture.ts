import type { MappingObservation, MappingOperation, MappingSettings, MappingState } from '../../src/shared/mappingWorkshop.js';
import { DEFAULT_MAPPING_SETTINGS } from '../../src/shared/mappingWorkshop.js';
import type { HardwareStatus, StudioOperation, StudioPort, StudioSnapshot } from '../../src/shared/studio.js';
import { canvasFixture } from './canvas-fixture.js';

export const mappingPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
/** Deliberate test doubles; this does not connect to the real Kinect, scene or projector. */
export function mappingFixture(selected = true) {
  const fixture = canvasFixture(), operations: StudioOperation[] = [], history: MappingSettings[] = [];
  const state: MappingState = { revision: 1, objectId: selected ? 'measured-object' : null, settings: structuredClone(DEFAULT_MAPPING_SETTINGS), canUndo: false };
  const hardware: HardwareStatus = { initialized: true, mode: 'live', connection: 'streaming', provenance: 'sensor', message: 'Isolated synthetic port; no physical acquisition.', busy: false, canAcquire: true,
    frames: 12, recording: false, capturing: false, sessions: [], geometrySolved: true, sensorId: 'test-sensor',
    roomModel: { state: 'ready', message: 'Synthetic room fixture', referenceId: 'test-room-reference', sensorId: 'test-sensor', points: 1000, frames: 12, floorAligned: true, canMap: true },
    objectMapping: { state: selected ? 'tracking' : 'ready', message: 'Synthetic mapping fixture', calibrationId: 'test-calibration', canFill: selected, workshop: state,
      object: selected ? { id: 'measured-object', name: 'Clicked object', points: 500, speedMps: 0, color: '#ff0000' } : undefined } };
  let observations = 0;
  const studio: StudioPort = {
    async inspect(): Promise<StudioSnapshot> { return {
      roomId: 'isolated-mapping', sceneRevision: fixture.scene().revision, geometryRevision: fixture.scene().geometryRevision,
      ui: { page: 'hardware', view: 'room', inspector: 'assistant', fullscreen: false }, output: { open: true, fullscreen: true, displayId: 'test-projector' },
      saveStatus: 'saved', saveError: null, media: [], assets: [], compositions: [], hardware: structuredClone(hardware),
      capabilities: { sceneBatch: true, observation: false, nativeMedia: false, nativeOutput: false, fileImportRequiresClick: true, physicalObservation: false, mappingObservation: true },
    }; },
    async observe() { throw new Error('Rendered canvas is not a physical camera inspection.'); },
    async observeMapping(): Promise<MappingObservation> {
      observations++;
      const at = Date.now(), image = { mimeType: 'image/png' as const, data: mappingPng, width: 1, height: 1 };
      return { observationId: `observation-${observations}`, revision: state.revision, at, capturedAt: at - 40, expiresAt: at + 15000, ageMs: 40, clockUncertaintyMs: 250,
        stale: false, kind: 'mapping-observation', source: 'registered-kinect', opticalAlignmentVerified: false,
        roomReferenceId: 'test-room-reference', sensorId: 'test-sensor', calibrationId: 'test-calibration', selected: structuredClone(state),
        candidates: [{ id: `candidate-${observations}`, number: 1, bounds: { x: .4, y: .3, w: .12, h: .2 }, centerMeters: [.1, .8, 1.4], extentMeters: [.1, .15, .1], points: 500, contour: [{ x: .4, y: .3 }, { x: .52, y: .3 }, { x: .5, y: .5 }], selectable: true }],
        images: { camera: { ...image }, depth: { ...image }, overlay: { ...image }, projectorMask: { ...image } }, maskScale: { width: 480, height: 270, projectorPixelsPerCell: 4 },
        limitations: ['Synthetic image/geometry for isolated agent tests. No physical projection or semantic identity is verified.'] };
    },
    async execute(op) {
      operations.push(op);
      if (!op.type.startsWith('mapping.')) throw new Error('Only mapping operations are accepted by this fixture.');
      const action = op as MappingOperation;
      if (action.expectedRevision !== state.revision) return { ok: false, outcome: 'failed', message: 'Stale mapping revision.', sceneRevision: fixture.scene().revision };
      if (action.type === 'mapping.select') {
        state.objectId = 'selected-candidate'; state.settings = structuredClone(DEFAULT_MAPPING_SETTINGS);
        hardware.objectMapping!.object = { id: state.objectId, name: 'Measured candidate', points: 500, speedMps: 0, color: null };
        hardware.objectMapping!.state = 'tracking'; hardware.objectMapping!.canFill = true;
      } else if (action.type === 'mapping.undo') state.settings = history.pop()!;
      else {
        history.push(structuredClone(state.settings));
        state.settings = action.type === 'mapping.refine' ? { ...state.settings, ...action.settings } : structuredClone(DEFAULT_MAPPING_SETTINGS);
      }
      state.revision++; state.canUndo = history.length > 0;
      return { ok: true, outcome: 'applied', message: 'Accepted mapping settings in isolated test port.', sceneRevision: fixture.scene().revision, value: structuredClone(state) };
    },
  };
  fixture.port.studio = studio;
  return { ...fixture, hardware, state, studio, operations, observations: () => observations };
}
