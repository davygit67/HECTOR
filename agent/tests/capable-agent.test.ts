import assert from 'node:assert/strict';
import test from 'node:test';
import { asSchema, type ModelMessage, type ToolSet } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { initialScene, reduceScene } from '../../src/shared/domain.js';
import { MEDIA_DEFAULTS, mediaTime } from '../../src/shared/mediaContent.js';
import type { StudioPort, StudioSnapshot, StudioOperation, StudioObservation } from '../../src/shared/studio.js';
import { createProjectionAgent } from '../src/projection-agent.js';
import { bindCanvasTurn, roomContext } from '../src/canvas.js';
import { createMemoryStore } from '../src/memory.js';
import { experienceCommands } from '../src/experiences.js';
import { boundedHistory, focusedRoomContext } from '../src/context.js';
import { createToolSelector } from '../src/tool-routing.js';
import { observationOutput } from '../src/studio-tools.js';
import { canvasFixture } from './canvas-fixture.js';
import { MockLanguageModelV4, textReply, toolReply } from './model.js';
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
function studioFixture() {
  const fixture = canvasFixture(); const operations: StudioOperation[] = []; let captures = 0;
  const inspect = async (): Promise<StudioSnapshot> => ({
    roomId: 'test-room', sceneRevision: fixture.scene().revision, geometryRevision: 0,
    ui: { page: 'studio', view: 'arrange', inspector: 'assistant', fullscreen: false }, output: { open: false, fullscreen: false, displayId: null }, saveStatus: 'saved', saveError: null,
    media: [], assets: [], compositions: [], hardware: { initialized: false, mode: 'demo', connection: 'off', message: 'Disconnected', provenance: 'unknown', busy: false, canAcquire: false, frames: 0, recording: false, capturing: false, sessions: [], geometrySolved: false },
    capabilities: { sceneBatch: true, observation: true, nativeMedia: true, nativeOutput: true, fileImportRequiresClick: true, physicalObservation: false },
  });
  const studio: StudioPort = {
    inspect,
    async execute(op) { operations.push(op); return { ok: true, outcome: op.type === 'asset.import' ? 'handoff' : 'applied', message: op.type === 'asset.import' ? 'Choose your file in the import panel.' : 'Controls updated.', sceneRevision: fixture.scene().revision }; },
    async observe(request): Promise<StudioObservation> { captures++; return { kind: 'rendered-surface', sceneRevision: fixture.scene().revision, geometryRevision: 0, at: Date.now(), physical: false, surfaceId: request.surfaceId ?? 'wall', stale: false,
      image: { mimeType: 'image/png', data: png, width: 1, height: 1 }, runtime: await inspect(), limitations: ['Synthetic test fixture; no physical image.'] }; },
  };
  fixture.port.studio = studio;
  return { ...fixture, studio, operations, captures: () => captures };
}
const modelCall = (fixture: ReturnType<typeof canvasFixture>, name: string, args: unknown) => createProjectionAgent({ canvas: fixture.port,
  model: new MockLanguageModelV4({ doGenerate: [toolReply(name, args), textReply('Done')] }) }).send('Apply my requested change.');

test('scene layout controls preserve clocks, respect locks and return constrained bounds', async () => {
  let scene = reduceScene(initialScene(1), { type: 'timer.create', id: 'timer', title: 'Pasta', durationMs: 60000, surfaceId: 'tabletop' }, 1);
  scene = reduceScene(scene, { type: 'timer.action', id: 'timer', action: 'start' }, 1);
  const fixture = canvasFixture(undefined, scene);
  await modelCall(fixture, 'arrange_panel', { id: 'timer', anchor: 'bottom-right', width: .3, height: .2, margin: .04 });
  const moved = fixture.scene().timers[0]; assert.equal(moved.deadline, 60001); assert.ok(moved.bounds.x > .5); assert.equal(moved.bounds.w, .3);
  await modelCall(fixture, 'edit_scene', { command: { type: 'layer.configure', id: 'timer', settings: { visible: null, locked: true, opacity: .6 } } });
  const locked = fixture.scene();
  const rejected = await modelCall(fixture, 'arrange_panel', { id: 'timer', anchor: 'center', width: null, height: null, margin: 0 });
  assert.match(rejected.text, /Unlock/); assert.deepEqual(fixture.scene(), locked);
  await modelCall(fixture, 'edit_scene', { command: { type: 'display.configure', settings: { quality: null, brightness: 1.4, blackout: null } } });
  assert.equal(fixture.scene().display?.brightness, 1.4); assert.equal(fixture.scene().timers[0].deadline, 60001);
});
test('media presentation patch preserves source identity and playback clock and allows UI saturation range', async () => {
  let scene = reduceScene(initialScene(1), { type: 'content.create', id: 'media', surfaceId: 'wall', title: 'Clip', spec: { kind: 'media', config: {
    ...MEDIA_DEFAULTS, assetId: 'asset-fixture', mediaType: 'video', fileName: 'clip.mp4', mimeType: 'video/mp4', width: 1920, height: 1080, duration: 30,
  } } }, 1);
  scene = reduceScene(scene, { type: 'content.action', id: 'media', action: 'start' }, 1);
  const fixture = canvasFixture(undefined, scene); const before = fixture.scene().contents[0];
  await modelCall(fixture, 'configure_media', { id: 'media', settings: { fit: 'cover', loop: null, playbackRate: null, volume: null, muted: null, rotation: 90, flipX: null, flipY: null, brightness: null, contrast: null, saturation: 2.8 } });
  const after = fixture.scene().contents[0]; assert.equal(after.kind, 'media');
  if (after.kind === 'media') { assert.equal(after.config.assetId, 'asset-fixture'); assert.equal(after.config.saturation, 2.8); assert.equal(after.config.fit, 'cover'); }
  if (after.kind === 'media' && before.kind === 'media') { assert.equal(after.state.clock.running, before.state.clock.running); assert.equal(mediaTime(after.config, after.state.clock, 1000), mediaTime(before.config, before.state.clock, 1000)); }
  assert.deepEqual(after.bounds, before.bounds);
});
test('runtime calls are once-only and file import reports an honest handoff', async () => {
  const fixture = studioFixture(); const model = new MockLanguageModelV4({ doGenerate: [toolReply('operate_studio', { operation: { type: 'asset.import' } }, 'same'), toolReply('operate_studio', { operation: { type: 'asset.import' } }, 'same'), textReply('File uploaded!')] });
  const result = await createProjectionAgent({ canvas: fixture.port, model }).send('Import a video');
  assert.equal(fixture.operations.length, 1); assert.match(result.text, /Your action is needed/); assert.doesNotMatch(result.text, /uploaded/);
});
test('visual observations are bounded, stale images are excluded and geometry provenance remains explicit', async () => {
  const fixture = studioFixture(); const bound = await bindCanvasTurn(fixture.port, { turnId: 'visual', signal: new AbortController().signal });
  const call = (toolCallId: string) => bound.tools.inspect_visual!.execute!({ surfaceId: 'wall' }, { toolCallId, messages: [], context: {} });
  const first = await call('one') as StudioObservation; await call('two'); const third = await call('three') as { ok: boolean };
  assert.equal(first.physical, false); assert.equal(fixture.captures(), 2); assert.equal(third.ok, false);
  const current = observationOutput(first); assert.equal(current.type, 'content');
  if (current.type === 'content') assert.equal(current.value.some(p => p.type === 'file'), true);
  const stale = observationOutput({ ...first, stale: true });
  if (stale.type === 'content') assert.equal(stale.value.some(p => p.type === 'file'), false);
  const changed = studioFixture(); const original = changed.studio.observe;
  changed.studio.observe = async request => { const observation = await original(request); await changed.port.dispatch({ type: 'grid.set', visible: true }); return observation; };
  const changedBound = await bindCanvasTurn(changed.port, { turnId: 'stale', signal: new AbortController().signal });
  const observed = await changedBound.tools.inspect_visual!.execute!({ surfaceId: null }, { toolCallId: 'changed', messages: [], context: {} }) as StudioObservation;
  assert.equal(observed.stale, true);
});
test('experience recipes reuse existing art and reject overcapacity before runtime mutation', async () => {
  let scene = reduceScene(initialScene(1), { type: 'timer.create', id: 'timer', surfaceId: 'wall', title: 'Keep', durationMs: 60000 }, 1);
  scene = reduceScene(scene, { type: 'content.create', id: 'art', surfaceId: 'wall', title: 'Existing', spec: { kind: 'art', config: { preset: 'stars', palette: 'ember', speed: 1, seed: 50 } } }, 1);
  const input = { experience: 'underwater' as const, primarySurfaceId: 'wall', secondarySurfaceId: 'tabletop', sourceContentId: null };
  const commands = experienceCommands(scene, input, 'test'); assert.equal(commands[0].type, 'content.update');
  let result = scene; for (const c of commands) result = reduceScene(result, c, 1);
  assert.deepEqual(result.timers, scene.timers); assert.deepEqual(result.manualOutput, scene.manualOutput); assert.equal(result.contents.find(c => c.id === 'art')?.kind, 'art');
  const full = studioFixture();
  for (let n = 0; n < 5; n++) await full.port.dispatch({ type: 'content.create', id: `note-${n}`, surfaceId: 'wall', title: 'Keep', spec: { kind: 'note', config: { text: 'Keep', accent: '#ffffff' } } });
  const reply = await modelCall(full, 'apply_experience', input);
  assert.equal(full.operations.length, 0); assert.match(reply.text, /slots/); assert.equal(full.scene().contents.length, 5);
});
test('agent memory retrieval is room-scoped and survives clearing chat without changing the room', async () => {
  const fixture = canvasFixture(); const model = new MockLanguageModelV4({ doGenerate: [textReply('Understood'), textReply('Understood')] });
  const agent = createProjectionAgent({ canvas: fixture.port, model, roomId: 'room-a' });
  await agent.memory.put({ kind: 'preference', roomId: 'room-a', text: 'Use gentle video light.' });
  await agent.memory.put({ kind: 'preference', roomId: 'room-b', text: 'Use bright red everywhere.' });
  await agent.send('What lighting do I like?'); agent.clear(); await agent.send('What lighting do I like?');
  const prompt = JSON.stringify(model.doGenerateCalls[1].prompt);
  assert.match(prompt, /gentle video light/); assert.doesNotMatch(prompt, /bright red everywhere/); assert.deepEqual(fixture.commands, []);
});
test('focused context is smaller while retaining boundaries, authoritative IDs and critical instruction trust', async () => {
  const fixture = canvasFixture(); const snapshot = await fixture.port.getSnapshot();
  const full = JSON.stringify(roomContext(snapshot)); const focused = JSON.stringify(focusedRoomContext(snapshot, 'Start a timer', false));
  assert.ok(focused.length < full.length * .8); assert.match(focused, /boundary/); assert.match(focused, /tabletop/);
  const bound = await bindCanvasTurn(fixture.port, { turnId: 'context', prompt: 'Start a timer', signal: new AbortController().signal }, { memory: createMemoryStore() });
  assert.match(await bound.instructions(), /Search metadata.*untrusted/);
  const history: ModelMessage[][] = [[{ role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'look', toolName: 'inspect_visual', input: {} }] },
    { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'look', toolName: 'inspect_visual', output: { type: 'content', value: [{ type: 'text', text: 'Revision 2' }, { type: 'file', mediaType: 'image/png', data: { type: 'data', data: png } }] } }] }]];
  const compact = JSON.stringify(boundedHistory(history)); assert.doesNotMatch(compact, /iVBOR/); assert.match(compact, /Revision 2/); assert.match(compact, /tool-call/);
});
test('all expanded tools have strict OpenAI-compatible schemas, including runtime unions', async () => {
  const fixture = studioFixture(); const bound = await bindCanvasTurn(fixture.port, { turnId: 'schema', signal: new AbortController().signal }, { memory: createMemoryStore() });
  function check(s: any) {
    assert.equal('oneOf' in s, false);
    if (s.type === 'object') { assert.equal(s.additionalProperties, false); assert.deepEqual([...(s.required ?? [])].sort(), Object.keys(s.properties).sort()); Object.values(s.properties).forEach(check); }
    if (s.items) check(s.items); for (const option of s.anyOf ?? []) check(option);
  }
  for (const value of Object.values(bound.tools as ToolSet)) check(await asSchema(value!.inputSchema).jsonSchema);
  assert.equal(Object.keys(bound.tools).length, 27);
});
test('OpenAI wire carries the actual preview as image input, then strips it from later turns', async () => {
  const fixture = studioFixture(); const bodies: any[] = [];
  const provider = createOpenAI({ apiKey: 'offline-test-key', fetch: async (_url, init) => {
    const body = JSON.parse(String(init?.body)); bodies.push(body);
    const output = bodies.length === 1 ? [{ type: 'function_call', id: 'fc', call_id: 'look', name: 'inspect_visual', arguments: JSON.stringify({ surfaceId: 'wall' }) }]
      : [{ type: 'message', id: `m${bodies.length}`, role: 'assistant', content: [{ type: 'output_text', text: 'Preview inspected.', annotations: [] }] }];
    return new Response(JSON.stringify({ id: `r${bodies.length}`, model: 'gpt-5.4-mini', output, usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } }), { headers: { 'content-type': 'application/json' } });
  } });
  const agent = createProjectionAgent({ canvas: fixture.port, model: provider.responses('gpt-5.4-mini') });
  await agent.send('Inspect the wall preview.'); assert.match(JSON.stringify(bodies[1].input), /input_image/); assert.match(JSON.stringify(bodies[1].input), /iVBOR/);
  await agent.send('What did you inspect?'); assert.doesNotMatch(JSON.stringify(bodies[2].input), /iVBOR/);
});

test('tool selection starts narrow and can expose every capability without changing the scene', async () => {
  const selector = createToolSelector('Start a timer');
  const available = ['inspect_room', 'select_tools', 'create_timer', 'edit_scene', 'configure_media', 'operate_studio'];
  assert.equal(selector.activeTools(available, []).includes('configure_media'), false);
  await selector.tools.select_tools.execute!({ categories: ['all'] }, { toolCallId: 'expand', messages: [], context: {} });
  assert.deepEqual(selector.activeTools(available, []), available);
});
test('UI configuration preserves omitted inspector selection and supports explicit collapse', async () => {
  const fixture = studioFixture();
  await modelCall(fixture, 'operate_studio', { operation: { type: 'ui.configure', coverage: true, previews: null, interact: null, resetView: null, expandedAssetId: null, collapseAsset: false } });
  assert.deepEqual(fixture.operations[0], { type: 'ui.configure', coverage: true });
  await modelCall(fixture, 'operate_studio', { operation: { type: 'ui.configure', coverage: null, previews: null, interact: null, resetView: null, expandedAssetId: null, collapseAsset: true } });
  assert.deepEqual(fixture.operations[1], { type: 'ui.configure', expandedAssetId: null });
});

test('videos loaded by a saved composition become grounded references on the next model step', async () => {
  const fixture = studioFixture();
  fixture.studio.execute = async operation => {
    if (operation.type === 'composition.recall') await fixture.port.dispatch({ type: 'content.create', id: 'saved-video', surfaceId: 'wall', title: 'Saved video', spec: { kind: 'youtube', config: { videoId: 'I5QMtbO-DNk', startSeconds: 0, backlight: true } } });
    return { ok: true, outcome: 'applied', message: 'Composition recalled.', sceneRevision: fixture.scene().revision };
  };
  const model = new MockLanguageModelV4({ doGenerate: [toolReply('operate_studio', { operation: { type: 'composition.recall', id: 'saved' } }, 'recall'),
    toolReply('update_content', { contentId: 'saved-video', title: 'Cinema', spec: { kind: 'youtube', config: { videoId: 'I5QMtbO-DNk', startSeconds: 0, backlight: false, backlightSettings: null } } }, 'update'), textReply('Done')] });
  await createProjectionAgent({ canvas: fixture.port, model }).send('Recall my saved composition and disable the video backlight.');
  const content = fixture.scene().contents[0]; assert.equal(content.kind, 'youtube'); if (content.kind === 'youtube') assert.equal(content.config.backlight, false);
});
