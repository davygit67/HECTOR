/** Optional paid OpenAI checks against isolated ports, never the user's live rig. */
import assert from 'node:assert/strict';
import { createProjectionAgent, readAgentConfig } from '../src/index.js';
import type { HardwareStatus, StudioOperation, StudioPort, StudioSnapshot } from '../../src/shared/studio.js';
import { canvasFixture } from './canvas-fixture.js';

function isolatedObject(selected: boolean) {
  const fixture = canvasFixture(), before = fixture.scene(), operations: StudioOperation[] = [];
  // Consistent ready status is a test double, not evidence of real acquisition.
  const hardware: HardwareStatus = { initialized: true, mode: 'live', connection: 'streaming', message: 'Registered sensor connected; stationary rig and projector output ready.', provenance: 'sensor',
    busy: false, canAcquire: true, frames: 12, recording: false, capturing: false, sessions: [], geometrySolved: true, sensorId: 'fixture-kinect',
    objectMapping: { state: selected ? 'tracking' : 'ready', message: selected ? 'User-clicked object has a fresh visible shape.' : 'Projector calibrated; click the intended object in the registered RGB view.',
      calibrationId: 'fixture-fit', rmsPx: .5, ageMs: 40, canFill: selected,
      object: selected ? { id: 'clicked-object', name: 'Selected object', points: 1000, speedMps: 0, color: null } : undefined } };
  const studio: StudioPort = {
    async inspect(): Promise<StudioSnapshot> { return {
      roomId: 'isolated-object-test', sceneRevision: fixture.scene().revision, geometryRevision: fixture.scene().geometryRevision,
      ui: { page: 'hardware', view: 'room', inspector: 'assistant', fullscreen: false }, output: { open: true, fullscreen: true, displayId: 'fixture-output' },
      saveStatus: 'saved', saveError: null, media: [], assets: [], compositions: [], hardware: structuredClone(hardware),
      capabilities: { sceneBatch: true, observation: false, nativeMedia: false, nativeOutput: true, fileImportRequiresClick: true, physicalObservation: false },
    }; },
    async execute(op) {
      operations.push(op); const result = { sceneRevision: fixture.scene().revision };
      if (op.type === 'ui.navigate') return { ...result, ok: true, outcome: 'applied', message: 'Hardware view open.' };
      if (op.type === 'hardware.action' && op.command.action === 'fill-object') {
        const mapping = hardware.objectMapping!, object = mapping.object;
        if (!object || object.id !== op.command.objectId || op.command.color !== null && (!mapping.canFill || mapping.state !== 'tracking')) return {
          ...result, ok: false, outcome: 'failed', message: 'No eligible selected object; click the intended object before applying color.',
        };
        object.color = op.command.color;
        return { ...result, ok: true, outcome: 'applied', message: object.color === null ? 'Object color cleared; retained scene output restored.' : 'Selected object color configured.' };
      }
      return { ...result, ok: false, outcome: 'failed', message: 'This isolated port supports selected-object color only. Selection requires a user click.' };
    },
    async observe() { throw new Error('No real camera or rendered observation in this fixture.'); },
  };
  const agent = createProjectionAgent({ config: { ...readAgentConfig(), maxSteps: 12, timeoutMs: 90000 }, canvas: { ...fixture.port, studio } });
  return { agent, hardware, operations, unchanged: () => { assert.deepEqual(fixture.commands, []); assert.deepEqual(fixture.scene(), before); } };
}

const chosen = process.argv[2];
if (!chosen || chosen === 'selected') {
  const test = isolatedObject(true);
  for (const [label, prompt, color] of [
    ['selected-red', 'I clicked the Clorox wipes container in the Hardware camera view. Make that selected object pure red (#FF0000).', '#ff0000'],
    ['same-object-blue', 'Change only that same selected object to pure blue (#0000FF). Keep the selection and calibration.', '#0000ff'],
    ['offline-clear', 'Clear only the selected object color and restore normal scene output, keeping the selection. The sensor is now disconnected.', null],
  ] as const) {
    if (color === null) { test.hardware.canAcquire = false; test.hardware.connection = 'disconnected'; test.hardware.objectMapping!.canFill = false; test.hardware.objectMapping!.state = 'lost'; }
    const count = test.operations.length, result = await test.agent.send(prompt);
    console.log(JSON.stringify({ scenario: label, tools: result.tools.map(t => t.toolName), status: result.status, text: result.text, usage: result.usage }));
    const changes = test.operations.slice(count).filter(op => op.type === 'hardware.action');
    assert.equal(changes.length, 1);
    const op = changes[0];
    if (op.type !== 'hardware.action' || op.command.action !== 'fill-object') assert.fail('Expected only a color update on the current object.');
    assert.equal(op.command.objectId, 'clicked-object'); assert.equal(op.command.color?.toLowerCase() ?? null, color);
    assert.equal(test.hardware.objectMapping!.object!.color?.toLowerCase() ?? null, color);
    assert.equal(test.hardware.objectMapping!.calibrationId, 'fixture-fit'); assert.equal(result.status, 'complete'); test.unchanged();
    if (color !== null) assert.match(result.text, /physical color and alignment are not verified/);
  }
}
for (const scenario of ['unselected', 'lost'] as const) {
  if (chosen && chosen !== scenario) continue;
  const test = isolatedObject(scenario === 'lost');
  if (scenario === 'lost') { test.hardware.objectMapping!.state = 'lost'; test.hardware.objectMapping!.canFill = false; test.hardware.objectMapping!.object!.color = '#ff0000'; test.hardware.objectMapping!.message = 'Target lost; colored object output remains black until explicit clear or stop. Click again to select a fresh target.'; }
  const result = await test.agent.send(scenario === 'lost' ? 'Make that same selected object pure green (#00FF00).' : 'Turn the cylinder container of Clorox wipes on the table red using the Kinect.');
  console.log(JSON.stringify({ scenario, tools: result.tools.map(t => t.toolName), status: result.status, text: result.text, usage: result.usage }));
  assert.equal(test.operations.filter(op => op.type === 'hardware.action').length, 0);
  assert.notEqual(result.status, 'complete'); assert.match(result.text, /click|select|lost/i); test.unchanged();
  if (scenario === 'lost') assert.equal(test.hardware.objectMapping!.object!.color, '#ff0000');
}
console.log('Selected-object model checks passed on isolated test ports only; no physical output verified.');
