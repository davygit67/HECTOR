import assert from 'node:assert/strict';
import test from 'node:test';
import { initialScene, reduceScene } from '../../src/shared/domain.js';
import type { HardwareStatus, StudioOperation, StudioPort, StudioResult, StudioSnapshot } from '../../src/shared/studio.js';
import { bindCanvasTurn, roomContext } from '../src/canvas.js';
import { focusedRoomContext } from '../src/context.js';
import { createProjectionAgent } from '../src/projection-agent.js';
import { canvasFixture } from './canvas-fixture.js';
import { MockLanguageModelV4, textReply, toolReply } from './model.js';

const tracking: NonNullable<HardwareStatus['objectMapping']> = {
  state: 'tracking', message: 'Isolated test object; no physical sensor/output connected.', calibrationId: 'fit-1', rmsPx: .8,
  ageMs: 50, canFill: true, object: { id: 'object-1', name: 'User-selected object', points: 900, speedMps: .02, color: null },
};
const live: HardwareStatus = { initialized: true, mode: 'live', connection: 'streaming', message: 'Test hardware only', provenance: 'sensor', busy: false,
  canAcquire: true, frames: 12, recording: false, capturing: false, sessions: [], geometrySolved: true, sensorId: 'fixture-kinect', objectMapping: tracking };
function objectFixture(hardware = structuredClone(live)) {
  const scene = reduceScene(initialScene(1), { type: 'timer.create', id: 'keep-timer', surfaceId: 'tabletop', title: 'Keep', durationMs: 60000 }, 1);
  const fixture = canvasFixture(undefined, scene), operations: StudioOperation[] = [];
  const studio: StudioPort = {
    async inspect(): Promise<StudioSnapshot> { return {
      roomId: 'object-fixture', sceneRevision: fixture.scene().revision, geometryRevision: fixture.scene().geometryRevision,
      ui: { page: 'hardware', view: 'room', inspector: 'assistant', fullscreen: false }, output: { open: true, fullscreen: true, displayId: 'test-output' },
      saveStatus: 'saved', saveError: null, media: [], assets: [], compositions: [], hardware: structuredClone(hardware),
      capabilities: { sceneBatch: true, observation: false, nativeMedia: false, nativeOutput: false, fileImportRequiresClick: true, physicalObservation: false },
    }; },
    async execute(operation): Promise<StudioResult> {
      operations.push(operation);
      if (operation.type !== 'hardware.action') throw new Error('Unexpected test operation.');
      if (operation.command.action === 'fill-object' && hardware.objectMapping?.object) hardware.objectMapping.object.color = operation.command.color;
      if (operation.command.action === 'stop-object' && hardware.objectMapping) { hardware.objectMapping.object = undefined; hardware.objectMapping.canFill = false; hardware.objectMapping.state = 'ready'; }
      return { ok: true, outcome: 'applied', sceneRevision: fixture.scene().revision, message: operation.command.action === 'fill-object'
        ? operation.command.color === null ? 'Object color cleared; retained scene output restored.' : 'Selected object color accepted.'
        : operation.command.action === 'stop-object' ? 'Object selection stopped; retained scene output restored.' : 'Projector fit estimated.' };
    },
    async observe() { throw new Error('No camera or physical projection is attached to this fixture.'); },
  };
  fixture.port.studio = studio;
  return { ...fixture, studio, hardware, operations };
}
type Fixture = ReturnType<typeof objectFixture>;
const operation = (command: unknown) => ({ type: 'hardware.action', command });
async function request(fixture: Fixture, command: unknown, prompt = 'Make the object I selected red.') {
  const model = new MockLanguageModelV4({ doGenerate: [toolReply('operate_studio', { operation: operation(command) }), textReply('Done')] });
  return createProjectionAgent({ canvas: fixture.port, model }).send(prompt);
}
const fill = { action: 'fill-object', objectId: 'object-1', color: '#FF0000' };

test('selected object fill uses the hardware identity and leaves scene content and geometry untouched', async () => {
  const fixture = objectFixture(), before = fixture.scene(); const result = await request(fixture, fill);
  assert.deepEqual(fixture.operations, [operation(fill)]); assert.deepEqual(fixture.commands, []); assert.deepEqual(fixture.scene(), before);
  assert.equal(fixture.hardware.objectMapping!.object!.color, '#FF0000');
  const receipt = result.tools.find(t => t.toolName === 'operate_studio')!.output as { physicallyVerified: boolean };
  assert.equal(receipt.physicallyVerified, false); assert.match(result.text, /temporarily replaces normal projector output/);
  assert.match(result.text, /physical color and alignment are not verified/);
});

test('object fill rejects absent, stale and invented identities without using a planar substitute', async () => {
  for (const mapping of [undefined, { ...tracking, object: undefined }, { ...tracking, object: { ...tracking.object!, id: 'replacement-object' } }]) {
    const fixture = objectFixture({ ...live, objectMapping: mapping }); const result = await request(fixture, fill);
    assert.equal(fixture.operations.length, 0); assert.deepEqual(fixture.commands, []);
    assert.equal(result.status, 'incomplete'); assert.match(result.text, /clicking it in the Hardware camera view/);
  }
});

test('object fill requires tracking, calibration and live eligibility even if the selected ID still exists', async () => {
  const hardware: HardwareStatus[] = [
    ...(['uncalibrated', 'ready', 'lost', 'blocked'] as const).map(state => ({ ...live, objectMapping: { ...tracking, state } })),
    { ...live, objectMapping: { ...tracking, canFill: false } }, { ...live, objectMapping: { ...tracking, calibrationId: undefined } },
    { ...live, canAcquire: false }, { ...live, busy: true }, { ...live, mode: 'replay' }, { ...live, provenance: 'synthetic' },
  ];
  for (const state of hardware) {
    const fixture = objectFixture(state), before = fixture.scene(); const result = await request(fixture, fill);
    assert.deepEqual(fixture.operations, []); assert.deepEqual(fixture.scene(), before);
    assert.equal(result.status, 'incomplete'); assert.match(result.text, /not currently eligible for projection/);
  }
});

test('explicit null clear survives the schema adapter offline and stop clears identity without scene edits', async () => {
  const fixture = objectFixture({ ...live, canAcquire: false, connection: 'disconnected', objectMapping: { ...tracking, state: 'lost', canFill: false, object: { ...tracking.object!, color: '#ff0000' } } });
  const before = fixture.scene();
  const cleared = await request(fixture, { ...fill, color: null }, 'Clear the color from the selected object.');
  assert.deepEqual(fixture.operations[0], operation({ ...fill, color: null }));
  assert.equal(fixture.hardware.objectMapping!.object!.color, null); assert.match(cleared.text, /color cleared; retained scene output restored/);
  const stopped = await request(fixture, { action: 'stop-object' }, 'Stop object tracking and restore the scene.');
  assert.deepEqual(fixture.operations[1], operation({ action: 'stop-object' })); assert.equal(fixture.hardware.objectMapping!.object, undefined);
  assert.match(stopped.text, /selection stopped/); assert.deepEqual(fixture.scene(), before); assert.deepEqual(fixture.commands, []);
});

test('projector calibration receipts distinguish estimates, handoffs and rejection from physical verification', async () => {
  for (const outcome of ['applied', 'handoff', 'failed'] as const) {
    const fixture = objectFixture();
    fixture.studio.execute = async op => { fixture.operations.push(op); return { ok: outcome !== 'failed', outcome, sceneRevision: fixture.scene().revision,
      message: outcome === 'applied' ? 'Projector fit estimated.' : outcome === 'handoff' ? 'Make the projector output fullscreen.' : 'Calibration requires nonplanar measured geometry.' }; };
    const result = await request(fixture, { action: 'calibrate-projector' }, 'Calibrate the projector for curved objects.');
    assert.deepEqual(fixture.operations, [operation({ action: 'calibrate-projector' })]); assert.deepEqual(fixture.commands, []);
    assert.equal((result.tools.find(t => t.toolName === 'operate_studio')!.output as { physicallyVerified: boolean }).physicallyVerified, false);
    if (outcome === 'applied') assert.match(result.text, /calibration estimate; physical alignment is not verified/);
    else { assert.equal(result.status, 'incomplete'); assert.doesNotMatch(result.text, /Object mode temporarily replaces/); }
  }
});

test('host rejection after a valid inspection is preserved without a false configured claim', async () => {
  const fixture = objectFixture();
  fixture.studio.execute = async op => { fixture.operations.push(op); fixture.hardware.objectMapping!.state = 'lost'; return {
    ok: false, outcome: 'failed', message: 'Target lost before application; object output remains black.', sceneRevision: fixture.scene().revision,
  }; };
  const result = await request(fixture, fill);
  assert.equal(fixture.operations.length, 1); assert.equal(result.status, 'incomplete');
  assert.match(result.text, /Target lost before application/); assert.doesNotMatch(result.text, /Object mode temporarily replaces/);
});

test('invented object selection coordinates, unsupported materials and invalid colors never reach the host', async () => {
  for (const command of [{ ...fill, color: 'red' }, { ...fill, color: null, x: .5, y: .5 }, { action: 'select-object', x: .5, y: .5 },
    { ...fill, objectId: '' }, { ...fill, texture: 'generated.mp4' }]) {
    const fixture = objectFixture(); await request(fixture, command);
    assert.deepEqual(fixture.operations, []); assert.deepEqual(fixture.commands, []);
  }
});

test('duplicate object-color delivery executes once', async () => {
  const fixture = objectFixture();
  const model = new MockLanguageModelV4({ doGenerate: [toolReply('operate_studio', { operation: operation(fill) }, 'same-object-call'), toolReply('operate_studio', { operation: operation(fill) }, 'same-object-call'), textReply('Done')] });
  await createProjectionAgent({ canvas: fixture.port, model }).send('Make my selected object red.');
  assert.equal(fixture.operations.length, 1); assert.deepEqual(fixture.commands, []);
});

test('object capability context preserves explicit identity and loss/output limits without advertising semantic recognition', async () => {
  const fixture = objectFixture(), snapshot = await fixture.port.getSnapshot();
  for (const context of [roomContext(snapshot, false, true), focusedRoomContext(snapshot, 'Make the selected object blue', false, true)]) {
    assert.equal(context.capabilities.objectProjection.available, true);
    assert.ok(context.capabilities.unavailable.includes('semantic physical-object recognition/selection'));
    assert.match(context.capabilities.objectProjection.controls, /USER-clicked/);
    assert.match(context.capabilities.objectProjection.output, /black-backed/);
  }
  const bound = await bindCanvasTurn(fixture.port, { turnId: 'object-context', signal: new AbortController().signal, prompt: 'Turn the Clorox wipes cylinder red.' });
  const instructions = await bound.instructions();
  assert.match(instructions, /USER must select the intended object/); assert.match(instructions, /no agent seed\/selection operation/);
  assert.match(instructions, /keep that requested outcome unfinished/); assert.match(instructions, /Never color the table, add a rectangle/);
  assert.match(instructions, /not hidden faces, fast movement or general 6DOF/);
});
