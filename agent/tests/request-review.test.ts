import assert from 'node:assert/strict';
import test from 'node:test';
import { createProjectionAgent } from '../src/projection-agent.js';
import { AgentTurnError } from '../src/session.js';
import { createRequestReview } from '../src/request-review.js';
import { bindCanvasTurn } from '../src/canvas.js';
import { canvasFixture } from './canvas-fixture.js';
import { RawMockLanguageModelV4, textReply, toolReply } from './model.js';

const note = { surfaceId: 'wall', title: 'Welcome', text: 'Welcome', accent: '#228844' };
const timer = { surfaceId: 'tabletop', title: 'Tea', durationSeconds: 180, start: true };
const done = (id: string, request: string, evidence: string[]) => ({ id, request, status: 'completed', evidence, reason: null });
const pending = (id: string, request: string) => ({ id, request, status: 'pending', evidence: [], reason: 'Use the corresponding tool to complete this part.' });
const review = (requirements: unknown[], id = 'review') => toolReply('review_request', { requirements }, id);

test('a tested program candidate cannot satisfy a request to deploy it', async () => {
  const r = createRequestReview('Create an interactive clover garden on the wall.');
  r.state.recordStep({ calls: [{ toolName: 'author_program', toolCallId: 'candidate' }], results: [{ toolName: 'author_program', toolCallId: 'candidate', output: { ok: true, testId: 'passed-candidate', passed: true } }] });
  assert.equal(r.state.required, true);
  const first = await r.tools.review_request.execute!({ requirements: [{ id: 'garden', request: 'Place the interactive garden', status: 'completed', evidence: ['candidate'], reason: null }] }, { toolCallId: 'review-1', messages: [], context: {} });
  assert.equal((first as { ok: boolean }).ok, false); assert.equal(r.state.complete, false);
  r.state.recordStep({ calls: [{ toolName: 'apply_program', toolCallId: 'placed' }], results: [{ toolName: 'apply_program', toolCallId: 'placed', output: { ok: true, outcome: 'applied' } }] });
  const second = await r.tools.review_request.execute!({ requirements: [{ id: 'garden', request: 'Place the interactive garden', status: 'completed', evidence: ['placed'], reason: null },
    { id: 'preserve', request: 'Keep unrelated timer unchanged, as confirmed by the apply result', status: 'completed', evidence: ['placed'], reason: null }] }, { toolCallId: 'review-2', messages: [], context: {} });
  assert.equal((second as { ok: boolean }).ok, true); assert.equal(r.state.complete, true);
});

test('standalone program inspection/testing does not demand a scene mutation', () => {
  const r = createRequestReview('Check this program without applying it.');
  r.state.recordStep({ calls: [{ toolName: 'test_program', toolCallId: 'test' }, { toolName: 'inspect_program', toolCallId: 'inspect' }], results: [] });
  assert.equal(r.state.required, false);
});

test('an early text stop triggers whole-request review and continues supported work without replay', async () => {
  const f = canvasFixture();
  const model = new RawMockLanguageModelV4({ doGenerate: [
    toolReply('create_note', note, 'note'), textReply('Done.'),
    review([done('note', 'Welcome note on the wall', ['note']), pending('timer', 'Running three-minute Tea timer on the table')], 'review-1'),
    toolReply('create_timer', timer, 'timer'),
    review([done('note', 'Welcome note on the wall', ['note']), done('timer', 'Running three-minute Tea timer on the table', ['timer'])], 'review-2'),
  ] });
  const result = await createProjectionAgent({ canvas: f.port, model }).send('Put a Welcome note on the wall and start a three-minute Tea timer on the table.');
  assert.equal(result.status, 'complete');
  assert.equal(result.steps, 5);
  assert.equal(f.scene().contents.length, 1);
  assert.equal(f.scene().timers.length, 1);
  assert.equal(f.scene().timers[0].status, 'running');
  assert.deepEqual(f.commands.map(c => c.type), ['content.create', 'timer.create', 'timer.action']);
  assert.match(result.text, /Welcome/); assert.match(result.text, /Tea.*running/);
  assert.deepEqual(model.doGenerateCalls[2].toolChoice, { type: 'tool', toolName: 'review_request' });
  assert.match(JSON.stringify(model.doGenerateCalls[3].prompt), /Running three-minute Tea timer/);
  assert.equal(result.usage.totalTokens, 75);
});

test('screenshot regression: successful YouTube does not swallow missing border animation and poster', async () => {
  const f = canvasFixture();
  let step = 0;
  const script = [
    toolReply('display_youtube', { surfaceId: 'wall', video: 'https://www.youtube.com/watch?v=k_AubmpRz7o', title: 'Celtics highlights', backlight: true, newPlayer: null }, 'video'),
    null,
    textReply('The video is ready. I cannot generate the other assets.'),
    review([done('video', 'Celtics highlight video on back wall with backlight at 30% room fill', ['video', 'light']),
      { id: 'border', request: 'Leprechauns frolicking through four-leaf clovers around the room border', status: 'blocked', evidence: [], reason: 'Custom animation generation is unavailable. Import a prepared animation; the built-in presets cannot depict this subject.' },
      { id: 'poster', request: 'Jayson Tatum poster on the left of the wall', status: 'awaiting_user', evidence: [], reason: 'Provide a poster image through Upload media, then I can position it on the left.' },
    ]),
  ];
  const model = new RawMockLanguageModelV4({ doGenerate: async () => script[step++] ?? toolReply('configure_video_backlight', {
    contentId: f.scene().contents[0].id, enabled: true, intensity: null, spread: null, smoothingMs: null,
    toneProfile: null, opacity: null, vibrance: null, roomFill: .3,
  }, 'light') });
  const result = await createProjectionAgent({ canvas: f.port, model }).send('Show https://www.youtube.com/watch?v=k_AubmpRz7o on the back wall with backlight at 30% room fill, add leprechauns frolicking through four-leaf clovers around the room border, and a Jayson Tatum poster on the left wall.');
  assert.equal(result.status, 'incomplete');
  assert.match(result.text, /YouTube on Back wall.*Celtics highlights/);
  assert.match(result.text, /room fill 30%/);
  assert.match(result.text, /Not completed — Leprechauns.*Custom animation generation is unavailable/);
  assert.match(result.text, /Needs your input — Jayson Tatum.*Upload media/);
  assert.equal(f.scene().contents.length, 1);
});

test('unfamiliar visual subjects retain honesty and import instructions in focused context', async () => {
  const bound = await bindCanvasTurn(canvasFixture().port, { turnId: 'unknown-subject', signal: new AbortController().signal,
    prompt: 'Add frolicking leprechauns and a Jayson Tatum poster.' });
  const instructions = await bound.instructions();
  assert.match(instructions, /A content title is only a label/);
  assert.match(instructions, /Never replace a requested poster/);
  assert.match(instructions, /operate_studio asset.import/);
  assert.match(instructions, /EVERY|every clause/);
});

test('read-only memory inspection keeps its answer without an action review', async () => {
  const model = new RawMockLanguageModelV4({ doGenerate: [
    toolReply('manage_memory', { action: 'list', id: null, text: null, kind: 'preference', activity: null, surfaceId: null }),
    textReply('No saved preferences yet.'),
  ] });
  const result = await createProjectionAgent({ canvas: canvasFixture().port, model }).send('List my saved preferences.');
  assert.equal(result.status, 'complete'); assert.equal(result.text, 'No saved preferences yet.');
  assert.equal(model.doGenerateCalls.length, 2);
});

test('cancelling a forced review keeps accepted edits and removes premature success from history', async () => {
  const f = canvasFixture();
  let announce!: () => void;
  const reviewing = new Promise<void>(resolve => { announce = resolve; });
  let calls = 0;
  const model = new RawMockLanguageModelV4({ doGenerate: async options => {
    calls++;
    if (calls === 1) return toolReply('create_note', note, 'note');
    if (calls === 2) return textReply('Everything including the timer is done!');
    if (calls === 3) { announce(); return new Promise((_resolve, reject) => options.abortSignal?.addEventListener('abort', () => reject(new Error('Cancelled test review')), { once: true })); }
    return textReply('The note exists; the timer remains unfinished.');
  } });
  const agent = createProjectionAgent({ canvas: f.port, model });
  const running = agent.send('Create a note and start a timer.');
  await reviewing; agent.cancel();
  await assert.rejects(running, e => e instanceof AgentTurnError && e.code === 'cancelled');
  assert.equal(agent.busy, false); assert.equal(f.scene().contents.length, 1); assert.equal(f.scene().timers.length, 0);
  await agent.send('What remains?');
  const history = JSON.stringify(model.doGenerateCalls.at(-1)?.prompt);
  assert.doesNotMatch(history, /Everything including the timer is done/);
  assert.match(history, /tool-result/);
  assert.equal(f.scene().contents.length, 1);
});

test('review cannot invent receipts, cite failed/search/handoff outputs, or drop a known requirement', async () => {
  const r = createRequestReview('Create a video and a poster.');
  const apply = async (requirements: unknown[]) => r.tools.review_request.execute!({ requirements } as never, { toolCallId: 'r', messages: [], context: {} as never });
  r.state.recordStep({ calls: [{ toolName: 'display_youtube', toolCallId: 'failed' }], results: [
    { toolName: 'display_youtube', toolCallId: 'failed', output: { ok: false } },
    { toolName: 'search_youtube', toolCallId: 'search', output: { ok: true } },
    { toolName: 'operate_studio', toolCallId: 'picker', output: { ok: true, outcome: 'handoff' } },
  ] });
  for (const id of ['invented', 'failed', 'search', 'picker']) assert.equal((await apply([done('video', 'Video placed', [id])]) as any).ok, false);
  assert.equal((await apply([pending('video', 'Video'), pending('poster', 'Poster')]) as any).ok, true);
  assert.equal((await apply([pending('video', 'Video')]) as any).ok, false);
  assert.equal(r.state.settled, false);
});

test('shared step budget stops repeated incomplete reviews and reports pending work', async () => {
  const f = canvasFixture();
  let count = 0;
  const model = new RawMockLanguageModelV4({ doGenerate: async () => ++count === 1
    ? toolReply('create_note', note, 'note') : review([done('note', 'Note', ['note']), pending('timer', 'Tea timer on table')], `r-${count}`) });
  const result = await createProjectionAgent({ canvas: f.port, model, maxSteps: 4 }).send('Add a note and a timer.');
  assert.equal(count, 4); assert.equal(result.steps, 4); assert.equal(result.status, 'incomplete');
  assert.match(result.text, /Still pending — Tea timer/);
  assert.match(result.text, /not been confirmed complete/);
  assert.equal(f.scene().contents.length, 1); assert.equal(f.scene().timers.length, 0);
});

test('a missing or invalid review never turns partial success into overall completion', async () => {
  const f = canvasFixture();
  const model = new RawMockLanguageModelV4({ doGenerate: [toolReply('create_note', note, 'note'), textReply('Everything is done.'),
    review([done('all', 'Everything', ['made-up'])], 'invalid-1'), review([done('all', 'Everything', ['made-up'])], 'invalid-2')] });
  const result = await createProjectionAgent({ canvas: f.port, model, maxSteps: 4 }).send('Put a note and a timer in the room.');
  assert.equal(result.status, 'incomplete');
  assert.match(result.text, /not been confirmed complete/); assert.doesNotMatch(result.text, /Everything is done|All done anyway/);
  assert.equal(f.scene().timers.length, 0);
});

test('invalid completion after only inspection remains incomplete even if the model stops without acting', async () => {
  const fixture = canvasFixture();
  let step = 0;
  const model = new RawMockLanguageModelV4({ doGenerate: async call => {
    if (++step === 1) return toolReply('inspect_room', {}, 'read-only');
    if (step === 2 || call.toolChoice?.type === 'tool') return review([done('color', 'Make the selected object green', ['read-only'])], `invalid-${step}`);
    return textReply('Everything is complete.');
  } });
  const result = await createProjectionAgent({ canvas: fixture.port, model, maxSteps: 3 }).send('Make the selected object green.');
  assert.equal(result.status, 'incomplete'); assert.deepEqual(fixture.commands, []);
  assert.match(result.text, /not been confirmed complete/); assert.doesNotMatch(result.text, /Everything is complete/);
});

test('a rejected read-only review gets another bounded review and preserves the required selection handoff', async () => {
  const fixture = canvasFixture();
  const model = new RawMockLanguageModelV4({ doGenerate: [toolReply('inspect_room', {}, 'read-only'),
    review([done('color', 'Make the selected object green', ['read-only'])], 'invalid'), textReply('Done'),
    review([{ id: 'color', request: 'Make the selected object green', status: 'awaiting_user', evidence: [], reason: 'Tracking is lost. Click the intended object again before changing its color.' }], 'corrected')] });
  const result = await createProjectionAgent({ canvas: fixture.port, model, maxSteps: 5 }).send('Make the selected object green.');
  assert.equal(result.status, 'incomplete'); assert.equal(result.steps, 4); assert.deepEqual(fixture.commands, []);
  assert.deepEqual(model.doGenerateCalls[3].toolChoice, { type: 'tool', toolName: 'review_request' });
  assert.match(result.text, /Needs your input.*Tracking is lost/);
});

test('new actions invalidate prior reviews, and a final pending review retains receipts in follow-up history', async () => {
  const f = canvasFixture();
  const model = new RawMockLanguageModelV4({ doGenerate: [toolReply('create_note', note, 'note'),
    review([done('note', 'Welcome note', ['note']), pending('timer', 'Tea timer')]), textReply('Do not duplicate the existing note.')] });
  const agent = createProjectionAgent({ canvas: f.port, model, maxSteps: 2 });
  const first = await agent.send('Create the note and Tea timer.');
  await agent.send('What remains?');
  const history = JSON.stringify(model.doGenerateCalls[2].prompt);
  assert.match(history, /Still pending/); assert.match(history, /tool-result/); assert.ok(history.includes(JSON.stringify(first.text).slice(1, -1)));
  const r = createRequestReview('Two actions');
  r.state.recordStep({ calls: [{ toolName: 'create_note', toolCallId: 'n' }], results: [{ toolName: 'create_note', toolCallId: 'n', output: { ok: true } }] });
  await r.tools.review_request.execute!({ requirements: [done('n', 'Note', ['n'])] } as never, { toolCallId: 'r', messages: [], context: {} as never });
  assert.equal(r.state.settled, true);
  r.state.recordStep({ calls: [{ toolName: 'create_timer', toolCallId: 't' }], results: [] });
  assert.equal(r.state.settled, false);
});
