import assert from 'node:assert/strict';
import test from 'node:test';
import { CONTENT_REGISTRY, type ContentInstance } from '../../src/shared/content.js';
import { readScene } from '../../src/shared/domain.js';
import { boundsInDomain } from '../../src/shared/spatial.js';
import { bindCanvasTurn, roomContext } from '../src/canvas.js';
import { createProjectionAgent } from '../src/projection-agent.js';
import { canvasFixture } from './canvas-fixture.js';
import { MockLanguageModelV4, textReply, toolReply } from './model.js';
import { BACKLIGHT_DEFAULTS, BACKLIGHT_LIMITS, BACKLIGHT_TONE_PROFILES, BACKLIGHT_TONE_LABELS } from '../../src/shared/backlight.js';

const display = { surfaceId: 'wall', video: 'https://youtu.be/M7lc1UVf-VE?t=90', title: null, backlight: null, newPlayer: null };
type YouTube = Extract<ContentInstance, { kind: 'youtube' }>;
function driver(fixture = canvasFixture()) {
  let next = textReply('Ready');
  let consumed = false;
  let count = 0;
  const model = new MockLanguageModelV4({ doGenerate: async () => {
    if (!consumed) { consumed = true; return next; }
    return textReply('The video is playing and its backlight matches every frame.');
  } });
  const agent = createProjectionAgent({ canvas: fixture.port, model });
  return { fixture, model, agent, async call(name: string, input: unknown) {
    next = toolReply(name, input, `call-${++count}`); consumed = false;
    return agent.send(`Test action ${count}: ${JSON.stringify(input)}.`);
  } };
}

test('display_youtube uses the shared parser, valid bounds and default-on backlight without claiming playback', async () => {
  const d = driver();
  await d.fixture.port.dispatch({ type: 'content.create', id: 'fish', surfaceId: 'wall', title: 'Fish',
    spec: { kind: 'art', config: { preset: 'fish', palette: 'lagoon', speed: 1, seed: 42 } } });
  const before = d.fixture.scene();
  const result = await d.call('display_youtube', display);
  const scene = d.fixture.scene();
  const content = scene.contents.find(c => c.kind === 'youtube') as YouTube;
  assert.ok(content);
  assert.deepEqual(content.config, { videoId: 'M7lc1UVf-VE', startSeconds: 90, backlight: true });
  assert.equal(content.title, 'YouTube');
  assert.deepEqual(content.state, {});
  assert.ok(boundsInDomain(scene.surfaces.find(s => s.id === 'wall')!, content.bounds));
  assert.deepEqual(scene.contents.find(c => c.id === 'fish'), before.contents[0]);
  assert.equal(scene.geometryRevision, before.geometryRevision);
  assert.equal(scene.showGrid, before.showGrid);
  assert.deepEqual(readScene(scene).contents, scene.contents);
  const receipt = result.tools[0].output as { ok: boolean; content: YouTube; playback: { verified: boolean; output: string }; backlight: { captureVerified: boolean } };
  assert.equal(receipt.ok, true);
  assert.deepEqual(receipt.content, content);
  assert.equal(receipt.playback.verified, false);
  assert.equal(receipt.backlight.captureVerified, false);
  assert.equal(receipt.playback.output, CONTENT_REGISTRY.find(entry => entry.kind === 'youtube')!.description);
  assert.match(result.text, /player placed on Back wall; dynamic backlight enabled/);
  assert.match(result.text, /default to paused and muted/);
  assert.match(result.text, /playback is not verified/);
  assert.doesNotMatch(result.text, /is playing|matches every frame/);
});

test('explicit no-backlight is honored and follow-up toggles change only lighting on the same video', async () => {
  const d = driver();
  await d.call('display_youtube', { ...display, title: 'User video', backlight: false });
  const original = d.fixture.scene().contents[0] as YouTube;
  assert.equal(original.config.backlight, false);
  for (const enabled of [true, false, false, true]) {
    const reply = await d.call('set_youtube_backlight', { contentId: original.id, enabled });
    const current = d.fixture.scene().contents[0] as YouTube;
    assert.deepEqual(current, { ...original, config: { ...original.config, backlight: enabled } });
    assert.equal(d.fixture.scene().contents.length, 1);
    assert.ok(reply.text.startsWith(`YouTube backlight on Back wall: ${enabled ? 'enabled' : 'disabled'}.`));
  }
  assert.deepEqual(d.fixture.commands.map(c => c.type), ['content.create', ...Array(4).fill('youtube.backlight')]);
  const followupPrompt = JSON.stringify(d.model.doGenerateCalls.at(-1)?.prompt);
  assert.doesNotMatch(followupPrompt, /The video is playing and its backlight matches every frame/);
});

test('YouTube content can be renamed, moved, replaced and removed through the existing content tools', async () => {
  const d = driver();
  await d.call('display_youtube', display);
  const original = d.fixture.scene().contents[0] as YouTube;
  await d.call('update_content', { contentId: original.id, title: 'My video', spec: null });
  await d.call('attach_content', { contentId: original.id, surfaceId: 'tabletop' });
  let current = d.fixture.scene().contents[0] as YouTube;
  assert.equal(current.title, 'My video');
  assert.equal(current.surfaceId, 'tabletop');
  assert.deepEqual(current.config, original.config);
  assert.deepEqual(current.state, original.state);
  const config = { videoId: 'bHQqvYy5KYo', startSeconds: 5, backlight: false };
  const changed = await d.call('update_content', { contentId: original.id, title: null, spec: { kind: 'youtube', config: { ...config, backlightSettings: null } } });
  assert.equal((changed.tools[0].output as { ok: boolean }).ok, true);
  current = d.fixture.scene().contents[0] as YouTube;
  assert.equal(current.id, original.id);
  assert.equal(current.title, 'My video');
  assert.deepEqual(current.config, config);
  await d.call('remove_content', { contentId: original.id });
  assert.equal(d.fixture.scene().contents.length, 0);
});

test('unsupported URLs, raw embed HTML, invalid surfaces and extra runtime state never reach dispatch', async () => {
  for (const input of [
    { ...display, video: 'https://example.com/watch?v=M7lc1UVf-VE' },
    { ...display, video: 'https://youtube.com.attacker.example/watch?v=M7lc1UVf-VE' },
    { ...display, video: '<iframe src="https://www.youtube.com/embed/M7lc1UVf-VE"></iframe>' },
    { ...display, video: 'https://www.youtube.com/playlist?list=PL-example' },
    { ...display, video: 'fish swimming video' },
    { ...display, surfaceId: 'invented' },
    { ...display, state: { playing: true } },
  ]) {
    const d = driver();
    const result = await d.call('display_youtube', input);
    assert.equal(d.fixture.commands.length, 0);
    assert.equal(d.fixture.scene().contents.length, 0);
    assert.doesNotMatch(result.text, /is playing|player placed/);
  }
});

test('wrong-kind lighting and unsupported playback actions report errors without changing content', async () => {
  const d = driver();
  await d.call('create_note', { surfaceId: 'tabletop', title: 'Keep', text: 'Existing note', accent: '#abcdef' });
  const note = d.fixture.scene().contents[0];
  let before = d.fixture.scene();
  const wrongKind = await d.call('set_youtube_backlight', { contentId: note.id, enabled: false });
  assert.equal((wrongKind.tools[0].output as { ok: boolean }).ok, false);
  assert.deepEqual(d.fixture.scene(), before);
  await d.call('display_youtube', display);
  const video = d.fixture.scene().contents.find(c => c.kind === 'youtube')!;
  before = d.fixture.scene();
  const action = await d.call('control_content', { contentId: video.id, action: 'start' });
  assert.equal((action.tools[0].output as { ok: boolean }).ok, false);
  assert.deepEqual(d.fixture.scene(), before);
  const missing = await d.call('set_youtube_backlight', { contentId: 'gone', enabled: true });
  assert.equal((missing.tools[0].output as { ok: boolean }).ok, false);
  assert.deepEqual(d.fixture.scene(), before);
});

test('duplicate display delivery produces one player and rejected placement cannot become a success reply', async () => {
  const fixture = canvasFixture();
  const model = new MockLanguageModelV4({ doGenerate: [toolReply('display_youtube', display), toolReply('display_youtube', display), textReply('Playing!')] });
  await createProjectionAgent({ canvas: fixture.port, model }).send(`Show this YouTube video: ${display.video}`);
  assert.equal(fixture.commands.length, 1);
  assert.equal(fixture.scene().contents.length, 1);
  const d = driver(canvasFixture(() => 'No free space for this player.'));
  const result = await d.call('display_youtube', display);
  assert.equal(d.fixture.scene().contents.length, 0);
  assert.match(result.text, /No free space/);
  assert.doesNotMatch(result.text, /is playing|player placed/);
});

test('room context advertises actual YouTube scope and instructs asking for a link rather than inventing one', async () => {
  const fixture = canvasFixture();
  const context = roomContext(await fixture.port.getSnapshot());
  const capability = context.capabilities.contentRegistry.find(c => c.kind === 'youtube');
  assert.ok(capability);
  assert.deepEqual(capability.output, ['manual']);
  assert.equal(context.capabilities.unavailable.includes('YouTube'), false);
  assert.equal(context.capabilities.unavailable.includes('YouTube search'), true);
  assert.deepEqual(context.capabilities.videoBacklight.toneProfiles, BACKLIGHT_TONE_PROFILES);
  assert.deepEqual(context.capabilities.videoBacklight.limits, BACKLIGHT_LIMITS);
  assert.equal(context.capabilities.videoBacklight.defaults.roomFill, 0);
  assert.match(context.capabilities.videoBacklight.roomFill, /Continuous 0–1/);
  const bound = await bindCanvasTurn(fixture.port, { turnId: 'youtube-context', signal: new AbortController().signal });
  const instructions = await bound.instructions();
  assert.match(instructions, /Never invent a video ID/);
  assert.match(instructions, /backlight defaults to on/);
  assert.match(instructions, /not playback/);
});

const configure = { contentId: '', enabled: null, intensity: null, spread: null, smoothingMs: null, toneProfile: null, opacity: null, vibrance: null, roomFill: null };

test('configure_video_backlight changes settings atomically and partial follow-ups preserve everything else', async () => {
  const d = driver();
  await d.call('display_youtube', display);
  const original = d.fixture.scene().contents[0] as YouTube;
  const input = { ...configure, contentId: original.id, enabled: false, intensity: 1.4, smoothingMs: 320 };
  const reply = await d.call('configure_video_backlight', input);
  const first = d.fixture.scene().contents[0] as YouTube;
  assert.deepEqual(first, { ...original, config: { ...original.config, backlight: false,
    backlightSettings: { ...BACKLIGHT_DEFAULTS, intensity: 1.4, smoothingMs: 320 } } });
  assert.deepEqual(d.fixture.commands.map(c => c.type), ['content.create', 'youtube.backlight.configure']);
  assert.match(reply.text, /disabled, brightness 140%, spread 18%, smoothing 320 ms/);
  const changed = await d.call('configure_video_backlight', { ...configure, contentId: original.id, spread: .3 });
  const second = d.fixture.scene().contents[0] as YouTube;
  assert.deepEqual(second.config.backlightSettings, { ...BACKLIGHT_DEFAULTS, intensity: 1.4, spread: .3, smoothingMs: 320 });
  assert.equal(second.config.backlight, false);
  const receipt = changed.tools[0].output as { backlight: { captureVerified: boolean; settings: unknown } };
  assert.equal(receipt.backlight.captureVerified, false);
  assert.deepEqual(receipt.backlight.settings, second.config.backlightSettings);
  await d.call('set_youtube_backlight', { contentId: original.id, enabled: true });
  assert.deepEqual((d.fixture.scene().contents[0] as YouTube).config.backlightSettings, second.config.backlightSettings);
  assert.deepEqual(readScene(d.fixture.scene()).contents, d.fixture.scene().contents);
});

test('legacy/default configuration stays readable and video replacement can preserve customized lighting', async () => {
  const d = driver();
  const result = await d.call('display_youtube', display);
  const original = d.fixture.scene().contents[0] as YouTube;
  assert.equal(original.config.backlightSettings, undefined);
  assert.deepEqual((result.tools[0].output as { backlight: { settings: unknown } }).backlight.settings, BACKLIGHT_DEFAULTS);
  const settings = { ...BACKLIGHT_DEFAULTS, intensity: .6, spread: .28, smoothingMs: 90, toneProfile: 'soft' as const, opacity: .8, vibrance: 1.4, roomFill: .75 };
  await d.call('configure_video_backlight', { ...configure, ...settings, contentId: original.id });
  const config = { videoId: 'bHQqvYy5KYo', startSeconds: 12, backlight: true, backlightSettings: settings };
  await d.call('update_content', { contentId: original.id, title: null, spec: { kind: 'youtube', config } });
  assert.deepEqual((d.fixture.scene().contents[0] as YouTube).config, config);
  assert.equal(d.fixture.scene().contents[0].id, original.id);
});

test('invalid or empty settings and model-provided frame colors cannot dispatch or claim live matching', async () => {
  for (const patch of [
    {}, { intensity: BACKLIGHT_LIMITS.intensity.max + .1 }, { spread: BACKLIGHT_LIMITS.spread.min - .01 },
    { smoothingMs: 1.5 }, { toneProfile: 'made-up-neural-model' }, { colors: [{ red: 255, green: 0, blue: 0 }] },
    { opacity: BACKLIGHT_LIMITS.opacity.max + .01 }, { opacity: -.01 },
    { vibrance: BACKLIGHT_LIMITS.vibrance.max + .01 }, { vibrance: -.01 },
    { roomFill: BACKLIGHT_LIMITS.roomFill.max + .01 }, { roomFill: -.01 }, { coverage: 'room' },
  ]) {
    const d = driver();
    await d.call('display_youtube', display);
    const before = d.fixture.scene();
    const result = await d.call('configure_video_backlight', { ...configure, contentId: before.contents[0].id, ...patch });
    assert.equal(d.fixture.commands.length, 1);
    assert.deepEqual(d.fixture.scene(), before);
    assert.doesNotMatch(result.text, /configured|matches every frame|video is playing/);
  }
});

test('AI-selected tone changes only lighting policy and null follow-ups preserve it', async () => {
  const d = driver();
  await d.call('display_youtube', display);
  const original = d.fixture.scene().contents[0] as YouTube;
  for (const toneProfile of BACKLIGHT_TONE_PROFILES) {
    const result = await d.call('configure_video_backlight', { ...configure, contentId: original.id, toneProfile });
    const current = d.fixture.scene().contents[0] as YouTube;
    assert.deepEqual(current, { ...original, config: { ...original.config,
      backlightSettings: { ...BACKLIGHT_DEFAULTS, toneProfile } } });
    assert.match(result.text, new RegExp(`${BACKLIGHT_TONE_LABELS[toneProfile]} tone profile`));
    assert.doesNotMatch(result.text, /matches every frame|is playing|neural/);
    assert.deepEqual(readScene(d.fixture.scene()).contents, d.fixture.scene().contents);
  }
  await d.call('configure_video_backlight', { ...configure, contentId: original.id, intensity: .7 });
  assert.equal((d.fixture.scene().contents[0] as YouTube).config.backlightSettings?.toneProfile, 'neutral');
  assert.equal(d.fixture.commands.filter(c => c.type === 'content.create').length, 1);
  assert.equal(d.fixture.commands.filter(c => c.type === 'content.update').length, 0);
});

test('full replacement accepts nullable legacy tone and preserves an explicit profile', async () => {
  const d = driver();
  await d.call('display_youtube', display);
  const id = d.fixture.scene().contents[0].id;
  for (const toneProfile of [null, 'vivid'] as const) {
    const legacySettings = { intensity: .8, spread: .2, smoothingMs: 200 };
    const result = await d.call('update_content', { contentId: id, title: null, spec: { kind: 'youtube', config: {
      videoId: 'bHQqvYy5KYo', startSeconds: 12, backlight: true, backlightSettings: { ...legacySettings, toneProfile, opacity: null, vibrance: null, roomFill: null },
    } } });
    assert.equal((result.tools[0].output as { ok: boolean }).ok, true);
    const current = d.fixture.scene().contents[0] as YouTube;
    assert.deepEqual(current.config.backlightSettings, { ...legacySettings, ...(toneProfile === null ? {} : { toneProfile }) });
    assert.deepEqual(readScene(d.fixture.scene()).contents, d.fixture.scene().contents);
  }
});

test('independent opacity and vibrance preserve video and other lighting settings, including explicit zero', async () => {
  const d = driver();
  await d.call('display_youtube', display);
  const original = d.fixture.scene().contents[0] as YouTube;
  const reply = await d.call('configure_video_backlight', { ...configure, contentId: original.id, opacity: .6, vibrance: 1.7 });
  const adjusted = d.fixture.scene().contents[0] as YouTube;
  assert.deepEqual(adjusted, { ...original, config: { ...original.config,
    backlightSettings: { ...BACKLIGHT_DEFAULTS, opacity: .6, vibrance: 1.7 } } });
  assert.match(reply.text, /opacity 60%, vibrance 170%/);
  for (const field of ['opacity', 'vibrance'] as const) {
    await d.call('configure_video_backlight', { ...configure, contentId: original.id, [field]: 0 });
    assert.equal((d.fixture.scene().contents[0] as YouTube).config.backlightSettings?.[field], 0);
  }
  const zeroed = d.fixture.scene().contents[0] as YouTube;
  await d.call('set_youtube_backlight', { contentId: original.id, enabled: false });
  await d.call('set_youtube_backlight', { contentId: original.id, enabled: true });
  assert.deepEqual(d.fixture.scene().contents[0], zeroed);
  assert.deepEqual(readScene(d.fixture.scene()).contents, d.fixture.scene().contents);
});

test('continuous room fill uses one existing source and preserves timer, empty surfaces and geometry', async () => {
  const d = driver();
  await d.fixture.port.dispatch({ type: 'timer.create', id: 'cooking', title: 'Cooking', durationMs: 90000, surfaceId: 'tabletop' });
  await d.call('display_youtube', display);
  const before = d.fixture.scene();
  const video = before.contents[0] as YouTube;
  for (const roomFill of [0, .25, .73, 1, 0]) {
    const reply = await d.call('configure_video_backlight', { ...configure, contentId: video.id, roomFill });
    const current = d.fixture.scene();
    assert.deepEqual(current.contents, [{ ...video, config: { ...video.config,
      backlightSettings: { ...BACKLIGHT_DEFAULTS, roomFill } } }]);
    assert.deepEqual(current.timers, before.timers);
    assert.deepEqual(current.surfaces, before.surfaces);
    assert.equal(current.geometryRevision, before.geometryRevision);
    assert.match(reply.text, new RegExp(`room fill ${Math.round(roomFill * 100)}%`));
    assert.deepEqual(readScene(current).contents, current.contents);
  }
  const changes = d.fixture.commands.slice(2);
  assert.equal(changes.length, 5);
  assert.ok(changes.every(command => command.type === 'youtube.backlight.configure'));
  assert.equal(d.fixture.scene().contents.some(content => content.kind === 'art'), false);
});

test('rejected configuration is atomic and duplicate tool delivery does not apply it twice', async () => {
  const d = driver(canvasFixture(c => c.type === 'youtube.backlight.configure' ? 'Capture controls unavailable.' : undefined));
  await d.call('display_youtube', display);
  const before = d.fixture.scene();
  const input = { ...configure, contentId: before.contents[0].id, intensity: .5, enabled: false };
  const rejected = await d.call('configure_video_backlight', input);
  assert.deepEqual(d.fixture.scene(), before);
  assert.match(rejected.text, /Capture controls unavailable/);
  assert.doesNotMatch(rejected.text, /configured|video is playing/);

  const fixture = canvasFixture();
  await fixture.port.dispatch({ type: 'content.create', id: 'video', surfaceId: 'wall', title: 'Video',
    spec: { kind: 'youtube', config: { videoId: 'M7lc1UVf-VE', startSeconds: 0, backlight: true } } });
  const call = { ...configure, contentId: 'video', intensity: .5, enabled: false };
  const model = new MockLanguageModelV4({ doGenerate: [toolReply('configure_video_backlight', call), toolReply('configure_video_backlight', call), textReply('Frame colors now match perfectly.')] });
  const result = await createProjectionAgent({ canvas: fixture.port, model }).send('Dim the backlight and turn it off.');
  assert.equal(fixture.commands.filter(c => c.type === 'youtube.backlight.configure').length, 1);
  assert.match(result.text, /disabled, brightness 50%/);
  assert.doesNotMatch(result.text, /match perfectly/);
});
