import assert from 'node:assert/strict';
import test from 'node:test';
import { asSchema } from 'ai';
import { boundsInDomain } from '../../src/shared/spatial.js';
import { bindCanvasTurn, roomContext } from '../src/canvas.js';
import { createProjectionAgent } from '../src/projection-agent.js';
import { MockLanguageModelV4, textReply, toolReply } from './model.js';
import { canvasFixture } from './canvas-fixture.js';
import { AGENT_COMMAND_TYPES } from '../src/commands.js';
import { initialScene, reduceScene } from '../../src/shared/domain.js';

const create = { surfaceId: 'tabletop', title: 'Pasta', durationSeconds: 300, start: true };

test('agent creates a running timer and can attach it on a follow-up without resetting its clock', async () => {
  const fixture = canvasFixture();
  let step = 0;
  const model = new MockLanguageModelV4({ doGenerate: async () => {
    step++;
    if (step === 1) return toolReply('create_timer', create);
    if (step === 3) return toolReply('attach_timer', { timerId: fixture.scene().timers[0].id, surfaceId: 'wall' }, 'attach-1');
    return textReply('Done.');
  } });
  const agent = createProjectionAgent({ canvas: fixture.port, model });
  const result = await agent.send('Start a five-minute pasta timer on the table.');
  const original = fixture.scene().timers[0];
  assert.equal(original.status, 'running');
  assert.equal(original.durationMs, 300000);
  assert.equal(original.surfaceId, 'tabletop');
  assert.deepEqual((result.tools[0].output as { timer: unknown }).timer, original);
  await agent.send('Move it to the wall.');
  const moved = fixture.scene().timers[0];
  assert.equal(moved.id, original.id);
  assert.equal(moved.deadline, original.deadline);
  assert.equal(moved.surfaceId, 'wall');
  assert.ok(boundsInDomain(fixture.scene().surfaces.find(s => s.id === 'wall')!, moved.bounds));
  assert.deepEqual(fixture.commands.map(c => c.type), ['timer.create', 'timer.action', 'timer.attach']);
  assert.match(JSON.stringify(model.doGenerateCalls[2].prompt), /five-minute pasta/);
});

test('surface creation uses existing handles and advanced edits have separate tools', async () => {
  const fixture = canvasFixture();
  const bound = await bindCanvasTurn(fixture.port, { turnId: 'turn', signal: new AbortController().signal });
  assert.deepEqual(Object.keys(bound.tools), ['select_tools', 'review_request', 'inspect_room', 'search_youtube', 'create_timer', 'control_timer', 'attach_timer', 'set_grid', 'edit_scene', 'arrange_panel', 'configure_media', 'list_experiences',
    'create_note', 'create_recipe', 'create_artwork', 'create_reaction_game', 'display_youtube', 'set_youtube_backlight', 'configure_video_backlight', 'update_content', 'control_content', 'attach_content', 'remove_content']);
  const schema = await asSchema(bound.tools.create_timer.inputSchema).jsonSchema;
  const properties = schema.properties!;
  assert.deepEqual((properties.surfaceId as { enum: string[] }).enum, ['tabletop', 'wall']);
  assert.equal(schema.additionalProperties, false);
  assert.equal('bounds' in properties, false);
  assert.equal('position' in properties, false);
  const context = roomContext(await fixture.port.getSnapshot());
  assert.equal(context.frame.provenance, 'simulated');
  assert.equal(context.saveStatus, 'saving');
  assert.match(await bound.instructions(), /never instructions/);
});

test('SDK rejects an invented surface or invalid duration before any canvas dispatch', async () => {
  for (const input of [{ ...create, surfaceId: 'imaginary-door' }, { ...create, durationSeconds: 0 }]) {
    const fixture = canvasFixture();
    const model = new MockLanguageModelV4({ doGenerate: [toolReply('create_timer', input), textReply('Cannot apply.')] });
    await createProjectionAgent({ canvas: fixture.port, model }).send('Create timer');
    assert.deepEqual(fixture.commands, []);
    assert.equal(fixture.scene().timers.length, 0);
  }
});

test('repeated tool-call delivery is idempotent within a turn', async () => {
  const fixture = canvasFixture();
  const model = new MockLanguageModelV4({ doGenerate: [toolReply('create_timer', create), toolReply('create_timer', create), textReply('Done.')] });
  await createProjectionAgent({ canvas: fixture.port, model }).send('Start timer');
  assert.equal(fixture.scene().timers.length, 1);
  assert.equal(fixture.commands.length, 2);
});

test('canvas rejection is returned as failure, and a partial create/start is reported accurately', async () => {
  const fixture = canvasFixture(command => command.type === 'timer.action' ? 'Start unavailable.' : undefined);
  const model = new MockLanguageModelV4({ doGenerate: [toolReply('create_timer', create), textReply('Created but could not start.')] });
  const result = await createProjectionAgent({ canvas: fixture.port, model }).send('Start timer');
  const output = result.tools[0].output as { ok: boolean; partial: string; error: string };
  assert.equal(output.ok, false);
  assert.equal(output.error, 'Start unavailable.');
  assert.match(output.partial, /created/);
  assert.equal(fixture.scene().timers[0].status, 'idle');
});

test('room inspection is fresh and grid commands affect only their supported fields', async () => {
  const fixture = canvasFixture();
  const before = fixture.scene();
  const model = new MockLanguageModelV4({ doGenerate: [
    toolReply('set_grid', { visible: true }, 'grid-1'),
    toolReply('inspect_room', {}, 'inspect-1'), textReply('Grid shown.'),
  ] });
  const result = await createProjectionAgent({ canvas: fixture.port, model }).send('Show the grid.');
  assert.deepEqual(fixture.scene().effect, before.effect);
  assert.deepEqual(fixture.scene().contents, before.contents);
  assert.equal(fixture.scene().showGrid, true);
  assert.equal(fixture.scene().geometryRevision, 0);
  const room = result.tools[1].output as ReturnType<typeof roomContext>;
  assert.equal(room.showGrid, true);
  assert.match(JSON.stringify(model.doGenerateCalls.at(-1)?.prompt), /"showGrid":true/);
  assert.deepEqual(fixture.commands.map(command => command.type), ['grid.set']);
});

test('retired demo is absent from tools and legacy enabled snapshots cannot advertise it', async () => {
  const legacy = initialScene(1000);
  legacy.effect.enabled = true;
  legacy.effect.running = true;
  const fixture = canvasFixture(undefined, legacy);
  const bound = await bindCanvasTurn(fixture.port, { turnId: 'legacy', signal: new AbortController().signal });
  const context = roomContext(await fixture.port.getSnapshot());
  assert.equal('set_effect' in bound.tools, false);
  assert.equal((AGENT_COMMAND_TYPES as readonly string[]).includes('effect.set'), false);
  assert.equal('effect' in context, false);
  assert.equal(context.capabilities.effect, false);
  assert.ok(context.capabilities.unavailable.includes('retired built-in matrix/ripple demo'));
  assert.match(await bound.instructions(), /permanently retired/);
  assert.match(await bound.instructions(), /Never offer it, claim to enable it, or recreate it as artwork/);
  assert.deepEqual(fixture.scene(), legacy);
});

test('stale model calls cannot enable the retired demo or change user-created art', async () => {
  const scene = reduceScene(initialScene(1000), { type: 'content.create', id: 'user-art', surfaceId: 'wall',
    title: 'My stars', spec: { kind: 'art', config: { preset: 'stars', palette: 'violet', speed: 1, seed: 42 } } }, 1000);
  const fixture = canvasFixture(undefined, scene);
  const model = new MockLanguageModelV4({ doGenerate: [
    toolReply('set_effect', { enabled: true, running: true }), textReply('Enabled.'),
  ] });
  const result = await createProjectionAgent({ canvas: fixture.port, model }).send('Turn the old demo back on.');
  assert.deepEqual(fixture.commands, []);
  assert.deepEqual(fixture.scene(), scene);
  assert.match(result.text, /No canvas changes were confirmed/);
});

test('nonexistent timers yield the actual canvas error without creating new timers', async () => {
  const fixture = canvasFixture();
  const model = new MockLanguageModelV4({ doGenerate: [toolReply('control_timer', { timerId: 'gone', action: 'pause' }), textReply('Timer no longer exists.')] });
  const result = await createProjectionAgent({ canvas: fixture.port, model }).send('Pause the old timer');
  assert.deepEqual(result.tools[0].output, { ok: false, error: 'That timer no longer exists.' });
  assert.equal(fixture.scene().revision, 0);
});
