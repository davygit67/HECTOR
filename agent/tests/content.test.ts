import assert from 'node:assert/strict';
import test from 'node:test';
import { asSchema } from 'ai';
import { CONTENT_LIMITS, CONTENT_REGISTRY, type ContentInstance } from '../../src/shared/content.js';
import { boundsInDomain } from '../../src/shared/spatial.js';
import { overlaps } from '../../src/shared/layout.js';
import { initialScene, readScene, reduceScene } from '../../src/shared/domain.js';
import { bindCanvasTurn, roomContext } from '../src/canvas.js';
import { createProjectionAgent } from '../src/projection-agent.js';
import { canvasFixture } from './canvas-fixture.js';
import { MockLanguageModelV4, textReply, toolReply } from './model.js';

const note = { surfaceId: 'tabletop', title: 'Remember', text: 'Water the plants', accent: '#aabbcc' };
const recipe = { surfaceId: 'tabletop', title: 'User recipe', ingredients: ['User-supplied ingredient'], steps: ['User-supplied step 1', 'User-supplied step 2'], source: '' };
const art = { surfaceId: 'wall', title: 'Night', preset: 'stars', palette: 'violet', speed: 1, seed: 42 };
const game = { surfaceId: 'tabletop', title: 'Targets', rounds: 8, seed: 42, start: true };
type Receipt = { ok: boolean; revision?: number; content?: ContentInstance; error?: string; partial?: string };

function driver(fixture = canvasFixture()) {
  let next = textReply('Ready');
  let consumed = false;
  let counter = 0;
  const model = new MockLanguageModelV4({ doGenerate: async () => {
    if (!consumed) { consumed = true; return next; }
    return textReply('Done');
  } });
  const agent = createProjectionAgent({ canvas: fixture.port, model });
  return {
    fixture, agent, model,
    async call(name: string, input: unknown) {
      next = toolReply(name, input, `call-${++counter}`);
      consumed = false;
      return agent.send(`Perform test action ${counter}.`);
    },
  };
}

test('all four content creation tools use canonical state and report accepted bounds', async () => {
  for (const [name, input, kind] of [
    ['create_note', note, 'note'], ['create_recipe', recipe, 'recipe'],
    ['create_artwork', art, 'art'], ['create_reaction_game', game, 'game'],
  ] as const) {
    const d = driver();
    const result = await d.call(name, input);
    const scene = d.fixture.scene();
    const content = scene.contents[0];
    assert.equal(content.kind, kind);
    assert.deepEqual((result.tools[0].output as Receipt).content, content);
    if (kind === 'art') assert.deepEqual(content.bounds, { x: 0, y: 0, w: 1, h: 1 });
    else assert.ok(boundsInDomain(scene.surfaces.find(s => s.id === content.surfaceId)!, content.bounds));
    if (content.kind === 'recipe') assert.equal(content.state.stepIndex, -1);
    if (content.kind === 'art') assert.equal(content.state.clock.running, true);
    if (content.kind === 'game') { assert.equal(content.state.status, 'running'); assert.equal(content.state.score, 0); }
    assert.equal(readScene(scene).schemaVersion, 3);
  }
});

test('mixed timers/cards/background retain valid native placement across surfaces', async () => {
  const d = driver();
  await d.call('create_timer', { surfaceId: 'tabletop', title: 'Pasta', durationSeconds: 300, start: true });
  await d.call('create_note', note);
  await d.call('create_recipe', { ...recipe, surfaceId: 'wall' });
  await d.call('create_artwork', { ...art, surfaceId: 'tabletop' });
  const scene = d.fixture.scene();
  assert.equal(scene.timers.length, 1);
  assert.equal(scene.contents.length, 3);
  const panels = [...scene.timers, ...scene.contents.filter(c => c.kind !== 'art')];
  for (let i = 0; i < panels.length; i++) {
    assert.ok(boundsInDomain(scene.surfaces.find(s => s.id === panels[i].surfaceId)!, panels[i].bounds));
  }
  assert.equal(readScene(scene).contents.length, 3);
});

test('recipe follow-ups preserve step on title/attachment, and full config update returns to ingredients', async () => {
  const d = driver();
  await d.call('create_recipe', recipe);
  const id = d.fixture.scene().contents[0].id;
  await d.call('control_content', { contentId: id, action: 'previous' });
  assert.equal((d.fixture.scene().contents[0] as Extract<ContentInstance, { kind: 'recipe' }>).state.stepIndex, -1);
  await d.call('control_content', { contentId: id, action: 'next' });
  await d.call('update_content', { contentId: id, title: 'Dinner', spec: null });
  await d.call('attach_content', { contentId: id, surfaceId: 'wall' });
  let content = d.fixture.scene().contents[0];
  assert.equal(content.kind, 'recipe');
  if (content.kind !== 'recipe') throw new Error('Expected recipe');
  assert.equal(content.state.stepIndex, 0);
  assert.equal(content.title, 'Dinner');
  assert.equal(content.surfaceId, 'wall');
  await d.call('update_content', { contentId: id, title: null, spec: { kind: 'recipe', config: { ingredients: ['Revised item'], steps: ['Revised step'], source: 'User supplied' } } });
  content = d.fixture.scene().contents[0];
  assert.equal(content.id, id);
  if (content.kind !== 'recipe') throw new Error('Expected recipe');
  assert.equal(content.state.stepIndex, -1);
  assert.equal(content.title, 'Dinner');
});

test('ordinary artwork requests reuse the existing background and preserve its identity and clock', async () => {
  const d = driver();
  await d.call('create_artwork', art);
  const original = d.fixture.scene().contents[0];
  await d.call('control_content', { contentId: original.id, action: 'pause' });
  const paused = d.fixture.scene().contents[0];
  await d.call('update_content', { contentId: original.id, title: null, spec: { kind: 'art', config: { preset: 'aurora', palette: 'lagoon', speed: 2, seed: 13 } } });
  await d.call('attach_content', { contentId: original.id, surfaceId: 'tabletop' });
  assert.deepEqual(d.fixture.scene().contents[0].state, paused.state);
  const before = d.fixture.scene();
  const reused = await d.call('create_artwork', { ...art, surfaceId: 'tabletop', title: 'Updated stars' });
  assert.equal((reused.tools[0].output as Receipt).ok, true);
  assert.equal(d.fixture.scene().contents.length, 1);
  assert.equal(d.fixture.scene().contents[0].id, original.id);
  assert.equal(d.fixture.scene().contents[0].title, 'Updated stars');
  assert.deepEqual(d.fixture.scene().contents[0].bounds, before.contents[0].bounds);
  assert.deepEqual(d.fixture.scene().contents[0].state, paused.state);
  assert.equal(d.fixture.commands.at(-1)!.type, 'content.update');
  assert.match(reused.text, /Stars.*paused/);
  await d.call('control_content', { contentId: original.id, action: 'reset' });
  const reset = d.fixture.scene().contents[0];
  if (reset.kind !== 'art') throw new Error('Expected art');
  assert.equal(reset.state.clock.running, false);
  assert.equal(reset.state.clock.elapsedMs, 0);
});

test('artwork reuse at five assets updates only the existing art and preserves unrelated content and geometry', async () => {
  const d = driver();
  await d.call('create_artwork', art);
  await d.call('create_timer', { surfaceId: 'wall', title: 'Keep timer', durationSeconds: 45, start: true });
  for (let i = 2; i < CONTENT_LIMITS.maxPerSurface; i++) await d.call('create_note', { ...note, surfaceId: 'wall', title: `Keep note ${i}` });
  const before = d.fixture.scene(), original = before.contents.find(c => c.kind === 'art')!;
  const commandCount = d.fixture.commands.length;
  const result = await d.call('create_artwork', { ...art, title: 'Swimming fish', preset: 'fish', palette: 'lagoon' });
  assert.equal((result.tools[0].output as Receipt).ok, true);
  assert.deepEqual(d.fixture.commands.slice(commandCount).map(c => c.type), ['content.update']);
  const after = d.fixture.scene(), updated = after.contents.find(c => c.id === original.id)!;
  assert.equal(updated.kind, 'art');
  if (updated.kind !== 'art') throw new Error('Expected art');
  assert.equal(updated.config.preset, 'fish');
  assert.deepEqual(updated.bounds, original.bounds);
  assert.deepEqual(updated.state, original.state);
  assert.deepEqual(after.contents.filter(c => c.id !== original.id), before.contents.filter(c => c.id !== original.id));
  assert.deepEqual(after.timers, before.timers);
  assert.deepEqual(after.surfaces, before.surfaces);
  assert.equal(after.geometryRevision, before.geometryRevision);
  assert.equal(roomContext(await d.fixture.port.getSnapshot()).surfaceCapacity.find(s => s.surfaceId === 'wall')!.occupied, 5);
  assert.match(result.text, /Swimming fish/);
  assert.doesNotMatch(result.text, /already has artwork|Could not/);
});

test('attaching art to another occupied background still rejects without replacing either artwork', async () => {
  const d = driver();
  await d.call('create_artwork', art);
  await d.call('create_artwork', { ...art, surfaceId: 'tabletop' });
  const before = d.fixture.scene();
  const rejected = await d.call('attach_content', { contentId: before.contents[0].id, surfaceId: 'tabletop' });
  assert.equal((rejected.tools[0].output as Receipt).ok, false);
  assert.deepEqual(d.fixture.scene(), before);
});

test('game control preserves score, refuses rule edits until reset, and never exposes hit input', async () => {
  const d = driver();
  await d.call('create_reaction_game', game);
  const original = d.fixture.scene().contents[0];
  const before = d.fixture.scene();
  const rejected = await d.call('update_content', { contentId: original.id, title: null, spec: { kind: 'game', config: { rounds: 5, seed: 8 } } });
  assert.equal((rejected.tools[0].output as Receipt).ok, false);
  assert.deepEqual(d.fixture.scene(), before);
  await d.call('control_content', { contentId: original.id, action: 'pause' });
  const paused = d.fixture.scene().contents[0];
  await d.call('attach_content', { contentId: original.id, surfaceId: 'wall' });
  assert.deepEqual(d.fixture.scene().contents[0].state, paused.state);
  const count = d.fixture.commands.length;
  await d.call('game.hit', { id: original.id, round: 0, target: 0 });
  assert.equal(d.fixture.commands.length, count);
  await d.call('control_content', { contentId: original.id, action: 'reset' });
  const updated = await d.call('update_content', { contentId: original.id, title: null, spec: { kind: 'game', config: { rounds: 5, seed: 8 } } });
  assert.equal((updated.tools[0].output as Receipt).ok, true);
  const state = d.fixture.scene().contents[0];
  if (state.kind !== 'game') throw new Error('Expected game');
  assert.equal(state.state.status, 'idle');
  assert.equal(state.state.score, 0);
  assert.equal(d.fixture.commands.some(c => c.type === 'game.hit'), false);
});

test('unsupported preset/config values and raw runtime state fail SDK validation before dispatch', async () => {
  const cases: [string, unknown][] = [
    ['create_artwork', { ...art, preset: 'invented' }],
    ['create_artwork', { ...art, speed: CONTENT_LIMITS.speed.max + 1 }],
    ['create_recipe', { ...recipe, steps: [] }],
    ['create_note', { ...note, text: 'x'.repeat(CONTENT_LIMITS.noteLength + 1) }],
    ['create_reaction_game', { ...game, state: { score: 999 } }],
    ['create_note', { ...note, surfaceId: 'imaginary' }],
    ['update_content', { contentId: 'anything', title: null, spec: { kind: 'game', config: { rounds: 8, seed: 42, score: 999 } } }],
  ];
  for (const [name, input] of cases) {
    const d = driver();
    await d.call(name, input);
    assert.equal(d.fixture.commands.length, 0, name);
  }
});

test('duplicate content call delivery creates one instance and partial game startup is explicit', async () => {
  const fixture = canvasFixture();
  const model = new MockLanguageModelV4({ doGenerate: [toolReply('create_note', note), toolReply('create_note', note), textReply('Done')] });
  await createProjectionAgent({ canvas: fixture.port, model }).send('Create note');
  assert.equal(fixture.scene().contents.length, 1);
  assert.equal(fixture.commands.length, 1);
  const blocked = driver(canvasFixture(command => command.type === 'content.action' ? 'Unavailable' : undefined));
  const result = await blocked.call('create_reaction_game', game);
  const output = result.tools[0].output as Receipt;
  assert.equal(output.ok, false);
  assert.match(output.partial!, /created/);
  assert.equal((output.content as Extract<ContentInstance, { kind: 'game' }>).state.status, 'idle');
});

test('unsupported actions and cross-kind replacement leave the canvas unchanged; removal is explicit', async () => {
  const d = driver();
  await d.call('create_note', note);
  const id = d.fixture.scene().contents[0].id;
  const before = d.fixture.scene();
  const action = await d.call('control_content', { contentId: id, action: 'start' });
  assert.equal((action.tools[0].output as Receipt).ok, false);
  const replacement = await d.call('update_content', { contentId: id, title: 'Wrong kind', spec: { kind: 'game', config: { rounds: 8, seed: 42 } } });
  assert.equal((replacement.tools[0].output as Receipt).ok, false);
  assert.deepEqual(d.fixture.scene(), before);
  const removed = await d.call('remove_content', { contentId: id });
  assert.equal((removed.tools[0].output as Receipt).ok, true);
  assert.equal(d.fixture.scene().contents.length, 0);
});

test('context and schemas share canonical limits/capabilities and preserve simulation provenance', async () => {
  const d = driver();
  await d.call('create_note', note);
  const context = roomContext(await d.fixture.port.getSnapshot());
  assert.deepEqual(context.capabilities.contentRegistry, CONTENT_REGISTRY);
  assert.deepEqual(context.capabilities.contentLimits, CONTENT_LIMITS);
  assert.equal(context.schemaVersion, 3);
  assert.equal(context.frame.provenance, 'simulated');
  assert.equal(context.selectedContentId, context.contents[0].id);
  const bound = await bindCanvasTurn(d.fixture.port, { turnId: 'schemas', signal: new AbortController().signal });
  const schema = await asSchema(bound.tools.create_artwork.inputSchema).jsonSchema;
  assert.deepEqual((schema.properties!.preset as { enum: unknown }).enum, [...CONTENT_LIMITS.presets]);
  assert.equal((schema.properties!.speed as { maximum: unknown }).maximum, CONTENT_LIMITS.speed.max);
  assert.match(await bound.instructions(), /AI-generated draft/);
  assert.match(await bound.instructions(), /never inject hits or score/);
});

test('five mixed assets share capacity, reject net additions, and remain editable without reflow', async () => {
  const d = driver();
  await d.call('create_timer', { surfaceId: 'tabletop', title: 'Pasta', durationSeconds: 300, start: true });
  await d.call('create_artwork', { ...art, surfaceId: 'tabletop' });
  for (let count = 2; count < CONTENT_LIMITS.maxPerSurface; count++) {
    const result = await d.call('create_note', { ...note, title: `Note ${count}` });
    assert.equal((result.tools[0].output as Receipt).ok, true);
  }
  const full = d.fixture.scene();
  const rejected = await d.call('create_note', { ...note, title: 'Sixth asset' });
  assert.equal((rejected.tools[0].output as Receipt).ok, false);
  assert.match(rejected.text, /5 asset slots/);
  assert.deepEqual(d.fixture.scene(), full);
  const wall = await d.call('create_note', { ...note, surfaceId: 'wall', title: 'Transfer me' });
  const incoming = (wall.tools[0].output as Receipt).content!;
  const beforeTransfer = d.fixture.scene();
  const transfer = await d.call('attach_content', { contentId: incoming.id, surfaceId: 'tabletop' });
  assert.equal((transfer.tools[0].output as Receipt).ok, false);
  assert.deepEqual(d.fixture.scene(), beforeTransfer);
  const existing = full.contents.find(c => c.kind === 'note')!;
  for (let edit = 0; edit < CONTENT_LIMITS.maxPerSurface + 1; edit++) {
    const updated = await d.call('update_content', { contentId: existing.id, title: `Revision ${edit}`, spec: null });
    assert.equal((updated.tools[0].output as Receipt).ok, true);
  }
  const paused = await d.call('control_timer', { timerId: full.timers[0].id, action: 'pause' });
  assert.equal((paused.tools[0].output as Receipt).ok, true);
  assert.equal(d.fixture.scene().timers[0].status, 'paused');
  const same = await d.call('attach_content', { contentId: existing.id, surfaceId: 'tabletop' });
  assert.equal((same.tools[0].output as Receipt).ok, true);
  for (const original of [...full.timers, ...full.contents]) {
    const current = [...d.fixture.scene().timers, ...d.fixture.scene().contents].find(c => c.id === original.id)!;
    assert.deepEqual(current.bounds, original.bounds);
  }
  let context = roomContext(await d.fixture.port.getSnapshot());
  assert.deepEqual(context.surfaceCapacity.find(s => s.surfaceId === 'tabletop'), { surfaceId: 'tabletop', occupied: 5, remaining: 0, overLimit: false });
  await d.call('remove_content', { contentId: existing.id });
  const accepted = await d.call('attach_content', { contentId: incoming.id, surfaceId: 'tabletop' });
  assert.equal((accepted.tools[0].output as Receipt).ok, true);
  context = roomContext(await d.fixture.port.getSnapshot());
  assert.equal(context.surfaceCapacity.find(s => s.surfaceId === 'wall')!.occupied, 0);
  assert.equal(context.surfaceCapacity.find(s => s.surfaceId === 'tabletop')!.remaining, 0);
  assert.deepEqual(d.fixture.scene().surfaces, full.surfaces);
});

test('a visually covered surface still accepts overlapping content below capacity', async () => {
  let scene = reduceScene(initialScene(1000), { type: 'content.create', id: 'large', surfaceId: 'tabletop', title: 'Existing', spec: { kind: 'note', config: { text: 'Keep this note', accent: '#aabbcc' } } }, 1000);
  scene = reduceScene(scene, { type: 'content.move', id: 'large', bounds: { x: 0, y: 0, w: 1, h: 1 } }, 1000);
  const d = driver(canvasFixture(undefined, scene));
  const result = await d.call('create_note', note);
  assert.equal((result.tools[0].output as Receipt).ok, true);
  assert.equal(d.fixture.scene().contents.length, 2);
  assert.deepEqual(d.fixture.scene().contents[0], scene.contents[0]);
  assert.ok(overlaps(d.fixture.scene().contents[0].bounds, d.fixture.scene().contents[1].bounds));
  assert.ok(boundsInDomain(scene.surfaces[0], d.fixture.scene().contents[1].bounds));
  assert.equal(readScene(d.fixture.scene()).contents.length, 2);
});

test('older over-capacity saves remain editable and can move assets out', async () => {
  const scene = reduceScene(initialScene(1000), { type: 'content.create', id: 'legacy', surfaceId: 'tabletop', title: 'Existing', spec: { kind: 'note', config: { text: 'Keep me', accent: '#aabbcc' } } }, 1000);
  scene.contents = Array.from({ length: CONTENT_LIMITS.maxPerSurface + 1 }, (_, index) => ({ ...structuredClone(scene.contents[0]), id: `legacy-${index}` }));
  scene.selectedContentId = scene.contents[0].id;
  const d = driver(canvasFixture(undefined, readScene(scene)));
  assert.deepEqual(roomContext(await d.fixture.port.getSnapshot()).surfaceCapacity[0], { surfaceId: 'tabletop', occupied: 6, remaining: 0, overLimit: true });
  const updated = await d.call('update_content', { contentId: 'legacy-0', title: 'Still editable', spec: null });
  assert.equal((updated.tools[0].output as Receipt).ok, true);
  const same = await d.call('attach_content', { contentId: 'legacy-0', surfaceId: 'tabletop' });
  assert.equal((same.tools[0].output as Receipt).ok, true);
  const before = d.fixture.scene();
  const blocked = await d.call('create_timer', { surfaceId: 'tabletop', title: 'Too many', durationSeconds: 10, start: false });
  assert.equal((blocked.tools[0].output as Receipt).ok, false);
  assert.deepEqual(d.fixture.scene(), before);
  const moved = await d.call('attach_content', { contentId: 'legacy-0', surfaceId: 'wall' });
  assert.equal((moved.tools[0].output as Receipt).ok, true);
  const context = roomContext(await d.fixture.port.getSnapshot());
  assert.deepEqual(context.surfaceCapacity[0], { surfaceId: 'tabletop', occupied: 5, remaining: 0, overLimit: false });
  assert.equal(readScene(d.fixture.scene()).contents.length, 6);
  assert.equal(d.fixture.commands.some(c => c.type === 'content.remove'), false);
});

test('host migration upgrades a v2 timer scene for the v3 agent without changing the timer', async () => {
  const fixture = canvasFixture();
  await fixture.port.dispatch({ type: 'timer.create', id: 'legacy', title: 'Existing', durationMs: 90000, surfaceId: 'tabletop' });
  await fixture.port.dispatch({ type: 'timer.action', id: 'legacy', action: 'start' });
  const { contents: _contents, selectedContentId: _selected, ...v2Fields } = fixture.scene();
  const migrated = readScene({ ...v2Fields, schemaVersion: 2 });
  const snapshot = await fixture.port.getSnapshot();
  const context = roomContext({ ...snapshot, scene: migrated });
  assert.equal(context.schemaVersion, 3);
  assert.deepEqual(context.timers, fixture.scene().timers);
  assert.deepEqual(context.contents, []);
});
