import assert from 'node:assert/strict';
import test from 'node:test';
import { initialScene, reduceScene, type Scene } from '../../src/shared/domain.js';
import { FULL_QUAD } from '../../src/shared/geometry.js';
import type { StudioPort, StudioSnapshot, HardwareStatus } from '../../src/shared/studio.js';
import { bindCanvasTurn, roomContext } from '../src/canvas.js';
import { focusedRoomContext } from '../src/context.js';
import { createProjectionAgent } from '../src/projection-agent.js';
import { AGENT_COMMAND_TYPES } from '../src/commands.js';
import { canvasFixture } from './canvas-fixture.js';
import { MockLanguageModelV4, toolReply, textReply } from './model.js';

function measured(source: 'sensor' | 'synthetic' = 'sensor', scene = initialScene(1)) {
  return reduceScene(scene, { type: 'surface.measure', surface: { ...scene.surfaces[0], provenance: source === 'sensor' ? 'measured' : 'simulated', measurement: {
    sessionId: 'test-measurement', sensorId: 'test-kinect', capturedAtMs: 1000, source,
    rmsPx: .5, correspondences: 512, quad: structuredClone(FULL_QUAD), raster: { width: 1920, height: 1080 }, viewport: { width: 1920, height: 1080, devicePixelRatio: 1 },
    mask: { width: 8, height: 8, bits: '1'.repeat(64) }, floorAligned: true,
  } } }, 1);
}
const live: HardwareStatus = { initialized: true, mode: 'live', connection: 'streaming', message: 'Test fixture only', provenance: 'sensor', busy: false, canAcquire: true, frames: 1, recording: false, capturing: false, sessions: [], geometrySolved: true, sensorId: 'test-kinect', validSurfaceIds: ['tabletop'] };
function withStudio(fixture: ReturnType<typeof canvasFixture>, hardware = live) {
  const studio: StudioPort = {
    async inspect(): Promise<StudioSnapshot> { return {
      roomId: 'fixture', sceneRevision: fixture.scene().revision, geometryRevision: fixture.scene().geometryRevision,
      ui: { page: 'studio', view: 'arrange', inspector: 'assistant', fullscreen: false }, output: { open: false, fullscreen: false, displayId: null }, saveStatus: 'saved', saveError: null,
      media: [], assets: [], compositions: [], hardware,
      capabilities: { sceneBatch: true, observation: false, nativeMedia: false, nativeOutput: false, fileImportRequiresClick: true, physicalObservation: false },
    }; },
    async execute() { return { ok: true, outcome: 'handoff', message: 'Select which candidate is the table.', sceneRevision: fixture.scene().revision }; },
    async observe() { throw new Error('No camera or rendering connected to this fixture.'); },
  };
  fixture.port.studio = studio; return fixture;
}
async function fill(fixture: ReturnType<typeof canvasFixture>, target: 'scene-preview' | 'physical-surface', color: string | null = '#FF0000') {
  const model = new MockLanguageModelV4({ doGenerate: [toolReply('fill_surface', { surfaceId: 'tabletop', color, target }), textReply('Done')] });
  return createProjectionAgent({ canvas: fixture.port, model }).send(target === 'physical-surface' ? 'Make the real tabletop red.' : 'Make the simulated tabletop red.');
}

test('solid fill consumes no asset slots and preserves panels, geometry and animation', async () => {
  let scene = initialScene(1);
  for (let i = 0; i < 5; i++) scene = reduceScene(scene, { type: 'timer.create', id: `t${i}`, surfaceId: 'tabletop', title: 'Keep', durationMs: 60000 }, 1);
  const fixture = canvasFixture(undefined, scene);
  const result = await fill(fixture, 'scene-preview');
  assert.equal(fixture.scene().surfaces[0].fill, '#ff0000');
  assert.deepEqual(fixture.scene().timers, scene.timers);
  assert.equal(fixture.scene().geometryRevision, scene.geometryRevision);
  assert.deepEqual(fixture.scene().manualOutput, scene.manualOutput);
  assert.match(result.text, /simulated.*not measured/i);
  await fill(fixture, 'scene-preview', null);
  assert.equal(fixture.scene().surfaces[0].fill, undefined);
  assert.deepEqual(fixture.scene().timers, scene.timers);
});

test('physical fill rejects simulated and synthetic measurements without dispatching or creating substitutes', async () => {
  for (const scene of [initialScene(1), measured('synthetic')]) {
    const fixture = withStudio(canvasFixture(undefined, scene));
    const result = await fill(fixture, 'physical-surface');
    assert.deepEqual(fixture.commands, []);
    assert.deepEqual(fixture.scene(), scene);
    assert.equal((result.tools.find(t => t.toolName === 'fill_surface')?.output as { ok: boolean }).ok, false);
  }
});

test('physical fill requires fresh live acquisition, not a saved fit, replay or busy capture', async () => {
  for (const hardware of [undefined, { ...live, canAcquire: false }, { ...live, mode: 'replay' as const }, { ...live, provenance: 'synthetic' as const }, { ...live, busy: true }]) {
    const fixture = canvasFixture(undefined, measured()); if (hardware) withStudio(fixture, hardware);
    await fill(fixture, 'physical-surface');
    assert.deepEqual(fixture.commands, []);
  }
});

test('accepted measured fill uses canonical mapping and never claims verified physical output', async () => {
  const fixture = withStudio(canvasFixture(undefined, measured())); const before = fixture.scene();
  const result = await fill(fixture, 'physical-surface');
  assert.equal(fixture.scene().surfaces[0].fill, '#ff0000');
  assert.equal(fixture.scene().manualOutput.calibration, 'measured-planar');
  assert.deepEqual(fixture.scene().surfaces[0].measurement, before.surfaces[0].measurement);
  assert.match(result.text, /measured planar mapping/); assert.match(result.text, /not verified/);
  assert.equal((result.tools.find(t => t.toolName === 'fill_surface')?.output as { physicallyVerified: boolean }).physicallyVerified, false);
  assert.equal((AGENT_COMMAND_TYPES as readonly string[]).includes('surface.measure'), false);
});

test('physical fill rejects changed sensor or invalid depth/output evidence even while frames are fresh', async () => {
  for (const hardware of [{ ...live, sensorId: 'other-camera' }, { ...live, sensorId: undefined }, { ...live, validSurfaceIds: [] }, { ...live, validSurfaceIds: undefined }]) {
    const fixture = withStudio(canvasFixture(undefined, measured()), hardware);
    const result = await fill(fixture, 'physical-surface');
    assert.deepEqual(fixture.commands, []);
    assert.match(JSON.stringify(result.tools), /live sensor, depth witness or fullscreen output/);
  }
});

test('removing an existing fill remains available after sensor disconnection', async () => {
  const scene = reduceScene(measured(), { type: 'surface.fill', id: 'tabletop', color: '#ff0000' }, 1);
  const fixture = canvasFixture(undefined, scene);
  const result = await fill(fixture, 'physical-surface', null);
  assert.equal(fixture.scene().surfaces[0].fill, undefined);
  assert.match(result.text, /solid fill removed/);
  assert.deepEqual(fixture.scene().surfaces[0].measurement, scene.surfaces[0].measurement);
});

test('routine context retains measurement provenance but omits dense masks and states missing object capabilities', async () => {
  const fixture = canvasFixture(undefined, measured());
  for (const context of [roomContext(await fixture.port.getSnapshot()), focusedRoomContext(await fixture.port.getSnapshot(), 'Make it red', false)]) {
    assert.equal(context.frame.provenance, 'mixed');
    assert.equal(context.surfaces[0].provenance, 'measured');
    assert.equal(context.surfaces[1].provenance, 'simulated');
    assert.equal(context.surfaces[0].measurement?.source, 'sensor');
    assert.doesNotMatch(JSON.stringify(context), /1111111111111111/);
    assert.ok(context.capabilities.unavailable.includes('curved-object projection'));
  }
  const bound = await bindCanvasTurn(fixture.port, { turnId: 'object', signal: new AbortController().signal, prompt: 'Turn the Clorox wipes cylinder on the table red.' });
  const instructions = await bound.instructions();
  assert.match(instructions, /Never color the table, add a rectangle/);
  assert.match(instructions, /keep that requested outcome unfinished/);
});

test('mapping handoff is preserved and never causes a speculative fill', async () => {
  const fixture = withStudio(canvasFixture()); const operations: unknown[] = [];
  const execute = fixture.port.studio!.execute;
  fixture.port.studio!.execute = async op => { operations.push(op); return execute(op); };
  const model = new MockLanguageModelV4({ doGenerate: [toolReply('operate_studio', { operation: { type: 'hardware.action', command: { action: 'map-table' } } }), textReply('Done')] });
  const result = await createProjectionAgent({ canvas: fixture.port, model }).send('Map the actual table and make it red.');
  assert.deepEqual(operations, [{ type: 'hardware.action', command: { action: 'map-table' } }]);
  assert.deepEqual(fixture.commands, []);
  assert.match(result.text, /Your action is needed: Select which candidate/);
  assert.equal(result.status, 'incomplete');
});

test('unsupported color and invented surface fail before scene mutation', async () => {
  for (const args of [{ surfaceId: 'tabletop', color: 'red' }, { surfaceId: 'clorox-cylinder', color: '#ff0000' }]) {
    const fixture = canvasFixture();
    const model = new MockLanguageModelV4({ doGenerate: [toolReply('fill_surface', { ...args, target: 'physical-surface' }), textReply('Cannot apply')] });
    await createProjectionAgent({ canvas: fixture.port, model }).send('Make the physical surface red.');
    assert.deepEqual(fixture.commands, []);
  }
});
