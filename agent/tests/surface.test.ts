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
    sessionId: 'test-measurement', sensorId: 'test-kinect', roomReferenceId: 'test-room', capturedAtMs: 1000, source,
    rmsPx: .5, correspondences: 512, quad: structuredClone(FULL_QUAD), raster: { width: 1920, height: 1080 }, viewport: { width: 1920, height: 1080, devicePixelRatio: 1 },
    mask: { width: 8, height: 8, bits: '1'.repeat(64) }, floorAligned: true,
  } } }, 1);
}
const readyRoom: NonNullable<HardwareStatus['roomModel']> = { state: 'ready', message: 'Test reference only', referenceId: 'test-room', sensorId: 'test-kinect', points: 1000, frames: 12, floorAligned: true, canMap: true };
const live: HardwareStatus = { initialized: true, mode: 'live', connection: 'streaming', message: 'Test fixture only', provenance: 'sensor', busy: false, canAcquire: true, frames: 1, recording: false, capturing: false, sessions: [], geometrySolved: true, sensorId: 'test-kinect', validSurfaceIds: ['tabletop'], roomModel: readyRoom };
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

test('physical fill waits for a verified reference even with a streaming sensor and listed surface', async () => {
  const rooms = [undefined, { ...readyRoom, canMap: false }, ...(['empty', 'collecting', 'checking', 'stale', 'moved', 'different-sensor'] as const).map(state => ({ ...readyRoom, state }))];
  for (const roomModel of rooms) {
    const fixture = withStudio(canvasFixture(undefined, measured()), { ...live, roomModel }); const before = fixture.scene();
    const result = await fill(fixture, 'physical-surface');
    assert.deepEqual(fixture.commands, []); assert.deepEqual(fixture.scene(), before);
    assert.match(JSON.stringify(result.tools), /room reference is not currently verified/);
  }
  const checking = withStudio(canvasFixture(undefined, measured()), { ...live, roomModel: { ...readyRoom, state: 'checking', canMap: false }, validSurfaceIds: [] });
  const result = await fill(checking, 'physical-surface');
  assert.match(JSON.stringify(result.tools), /retain the reference through a disconnect/);
  assert.deepEqual(checking.commands, []);
});

test('physical fill rejects retired, unanchored and wrong-sensor room references', async () => {
  for (const roomModel of [{ ...readyRoom, referenceId: 'new-room' }, { ...readyRoom, referenceId: undefined }, { ...readyRoom, sensorId: 'other-kinect' }, { ...readyRoom, sensorId: undefined }]) {
    const fixture = withStudio(canvasFixture(undefined, measured()), { ...live, roomModel });
    const result = await fill(fixture, 'physical-surface');
    assert.deepEqual(fixture.commands, []); assert.match(JSON.stringify(result.tools), /not calibrated against the current sensor and room reference/);
  }
  const old = measured(); delete old.surfaces[0].measurement!.roomReferenceId;
  const fixture = withStudio(canvasFixture(undefined, old));
  await fill(fixture, 'physical-surface'); assert.deepEqual(fixture.commands, []); assert.deepEqual(fixture.scene(), old);
});

test('reconnect checking retains the scene and a fresh compatible reference re-enables physical fill', async () => {
  const hardware = { ...live, roomModel: { ...readyRoom, state: 'checking' as const, canMap: false } } as HardwareStatus;
  const fixture = withStudio(canvasFixture(undefined, measured()), hardware); const before = fixture.scene();
  await fill(fixture, 'physical-surface'); assert.deepEqual(fixture.scene(), before); assert.equal(fixture.commands.length, 0);
  hardware.roomModel = readyRoom;
  await fill(fixture, 'physical-surface');
  assert.deepEqual(fixture.commands.map(c => c.type), ['surface.fill']);
  assert.deepEqual(fixture.scene().surfaces[0].measurement, before.surfaces[0].measurement);
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
    assert.equal(context.surfaces[0].measurement?.roomReferenceId, 'test-room');
    assert.doesNotMatch(JSON.stringify(context), /1111111111111111/);
    assert.ok(context.capabilities.unavailable.includes('curved-object projection'));
  }
  const bound = await bindCanvasTurn(fixture.port, { turnId: 'object', signal: new AbortController().signal, prompt: 'Turn the Clorox wipes cylinder on the table red.' });
  const instructions = await bound.instructions();
  assert.match(instructions, /Never color the table, add a rectangle/);
  assert.match(instructions, /keep that requested outcome unfinished/);
  assert.match(instructions, /Use forget-room only when the user explicitly asks/);
  assert.match(instructions, /Mounting the Kinect on the projector does not establish their calibration/);
});

test('room scan and explicit reset use the hardware port and preserve handoff without speculative fills', async () => {
  for (const action of ['scan-room', 'forget-room'] as const) {
    const fixture = withStudio(canvasFixture()); const operations: unknown[] = [];
    fixture.port.studio!.execute = async op => { operations.push(op); return { ok: true, outcome: 'handoff', message: 'Connect the hardware setup first.', sceneRevision: fixture.scene().revision }; };
    const model = new MockLanguageModelV4({ doGenerate: [toolReply('operate_studio', { operation: { type: 'hardware.action', command: { action } } }), textReply('Done')] });
    const result = await createProjectionAgent({ canvas: fixture.port, model }).send(action === 'scan-room' ? 'Scan the room.' : 'Forget the saved room reference.');
    assert.deepEqual(operations, [{ type: 'hardware.action', command: { action } }]); assert.deepEqual(fixture.commands, []);
    assert.equal(result.status, 'incomplete'); assert.match(result.text, /Your action is needed: Connect the hardware/);
  }
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
