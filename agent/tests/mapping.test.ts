import assert from 'node:assert/strict';
import test from 'node:test';
import { createOpenAI } from '@ai-sdk/openai';
import type { MappingObservation } from '../../src/shared/mappingWorkshop.js';
import { bindCanvasTurn, roomContext } from '../src/canvas.js';
import { createProjectionAgent } from '../src/projection-agent.js';
import { mappingObservationOutput } from '../src/mapping-tools.js';
import { createToolSelector } from '../src/tool-routing.js';
import { mappingFixture } from './mapping-fixture.js';
import { MockLanguageModelV4, textReply, toolReply } from './model.js';

async function setup(selected = true) {
  const f = mappingFixture(selected);
  const bound = await bindCanvasTurn(f.port, { turnId: 'mapping-test', prompt: 'Refine the object outline', signal: new AbortController().signal });
  let calls = 0;
  const call = async (name: string, input = {}, toolCallId = `call-${++calls}`): Promise<any> =>
    (bound.tools as any)[name].execute(input, { toolCallId, messages: [], context: {} });
  const inspect = () => call('inspect_object_mapping');
  const refine = (o: MappingObservation, settings: object) => call('refine_object_mapping', { operation: { type: 'mapping.refine', observationId: o.observationId,
    expectedRevision: o.revision, objectId: o.selected.objectId, settings: { insetPx: null, featherPx: null, trim: null, ...settings } } });
  return { ...f, bound, call, inspect, refine };
}

test('paired observation sends labeled camera/depth/overlay/mask images while excluding stale or malformed data', async () => {
  const f = await setup(), o = await f.inspect();
  const output = mappingObservationOutput(o);
  assert.equal(output.type, 'content');
  if (output.type !== 'content') assert.fail();
  assert.equal(output.value.filter(p => p.type === 'file').length, 4);
  const text = JSON.stringify(output.value.filter(p => p.type === 'text'));
  assert.match(text, /Physical RGB/); assert.match(text, /same captured frame/); assert.match(text, /Computed projector mask/); assert.match(text, /untrusted/);
  for (const stale of [{ ...o, stale: true }, { ...o, expiresAt: Date.now() - 1 }, { ...o, ageMs: 400 }]) {
    const hidden = mappingObservationOutput(stale); assert.equal(hidden.type, 'content');
    if (hidden.type === 'content') assert.equal(hidden.value.filter(p => p.type === 'file').length, 0);
  }
  const bad = structuredClone(o); bad.images.camera.width = 640; bad.images.depth.data = 'not base64';
  const filtered = mappingObservationOutput(bad);
  if (filtered.type !== 'content') assert.fail();
  assert.equal(filtered.value.filter(p => p.type === 'file').length, 2);
  assert.deepEqual(f.operations, []); assert.deepEqual(f.commands, []);
});

test('candidate selection is observation-bound and begins uncolored without touching scene geometry/content', async () => {
  const f = await setup(false), before = f.scene(), o = await f.inspect();
  for (const operation of [
    { type: 'mapping.select', observationId: 'invented', expectedRevision: o.revision, candidateId: o.candidates[0].id },
    { type: 'mapping.select', observationId: o.observationId, expectedRevision: o.revision + 1, candidateId: o.candidates[0].id },
    { type: 'mapping.select', observationId: o.observationId, expectedRevision: o.revision, candidateId: 'invented' },
  ]) assert.equal((await f.call('refine_object_mapping', { operation })).ok, false);
  assert.equal(f.operations.length, 0);
  const result = await f.call('refine_object_mapping', { operation: { type: 'mapping.select', observationId: o.observationId, expectedRevision: o.revision, candidateId: o.candidates[0].id } });
  assert.equal(result.ok, true); assert.equal(result.opticalAlignmentVerified, false);
  assert.equal(f.hardware.objectMapping!.object!.color, null); assert.equal(f.bound.requiredTool(), 'inspect_object_mapping');
  assert.equal(f.bound.verificationPending(), true); await f.inspect(); assert.equal(f.bound.verificationPending(), false);
  assert.doesNotMatch(f.bound.formatReply({ text: 'Done', toolNames: ['refine_object_mapping'] }), /Object mapping could not be changed/);
  assert.deepEqual(f.scene(), before); assert.deepEqual(f.commands, []);
});

test('refinement preserves unspecified settings and color; every edit requires reinspection and supports undo/reset', async () => {
  const f = await setup(), first = await f.inspect();
  const edited = await f.refine(first, { insetPx: 3, trim: { left: .1, top: 0, right: 0, bottom: 0 } });
  assert.equal(edited.ok, true); assert.equal(f.state.settings.insetPx, 3); assert.equal(f.state.settings.featherPx, 0);
  assert.equal(f.hardware.objectMapping!.object!.color, '#ff0000');
  assert.equal((await f.refine(first, { featherPx: 4 })).ok, false); assert.equal(f.operations.length, 1);
  const second = await f.inspect(); await f.refine(second, { featherPx: 4 });
  assert.equal(f.state.settings.insetPx, 3); assert.equal(f.state.settings.trim.left, .1);
  let o = await f.inspect();
  await f.call('refine_object_mapping', { operation: { type: 'mapping.undo', observationId: o.observationId, expectedRevision: o.revision, objectId: o.selected.objectId } });
  assert.equal(f.state.settings.featherPx, 0); assert.equal(f.state.settings.insetPx, 3);
  o = await f.inspect(); await f.call('refine_object_mapping', { operation: { type: 'mapping.reset', observationId: o.observationId, expectedRevision: o.revision, objectId: o.selected.objectId } });
  assert.deepEqual(f.state.settings, { insetPx: 1, featherPx: 0, trim: { left: 0, top: 0, right: 0, bottom: 0 } });
  assert.equal(f.hardware.objectMapping!.object!.color, '#ff0000'); assert.deepEqual(f.commands, []);
});

test('stale, mismatched, missing-camera and expired observations cannot authorize edits', async () => {
  const mutations: ((o: MappingObservation) => void)[] = [o => { o.stale = true; }, o => { o.expiresAt = o.at - 1; },
    o => { o.ageMs = 400; }, o => { o.clockUncertaintyMs = 301; }, o => { o.sensorId = 'different'; },
    o => { o.roomReferenceId = 'old-room'; }, o => { o.calibrationId = 'old-fit'; }, o => { o.revision++; },
    o => { o.images.camera = null; }, o => { o.selected.objectId = 'other'; }];
  for (const mutate of mutations) {
    const f = await setup(), capture = f.studio.observeMapping!;
    f.studio.observeMapping = async () => { const o = await capture({}); mutate(o); return o; };
    const o = await f.inspect(); assert.equal((await f.refine(o, { insetPx: 3 })).ok, false); assert.deepEqual(f.operations, []);
  }
});

test('live status is rechecked at dispatch and host rejection never claims an adjustment succeeded', async () => {
  for (const change of [(f: Awaited<ReturnType<typeof setup>>) => { f.hardware.canAcquire = false; },
    (f: Awaited<ReturnType<typeof setup>>) => { f.hardware.objectMapping!.state = 'lost'; },
    (f: Awaited<ReturnType<typeof setup>>) => { f.hardware.objectMapping!.object!.id = 'new-object'; },
    (f: Awaited<ReturnType<typeof setup>>) => { f.state.revision++; }]) {
    const f = await setup(), o = await f.inspect(); change(f);
    assert.equal((await f.refine(o, { insetPx: 3 })).ok, false); assert.deepEqual(f.operations, []);
  }
  const f = await setup(), o = await f.inspect();
  f.studio.execute = async op => { f.operations.push(op); return { ok: false, outcome: 'failed', message: 'Object moved before application.', sceneRevision: 1 }; };
  const rejected = await f.refine(o, { insetPx: 3 });
  assert.equal(rejected.ok, false); assert.equal(f.bound.requiredTool(), undefined);
  const reply = f.bound.formatReply({ text: 'Perfectly aligned!', toolNames: ['refine_object_mapping'] });
  assert.match(reply, /Object moved/); assert.doesNotMatch(reply, /Perfectly aligned/);
});

test('a later inspection of a different revision is not verification of the accepted mapping edit', async () => {
  const f = await setup(), o = await f.inspect();
  await f.refine(o, { insetPx: 3 });
  f.state.revision++; f.state.settings.insetPx = 5;
  const latest = await f.inspect(); assert.equal(latest.ok, true); assert.equal(latest.stale, false);
  assert.equal(f.bound.verificationPending(), true);
  assert.match(f.bound.formatReply({ text: 'Done', toolNames: ['refine_object_mapping'] }), /comparison is still missing/);
});

test('strict inputs reject invented coordinates, expansion, invalid trims and unsupported material edits', async () => {
  const f = await setup(), o = await f.inspect(), schema = (f.bound.tools.refine_object_mapping!.inputSchema as any);
  const base = { type: 'mapping.refine', observationId: o.observationId, expectedRevision: o.revision, objectId: o.selected.objectId,
    settings: { insetPx: null, featherPx: null, trim: null } };
  for (const operation of [
    { ...base, x: .5 }, { ...base, settings: { ...base.settings, insetPx: 0 } }, { ...base, settings: { ...base.settings, insetPx: 9 } },
    { ...base, settings: { ...base.settings, featherPx: -1 } }, { ...base, settings: { ...base.settings, texture: 'file.mp4' } },
    { ...base, settings: { ...base.settings, trim: { left: .1 } } },
    { ...base, settings: { ...base.settings, trim: { left: -.1, right: 0, top: 0, bottom: 0 } } },
  ]) assert.equal(schema.safeParse({ operation }).success, false);
  assert.equal((await f.refine(o, {})).ok, false); assert.equal(f.operations.length, 0);
});

test('mapping budgets and duplicate delivery bound repeated adjustments and image acquisition', async () => {
  const f = await setup();
  for (let i = 0; i < 4; i++) {
    const o = await f.inspect(); const input = { operation: { type: 'mapping.refine', observationId: o.observationId, expectedRevision: o.revision, objectId: o.selected.objectId,
      settings: { insetPx: i + 2, featherPx: null, trim: null } } };
    await f.call('refine_object_mapping', input, `edit-${i}`); await f.call('refine_object_mapping', input, `edit-${i}`);
  }
  assert.equal(f.operations.length, 4);
  const last = await f.inspect(); assert.equal((await f.refine(last, { insetPx: 7 })).ok, false);
  await f.inspect(); assert.equal((await f.inspect()).ok, false); assert.equal(f.observations(), 6);
});

test('a model turn must inspect after adjustment and cannot report complete when that comparison fails', async () => {
  for (const failComparison of [false, true]) {
    const f = mappingFixture(), original = f.studio.observeMapping!;
    f.studio.observeMapping = async input => { if (failComparison && f.observations() === 1) throw new Error('Sensor disconnected before comparison.'); return original(input); };
    const model = new MockLanguageModelV4({ doGenerate: [toolReply('inspect_object_mapping', {}, 'before'),
      toolReply('refine_object_mapping', { operation: { type: 'mapping.refine', observationId: 'observation-1', expectedRevision: 1, objectId: 'measured-object', settings: { insetPx: 3, featherPx: 2, trim: null } } }, 'change'),
      toolReply('inspect_object_mapping', {}, 'after'), textReply('Looks perfect!')] });
    const result = await createProjectionAgent({ canvas: f.port, model }).send('Tighten the selected object outline to 3 mask cells and soften the edge to 2. Inspect afterward.');
    assert.deepEqual(model.doGenerateCalls[2].toolChoice, { type: 'tool', toolName: 'inspect_object_mapping' });
    assert.equal(f.operations.length, 1); assert.equal(result.status, failComparison ? 'incomplete' : 'complete');
    assert.match(result.text, /physical alignment is not verified/i); assert.doesNotMatch(result.text, /Looks perfect/);
    if (failComparison) assert.match(result.text, /comparison is still missing/);
  }
});

test('old hosts report unavailable and routing/context exposes mapping only where supported', async () => {
  const f = await setup(); delete f.studio.observeMapping;
  assert.equal((await f.inspect()).ok, false); assert.equal(f.operations.length, 0);
  const current = roomContext(await f.port.getSnapshot(), false, true, true);
  assert.equal(current.capabilities.mappingWorkshop.available, true);
  assert.match(current.capabilities.mappingWorkshop.controls, /paired registered camera\/depth/);
  assert.ok(current.capabilities.unavailable.includes('automatic optical alignment scoring'));
  for (const prompt of ['Tighten the edge', 'Trim the outline', 'Soften the container', 'Show bounding boxes']) {
    assert.ok(createToolSelector(prompt).activeTools(Object.keys(f.bound.tools), []).includes('inspect_object_mapping'));
  }
});

test('OpenAI receives four labeled image inputs; subsequent turns omit historical camera bytes', async () => {
  const f = mappingFixture(), bodies: any[] = [];
  const provider = createOpenAI({ apiKey: 'offline-test-key', fetch: async (_url, init) => {
    const body = JSON.parse(String(init?.body)); bodies.push(body);
    const output = bodies.length === 1 ? [{ type: 'function_call', id: 'fc', call_id: 'look', name: 'inspect_object_mapping', arguments: '{}' }]
      : [{ type: 'message', id: `m${bodies.length}`, role: 'assistant', content: [{ type: 'output_text', text: 'The paired observation is available; optical alignment is not verified.', annotations: [] }] }];
    return new Response(JSON.stringify({ id: `r${bodies.length}`, model: 'gpt-5.4-mini', output, usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } }), { headers: { 'content-type': 'application/json' } });
  } });
  const agent = createProjectionAgent({ canvas: f.port, model: provider('gpt-5.4-mini') });
  await agent.send('Inspect the object mapping without changing it.');
  const wire = JSON.stringify(bodies[1]);
  assert.equal((wire.match(/data:image\/png;base64/g) ?? []).length, 4); assert.match(wire, /Physical RGB/); assert.match(wire, /Computed projector mask/);
  await agent.send('What can be adjusted?'); assert.doesNotMatch(JSON.stringify(bodies[2]), /data:image\/png;base64/);
  assert.deepEqual(f.operations, []);
});
