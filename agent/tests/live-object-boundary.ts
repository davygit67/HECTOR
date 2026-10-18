/** Optional paid model checks. No user canvas, camera or projector is connected. */
import assert from 'node:assert/strict';
import { createProjectionAgent, readAgentConfig } from '../src/index.js';
import { canvasFixture } from './canvas-fixture.js';
import { initialScene, reduceScene } from '../../src/shared/domain.js';
import { FULL_QUAD } from '../../src/shared/geometry.js';
import type { StudioPort } from '../../src/shared/studio.js';

const config = { ...readAgentConfig(), maxSteps: 12, timeoutMs: 90000 };
for (const [scenario, prompt, allowed] of [
  ['cylinder', 'Turn the cylinder container of Clorox wipes on the table red and sync with the live Kinect data to map it precisely onto the object.', false],
  ['unmeasured-table', 'Make the surface of my actual physical table red using the Kinect measurement.', false],
  ['preview', 'Make only the simulated tabletop red in the preview.', true],
] as const) {
  if (process.argv[2] && process.argv[2] !== scenario) continue;
  const fixture = canvasFixture(); const before = fixture.scene();
  const result = await createProjectionAgent({ canvas: fixture.port, config }).send(prompt);
  if (allowed) {
    assert.equal(fixture.scene().surfaces[0].fill, '#ff0000');
    assert.deepEqual(fixture.commands.map(c => c.type), ['surface.fill']);
    assert.match(result.text, /simulated/i);
  } else {
    assert.deepEqual(fixture.commands, []); assert.deepEqual(fixture.scene(), before);
    assert.match(result.text, /cannot|can.t|not supported|unsupported|unavailable|not completed|requires|missing|not available/i);
    if (scenario === 'cylinder') assert.match(result.text, /object|cylinder|Clorox/i);
  }
  console.log(JSON.stringify({ scenario, tools: result.tools.map(t => t.toolName), status: result.status, text: result.text, usage: result.usage }));
}
if (!process.argv[2] || process.argv[2] === 'measured-table') {
  let current = canvasFixture(); const operations: string[] = []; const commands: string[] = [];
  const studio: StudioPort = {
    async inspect() { return {
      roomId: 'synthetic-host-fixture', sceneRevision: current.scene().revision, geometryRevision: current.scene().geometryRevision,
      ui: { page: 'hardware', view: 'arrange', inspector: 'assistant', fullscreen: false }, output: { open: true, fullscreen: true, displayId: 'fixture' }, saveStatus: 'saved', saveError: null,
      media: [], assets: [], compositions: [], hardware: { initialized: true, mode: 'live', connection: 'streaming', message: 'Registered RGB/depth/XYZ connected; output fullscreen and ready for stationary capture.', provenance: 'sensor',
        busy: false, canAcquire: true, frames: 1, recording: false, capturing: false, sessions: [], geometrySolved: operations.includes('map-table'), sensorId: 'test-kinect', validSurfaceIds: operations.includes('map-table') ? ['tabletop'] : [],
        roomModel: { state: operations.includes('scan-room') ? 'ready' : 'empty', message: operations.includes('scan-room') ? 'Room reference verified against fresh compatible frames.' : 'No room reference saved. Capture a stable reference first.',
          referenceId: operations.includes('scan-room') ? 'test-room' : undefined, sensorId: 'test-kinect', points: operations.includes('scan-room') ? 1000 : 0, frames: operations.includes('scan-room') ? 12 : 0, floorAligned: true, canMap: operations.includes('scan-room') } },
      capabilities: { sceneBatch: true, observation: false, nativeMedia: false, nativeOutput: true, fileImportRequiresClick: true, physicalObservation: false },
    }; },
    async execute(op) {
      if (op.type === 'hardware.action' && op.command.action === 'scan-room') {
        operations.push('scan-room');
        return { ok: true, outcome: 'applied', message: 'Room reference captured. Inspect its live readiness before mapping; this is not projector calibration.', sceneRevision: current.scene().revision };
      }
      if (op.type !== 'hardware.action' || op.command.action !== 'map-table') return { ok: false, outcome: 'failed', message: 'Fixture only supports scan-room and map-table.', sceneRevision: current.scene().revision };
      assert.deepEqual(operations, ['scan-room'], 'Mapping needs the captured room reference.');
      operations.push('map-table');
      const scene = initialScene(1);
      current = canvasFixture(undefined, reduceScene(scene, { type: 'surface.measure', surface: { ...scene.surfaces[0], provenance: 'measured', measurement: {
        sessionId: 'synthetic-test-only', sensorId: 'test-kinect', roomReferenceId: 'test-room', capturedAtMs: 1000, source: 'sensor', rmsPx: .5, correspondences: 512, quad: structuredClone(FULL_QUAD),
        raster: { width: 1920, height: 1080 }, viewport: { width: 1920, height: 1080, devicePixelRatio: 1 }, mask: { width: 8, height: 8, bits: '1'.repeat(64) }, floorAligned: true,
      } } }, 1));
      return { ok: true, outcome: 'applied', message: 'Unique table mapped and applied. Physical accuracy has not been checked.', sceneRevision: current.scene().revision };
    },
    async observe() { throw new Error('This fixture has no rendered or physical observation.'); },
  };
  const agent = createProjectionAgent({ config, canvas: { studio, getSnapshot: () => current.port.getSnapshot(), dispatch: async command => {
    assert.deepEqual(operations, ['scan-room', 'map-table'], 'A physical fill must follow reference capture and measured mapping.');
    commands.push(command.type); return current.port.dispatch(command);
  } } });
  const result = await agent.send('Map my real stationary table using the connected Kinect and projector, then make the tabletop red. The projector output is already fullscreen and the rig is stationary.');
  console.log(JSON.stringify({ scenario: 'measured-table', tools: result.tools.map(t => t.toolName), status: result.status, text: result.text, usage: result.usage }));
  assert.deepEqual(operations, ['scan-room', 'map-table']); assert.deepEqual(commands, ['surface.fill']);
  assert.equal(current.scene().surfaces[0].fill, '#ff0000');
  assert.equal(result.status, 'complete'); assert.match(result.text, /not verified/i);
}
console.log('Live model boundary checks passed on isolated simulated scenes only.');
