import assert from 'node:assert/strict';
import test from 'node:test';
import { createProjectionAgent } from '../src/projection-agent.js';
import { canvasFixture } from './canvas-fixture.js';
import { ART_PRESETS } from '../../src/shared/content.js';
import { MockLanguageModelV4, textReply, toolReply } from './model.js';

const misleadingArt = { surfaceId: 'wall', title: 'Fish swimming', preset: 'contours', palette: 'lagoon', speed: 1, seed: 42 };

test('a misleading artwork title and model claim cannot replace the confirmed visual preset', async () => {
  const fixture = canvasFixture();
  const claim = 'Done — the back wall is showing Fish swimming.';
  const model = new MockLanguageModelV4({ doGenerate: [
    toolReply('create_artwork', misleadingArt), textReply(claim), textReply('It uses contours.'),
  ] });
  const agent = createProjectionAgent({ canvas: fixture.port, model });
  const result = await agent.send('Put fish swimming across the back wall.');
  assert.match(result.text, /contours/i);
  assert.doesNotMatch(result.text, /Fish swimming/);
  assert.match(result.text, /Back wall/);
  assert.equal(fixture.scene().contents[0].kind, 'art');
  await agent.send('What effect is actually installed?');
  const followup = JSON.stringify(model.doGenerateCalls.at(-1)?.prompt);
  assert.equal(followup.includes(claim), false);
  assert.ok(followup.includes(result.text));
  assert.match(followup, /tool-call/);
  assert.match(followup, /tool-result/);
});

test('title-only edits still confirm the unchanged visual effect', async () => {
  const fixture = canvasFixture();
  await fixture.port.dispatch({ type: 'content.create', id: 'art', surfaceId: 'wall', title: 'Contours',
    spec: { kind: 'art', config: { preset: 'contours', palette: 'lagoon', speed: 1, seed: 42 } } });
  const model = new MockLanguageModelV4({ doGenerate: [
    toolReply('update_content', { contentId: 'art', title: 'Flying dragons', spec: null }),
    textReply('Dragons now fly across the wall.'),
  ] });
  const result = await createProjectionAgent({ canvas: fixture.port, model }).send('Rename it Flying dragons.');
  assert.match(result.text, /contours/i);
  assert.doesNotMatch(result.text, /[Dd]ragons/);
});

test('rejected and invalid mutations cannot be followed by a false success reply', async () => {
  for (const input of [misleadingArt, { ...misleadingArt, preset: 'not-a-real-preset' }]) {
    const fixture = canvasFixture(() => 'The canvas is unavailable.');
    const model = new MockLanguageModelV4({ doGenerate: [toolReply('create_artwork', input), textReply('Done! Fish are swimming.')] });
    const result = await createProjectionAgent({ canvas: fixture.port, model }).send('Show fish.');
    assert.doesNotMatch(result.text, /Done|Fish are swimming/);
    assert.match(result.text, /could not|Could not/);
    assert.equal(fixture.scene().contents.length, 0);
  }
});

test('partial creation reports actual idle state and the failed start', async () => {
  const fixture = canvasFixture(command => command.type === 'content.action' ? 'Starting is unavailable.' : undefined);
  const model = new MockLanguageModelV4({ doGenerate: [
    toolReply('create_reaction_game', { surfaceId: 'tabletop', title: 'Dance battle', rounds: 8, seed: 42, start: true }),
    textReply('Your dance battle is running.'),
  ] });
  const result = await createProjectionAgent({ canvas: fixture.port, model }).send('Start a game.');
  assert.match(result.text, /pointer reaction game.*idle/);
  assert.match(result.text, /Starting is unavailable/);
  assert.doesNotMatch(result.text, /dance battle|is running/);
});

test('compound timer creation has one final confirmation and conversational answers remain available', async () => {
  const fixture = canvasFixture();
  const model = new MockLanguageModelV4({ doGenerate: [
    toolReply('create_timer', { surfaceId: 'tabletop', title: 'Pasta', durationSeconds: 300, start: true }),
    textReply('Started.'), textReply('I can create timers, notes, recipes and artwork.'),
  ] });
  const agent = createProjectionAgent({ canvas: fixture.port, model });
  const result = await agent.send('Start a five-minute pasta timer.');
  assert.match(result.text, /Timer "Pasta" on Tabletop: running/);
  assert.equal(result.text.split('\n').length, 1);
  const answer = await agent.send('What can you do?');
  assert.equal(answer.text, 'I can create timers, notes, recipes and artwork.');
});

test('real fish configuration is reported from its canonical appearance and preserves other content', async () => {
  const fixture = canvasFixture();
  await fixture.port.dispatch({ type: 'content.create', id: 'art', surfaceId: 'wall', title: 'Fish swimming',
    spec: { kind: 'art', config: { preset: 'contours', palette: 'lagoon', speed: 1, seed: 42 } } });
  await fixture.port.dispatch({ type: 'content.create', id: 'note', surfaceId: 'tabletop', title: 'Existing note',
    spec: { kind: 'note', config: { text: 'Keep this', accent: '#abcdef' } } });
  const before = fixture.scene();
  const model = new MockLanguageModelV4({ doGenerate: [
    toolReply('update_content', { contentId: 'art', title: null, spec: { kind: 'art', config: { preset: 'fish', palette: 'lagoon', speed: 1, seed: 42 } } }),
    textReply('An AI-generated underwater video is now playing.'),
  ] });
  const result = await createProjectionAgent({ canvas: fixture.port, model }).send('Put actual swimming fish on the back wall.');
  assert.match(result.text, /Swimming fish.*playing/);
  assert.doesNotMatch(result.text, /AI-generated|video/);
  const output = result.tools[0].output as { appearance: { preset: string; label: string; description: string } };
  assert.deepEqual(output.appearance, { preset: 'fish', ...ART_PRESETS.fish });
  assert.deepEqual(fixture.scene().contents[1], before.contents[1]);
  assert.deepEqual(fixture.scene().contents[0].state, before.contents[0].state);
  assert.equal(fixture.scene().contents[0].id, 'art');
});
