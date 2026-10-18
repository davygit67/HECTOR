import assert from 'node:assert/strict';
import test from 'node:test';
import { asSchema, type ToolSet } from 'ai';
import { bindCanvasTurn } from '../src/canvas.js';
import { createProjectionAgent } from '../src/projection-agent.js';
import { programTestOutput, programTestOnlyRequest } from '../src/program-tools.js';
import { createToolSelector } from '../src/tool-routing.js';
import { RawMockLanguageModelV4, textReply, toolReply } from './model.js';
import { programFixture, clickingGarden, toolDefinition } from './program-fixture.js';

async function boundFixture() {
  const f = await programFixture();
  const bound = await bindCanvasTurn(f.port, { turnId: 'program-test', prompt: 'Create a custom interactive garden', signal: new AbortController().signal });
  let calls = 0;
  async function call(name: string, input: unknown, callId = `c${++calls}`): Promise<any> {
    const t = (bound.tools as ToolSet)[name]!;
    const validation = await asSchema(t.inputSchema).validate!(input);
    if (!validation.success) throw validation.error;
    return t.execute!(validation.value, { toolCallId: callId, messages: [], context: {} });
  }
  async function create() {
    const candidate = await call('author_program', { surfaceId: 'wall', definition: toolDefinition() });
    assert.equal(candidate.ok, true);
    const applied = await call('apply_program', { testId: candidate.testId, surfaceId: 'wall', contentId: null, expectedRevision: candidate.sceneRevision });
    assert.equal(applied.ok, true); return applied.value.contentId as string;
  }
  return { ...f, bound, call, create };
}

test('author runs actual interpreter and input assertions; apply is separate, paused and preserves other content', async () => {
  const f = await boundFixture();
  await f.port.dispatch({ type: 'timer.create', id: 'tea', title: 'Tea', surfaceId: 'tabletop', durationMs: 60000 });
  const before = f.scene();
  const candidate = await f.call('author_program', { surfaceId: 'wall', definition: toolDefinition() }, 'author');
  assert.equal(candidate.ok, true); assert.equal(candidate.applied, false); assert.equal(candidate.physicallyVerified, false);
  assert.equal(candidate.outcome, 'tested'); assert.equal(candidate.report.passed, true);
  assert.ok(candidate.report.frames >= 33); assert.equal(candidate.report.checks.at(-1).passed, true);
  assert.deepEqual(f.scene(), before);
  assert.deepEqual(await f.call('author_program', { surfaceId: 'wall', definition: toolDefinition() }, 'author'), candidate);
  assert.equal(f.operations.length, 1);
  await assert.rejects(f.call('author_program', { surfaceId: 'tabletop', definition: toolDefinition() }, 'author'), /changed its arguments/);
  const applied = await f.call('apply_program', { testId: candidate.testId, surfaceId: 'wall', contentId: null, expectedRevision: candidate.sceneRevision });
  assert.equal(applied.ok, true); assert.equal(applied.value.paused, true);
  assert.equal(f.scene().contents.length, 1); assert.deepEqual(f.scene().timers, before.timers);
  assert.deepEqual(f.scene().surfaces, before.surfaces);
  const content = f.scene().contents[0]; assert.equal(content.kind, 'program');
  assert.doesNotMatch(JSON.stringify(f.scene()), /init\(ctx\)|update\(state/);
  await f.call('control_content', { contentId: content.id, action: 'start' });
  const running = f.scene().contents[0]; assert.equal(running.kind === 'program' && running.state.clock.running, true);
  assert.match(f.bound.formatReply!({ text: 'Done', toolNames: ['apply_program', 'control_content'] }), /Physical projection has not been verified/);
});

test('failed program keeps actual diagnostics and can be repaired within a shared three-test budget', async () => {
  const f = await boundFixture();
  const bad = toolDefinition(); bad.source = bad.source.replace('score:state.score+', 'score:state.score+2+');
  const failed = await f.call('author_program', { surfaceId: 'wall', definition: bad });
  assert.equal(failed.ok, false); assert.equal(failed.testId, undefined);
  assert.equal(f.bound.requiredTool(), 'author_program');
  assert.match(JSON.stringify(failed.report), /observed 3/); assert.equal(f.scene().contents.length, 0);
  const repaired = await f.call('author_program', { surfaceId: 'wall', definition: toolDefinition() });
  assert.equal(repaired.ok, true); assert.equal(repaired.testsRemaining, 1);
  assert.equal(f.bound.requiredTool(), 'apply_program');
  const third = await f.call('test_program', { surfaceId: 'wall', definition: toolDefinition() });
  assert.equal(third.testsRemaining, 0);
  const fourth = await f.call('author_program', { surfaceId: 'wall', definition: toolDefinition() });
  assert.equal(fourth.ok, false); assert.match(fourth.error, /Three program tests/);
  assert.equal(f.bound.requiredTool(), undefined);
  assert.equal(f.operations.filter(o => o.type === 'program.test').length, 3);
  assert.equal(f.artifacts.size, 1);
});

test('exhausted program repairs retain actionable failure text even without a valid model review', async () => {
  const f = await boundFixture(); const definition = toolDefinition();
  definition.tests[0].assertions[0].path = 'state.score';
  for (let i = 0; i < 3; i++) {
    const result = await f.call('author_program', { surfaceId: 'wall', definition });
    assert.equal(result.ok, false); assert.match(result.nextAction, i < 2 ? /score, not state.score/ : /Test budget exhausted/);
  }
  const text = f.bound.formatReply!({ text: 'Done!', toolNames: ['author_program'] });
  assert.match(text, /not applied after three tests/); assert.match(text, /state.score/);
  assert.equal(f.scene().contents.length, 0);
});

test('changed scene removes candidate pass evidence; forged and changed-revision tokens cannot apply', async () => {
  const f = await boundFixture();
  f.afterTest(() => { void f.port.dispatch({ type: 'grid.set', visible: true }); });
  const stale = await f.call('author_program', { surfaceId: 'wall', definition: toolDefinition() });
  assert.equal(stale.stale, true); assert.equal(stale.ok, false); assert.equal(stale.testId, undefined);
  f.afterTest();
  const fresh = await f.call('author_program', { surfaceId: 'wall', definition: toolDefinition() });
  await f.port.dispatch({ type: 'grid.set', visible: false });
  const changed = await f.call('apply_program', { testId: fresh.testId, surfaceId: 'wall', contentId: null, expectedRevision: f.scene().revision });
  assert.equal(changed.ok, false); assert.match(changed.message, /changed since testing/);
  const forged = await f.call('apply_program', { testId: 'invented-pass', surfaceId: 'wall', contentId: null, expectedRevision: f.scene().revision });
  assert.equal(forged.ok, false); assert.equal(f.scene().contents.length, 0);
});

test('parameter edits preserve identity, clock and placement; inspected revisions and rollback preserve the existing item', async () => {
  const f = await boundFixture(); const id = await f.create();
  await f.call('control_content', { contentId: id, action: 'start' });
  await f.call('arrange_panel', { id, anchor: 'top-right', width: .3, height: .4, margin: .03 });
  await f.call('edit_scene', { command: { type: 'layer.configure', id, settings: { visible: null, locked: null, opacity: .7 } } });
  const before = f.scene().contents[0]; assert.equal(before.kind, 'program');
  const inspected = await f.call('inspect_program', { contentId: id });
  assert.equal(inspected.value.definition.source, clickingGarden.source); assert.equal(inspected.value.canRollback, false);
  const configured = await f.call('configure_program', { contentId: id, parameters: [{ key: 'speed', value: 2 }] });
  assert.equal(configured.ok, true);
  const changed = f.scene().contents[0];
  assert.deepEqual(changed.state, before.state); assert.deepEqual(changed.bounds, before.bounds);
  assert.equal(changed.kind === 'program' && changed.config.artifactId, before.kind === 'program' && before.config.artifactId);
  const duplicate = await f.call('configure_program', { contentId: id, parameters: [{ key: 'speed', value: 1 }, { key: 'speed', value: 2 }] });
  assert.equal(duplicate.ok, false);
  const unknown = await f.call('configure_program', { contentId: id, parameters: [{ key: 'madeUp', value: 1 }] });
  assert.equal(unknown.ok, false);
  const def = toolDefinition(); def.title = 'Gold garden'; def.source = def.source.replace('#35ad55', '#eec344');
  const candidate = await f.call('revise_program', { contentId: id, definition: def });
  assert.equal(candidate.ok, true); assert.deepEqual(f.scene().contents[0], changed);
  const updated = await f.call('apply_program', { testId: candidate.testId, surfaceId: 'wall', contentId: id, expectedRevision: candidate.sceneRevision });
  assert.equal(updated.ok, true); assert.equal(updated.value.paused, true);
  assert.equal(updated.value.parameters.speed, 2);
  assert.equal(f.scene().contents.length, 1); assert.deepEqual(f.scene().contents[0].bounds, before.bounds);
  assert.deepEqual(f.scene().contents[0].layer, before.layer);
  assert.equal(f.scene().contents[0].layer?.opacity, .7);
  const uninspected = await f.call('revise_program', { contentId: id, definition: def });
  assert.equal(uninspected.ok, false); assert.match(uninspected.error, /Inspect/);
  const restored = await f.call('rollback_program', { contentId: id });
  assert.equal(restored.ok, true); assert.equal(restored.value.paused, true); assert.equal(restored.value.parameters.speed, 2);
  assert.equal(restored.value.artifactId, before.kind === 'program' && before.config.artifactId);
});

test('invalid input fails at the strict boundary without running or changing a scene', async () => {
  const f = await boundFixture(); const invalid = toolDefinition(); invalid.parameters[0].key = '__proto__';
  await assert.rejects(f.call('author_program', { surfaceId: 'wall', definition: invalid }));
  await assert.rejects(f.call('configure_program', { contentId: 'x', parameters: [{ key: 'speed', value: 1 }], source: 'extra' }));
  const noInput = toolDefinition({ ...clickingGarden, tests: [{ name: 'Idle does not score', steps: [{ dt: .016 }], assertions: [{ path: 'score', op: 'eq', value: 0 }] }] });
  const result = await f.call('test_program', { surfaceId: 'wall', definition: noInput });
  assert.equal(result.ok, true);
  const operation = f.operations[0]; assert.equal(operation.type === 'program.test' && operation.definition.tests[0].steps[0].input, undefined);
  assert.equal(f.scene().contents.length, 0);
});

test('candidate render output labels evidence and strips stale or oversized images', () => {
  const preview = { mimeType: 'image/png', data: 'aGVsbG8=', width: 960, height: 540 };
  const valid = programTestOutput({ ok: true, report: { passed: true }, preview });
  assert.equal(valid.type, 'content'); if (valid.type !== 'content') return;
  assert.equal(valid.value.length, 2); assert.match(JSON.stringify(valid.value[0]), /not deployed content or physical projection/);
  for (const input of [{ stale: true, preview }, { preview: { ...preview, width: 4000 } }, { preview: { ...preview, data: 'x'.repeat(2_000_001) } }]) {
    const rejected = programTestOutput(input); assert.equal(rejected.type === 'content' && rejected.value.length, 1);
  }
});

test('custom visuals receive SDK while ordinary chat stays lean and program inspection unlocks ambiguous follow-ups', async () => {
  const f = await boundFixture(); assert.equal(f.bound.mayAuthorProgram!(), true);
  assert.match(await f.bound.instructions(), /Projection SDK 1: Create/);
  for (const prompt of ['Frolicking leprechauns around clovers', 'Make the custom game slower']) {
    const selector = createToolSelector(prompt); assert.equal(selector.programsEnabled(), true);
    assert.ok(selector.activeTools(Object.keys(f.bound.tools), []).includes('author_program'));
  }
  const ambiguous = createToolSelector('Make it slower');
  assert.equal(ambiguous.programsEnabled(), false);
  assert.equal(ambiguous.activeTools(Object.keys(f.bound.tools), []).includes('author_program'), false);
  assert.ok(ambiguous.activeTools(Object.keys(f.bound.tools), []).includes('inspect_program'));
  assert.ok(ambiguous.activeTools(Object.keys(f.bound.tools), ['inspect_program']).includes('revise_program'));
  const hello = await bindCanvasTurn(f.port, { turnId: 'hello', prompt: 'Hello', signal: new AbortController().signal });
  assert.equal(hello.mayAuthorProgram(), false);
  assert.doesNotMatch(await hello.instructions(), /Projection SDK 1: Create/);
  const timer = await bindCanvasTurn(f.port, { turnId: 'timer', prompt: 'Start a three minute timer', signal: new AbortController().signal });
  assert.equal(timer.mayAuthorProgram!(), false);
  assert.doesNotMatch(await timer.instructions(), /Projection SDK 1: Create/);
});

test('current program failures reach context without large state, and read-only inspection keeps its answer', async () => {
  const f = await boundFixture(); const id = await f.create();
  const item = f.scene().contents[0]; assert.ok(item.kind === 'program');
  const original = f.port.studio!.inspect;
  f.port.studio!.inspect = async () => ({ ...await original(), programs: [{ contentId: id, artifactId: item.config.artifactId,
    revision: f.scene().revision, status: 'error', message: 'Frame exceeded its CPU limit', time: 1, frameMs: 25,
    state: { privateRuntimeState: 'x'.repeat(32000) } }] });
  const instructions = await f.bound.instructions();
  assert.match(instructions, /Frame exceeded its CPU limit/); assert.doesNotMatch(instructions, /privateRuntimeState/);
  const model = new RawMockLanguageModelV4({ doGenerate: [toolReply('inspect_program', { contentId: id }, 'read'), textReply('The saved program has a speed control.')] });
  const before = f.scene();
  const result = await createProjectionAgent({ canvas: f.port, model }).send('Inspect my program without changing it.');
  assert.equal(result.text, 'The saved program has a speed control.'); assert.deepEqual(f.scene(), before);
});

test('explicit preview-only requests offer standalone testing and cannot apply a passing candidate', async () => {
  assert.equal(programTestOnlyRequest('Write code only, without changing the canvas.'), true);
  assert.equal(programTestOnlyRequest('Test and apply it. Do not apply it until it passes.'), false);
  const f = await programFixture();
  const bound = await bindCanvasTurn(f.port, { turnId: 'preview', prompt: 'Only preview the custom animation, do not apply it.', signal: new AbortController().signal });
  assert.ok(bound.activeTools().includes('test_program'));
  assert.equal(bound.activeTools().includes('author_program'), false); assert.equal(bound.activeTools().includes('apply_program'), false);
  const result = await (bound.tools as ToolSet).test_program!.execute!({ surfaceId: 'wall', definition: toolDefinition() }, { toolCallId: 'test', messages: [], context: {} }) as any;
  assert.equal(result.ok, true); assert.equal(bound.requiredTool(), undefined);
  const blocked = await bound.tools.apply_program!.execute!({ surfaceId: 'wall', testId: result.testId, expectedRevision: result.sceneRevision, contentId: null }, { toolCallId: 'apply', messages: [], context: {} }) as any;
  assert.equal(blocked.ok, false); assert.match(blocked.error, /test\/preview-only/);
  assert.equal(f.scene().contents.length, 0);
});

test('program repair cannot consume the final reserved review step', async () => {
  const f = await programFixture(); const bad = toolDefinition(); bad.source = '({';
  const model = new RawMockLanguageModelV4({ doGenerate: [
    toolReply('author_program', { surfaceId: 'wall', definition: bad }, 'bad1'),
    toolReply('author_program', { surfaceId: 'wall', definition: bad }, 'bad2'),
    toolReply('review_request', { requirements: [{ id: 'garden', request: 'Create a custom garden', status: 'pending', evidence: [], reason: 'Code still fails parsing; no program has been applied.' }] }, 'review'),
  ] });
  const result = await createProjectionAgent({ canvas: f.port, model, maxSteps: 3 }).send('Create a custom garden on the wall.');
  assert.equal(result.status, 'incomplete'); assert.equal(result.steps, 3); assert.equal(f.scene().contents.length, 0);
  assert.deepEqual(model.doGenerateCalls[1].toolChoice, { type: 'tool', toolName: 'author_program' });
  assert.deepEqual(model.doGenerateCalls[2].toolChoice, { type: 'tool', toolName: 'review_request' });
  assert.match(result.text, /Code still fails parsing/);
});

test('agent repairs failing original code then applies and starts it with grounded completion evidence', async () => {
  const f = await programFixture(); let step = 0, candidate: any;
  const bad = toolDefinition(); bad.source = bad.source.replace('score:state.score+', 'score:state.score+2+');
  const model = new RawMockLanguageModelV4({ doGenerate: async call => {
    step++;
    if (step === 1) return toolReply('author_program', { surfaceId: 'wall', definition: bad }, 'bad');
    if (step === 2) { assert.match(JSON.stringify(call.prompt), /observed 3/); return toolReply('author_program', { surfaceId: 'wall', definition: toolDefinition() }, 'fixed'); }
    if (step === 3) {
      const result = call.prompt.flatMap(m => m.role === 'tool' ? m.content : []).find(p => p.type === 'tool-result' && p.toolCallId === 'fixed');
      assert.ok(result && result.type === 'tool-result' && result.output.type === 'content');
      const text = result.output.value.find(p => p.type === 'text'); assert.ok(text?.type === 'text'); candidate = JSON.parse(text.text);
      return toolReply('apply_program', { testId: candidate.testId, surfaceId: 'wall', contentId: null, expectedRevision: candidate.sceneRevision }, 'apply');
    }
    if (step === 4) return toolReply('control_content', { contentId: f.scene().contents[0].id, action: 'start' }, 'start');
    if (step === 5) return textReply('The garden is ready.');
    return toolReply('review_request', { requirements: [{ id: 'garden', request: 'Create and start a custom interactive garden', status: 'completed', evidence: ['apply', 'start'], reason: null }] }, 'review');
  } });
  const result = await createProjectionAgent({ canvas: f.port, model }).send('Create and start a custom interactive garden on the wall.');
  assert.equal(result.status, 'complete'); assert.equal(f.scene().contents.length, 1);
  assert.equal(f.operations.filter(o => o.type === 'program.test').length, 2);
  assert.equal(f.operations.filter(o => o.type === 'program.apply').length, 1);
  assert.equal(model.doGenerateCalls[0].maxOutputTokens, 6000);
  assert.deepEqual(model.doGenerateCalls[1].toolChoice, { type: 'tool', toolName: 'author_program' });
  assert.deepEqual(model.doGenerateCalls[2].toolChoice, { type: 'tool', toolName: 'apply_program' });
  assert.equal(model.doGenerateCalls.at(-1)!.maxOutputTokens, 1500);
  assert.doesNotMatch(result.text, /all tests failed|physically verified/i);
});
