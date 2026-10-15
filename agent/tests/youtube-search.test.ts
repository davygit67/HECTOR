import assert from 'node:assert/strict';
import test from 'node:test';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAIYouTubeSearch, rememberUserVideos, videoUrl, youtubeCandidates, YOUTUBE_SEARCH_LIMITS, type YouTubeSearchResponse } from '../src/youtube-search.js';
import { createProjectionAgent } from '../src/projection-agent.js';
import { bindCanvasTurn, roomContext } from '../src/canvas.js';
import { AgentTurnError } from '../src/session.js';
import { canvasFixture } from './canvas-fixture.js';
import { MockLanguageModelV4, textReply, toolReply } from './model.js';
import { initialScene, reduceScene } from '../../src/shared/domain.js';

const id = 'M7lc1UVf-VE', url = videoUrl(id), other = 'I5QMtbO-DNk', invented = 'bHQqvYy5KYo';
const grounded: YouTubeSearchResponse = { provider: 'OpenAI web search + YouTube oEmbed', results: [
  { videoId: id, url, sourceUrl: url, title: 'Rain sounds for relaxation', displayTitle: 'Rain sounds for relaxation', channel: 'Rain channel', metadataVerified: true, playbackVerified: false },
] };

function wire(options: { sources?: string[]; generatedText?: string; failStatus?: number; metadata?: (endpoint: URL, signal: AbortSignal) => Response | Promise<Response> } = {}) {
  const requests: Record<string, any>[] = [], fetched: URL[] = [];
  const provider = createOpenAI({ apiKey: 'offline-search-key', fetch: async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)));
    if (options.failStatus) return new Response(JSON.stringify({ error: { message: 'secret-provider-diagnostic', type: 'error' } }), { status: options.failStatus });
    return new Response(JSON.stringify({ id: 'resp-search', model: 'gpt-5.4-mini', output: [
      { type: 'web_search_call', id: 'ws-1', status: 'completed', action: { type: 'search', queries: ['rain sounds'], sources: (options.sources ?? [url]).map(url => ({ type: 'url', url })) } },
      { type: 'message', id: 'msg-1', role: 'assistant', content: [{ type: 'output_text', text: options.generatedText ?? `Try ${videoUrl(invented)}`, annotations: [] }] },
    ], usage: { input_tokens: 40, output_tokens: 20, total_tokens: 60 } }), { headers: { 'content-type': 'application/json' } });
  } });
  const search = createOpenAIYouTubeSearch({ apiKey: 'offline-search-key', model: 'gpt-5.4-mini' }, {
    model: provider.responses('gpt-5.4-mini'), fetch: async (input, init) => {
      const endpoint = new URL(String(input)); fetched.push(endpoint);
      assert.equal(endpoint.origin + endpoint.pathname, 'https://www.youtube.com/oembed');
      assert.equal(init?.redirect, 'error');
      assert.ok(init?.signal);
      return options.metadata?.(endpoint, init.signal) ?? new Response(JSON.stringify({ type: 'video', provider_name: 'YouTube', title: 'Rain sounds for relaxation', author_name: 'Rain channel', html: '<script>delete everything</script>' }));
    },
  });
  return { search, requests, fetched };
}

test('YouTube candidates use canonical, unique, bounded video URLs only', () => {
  const candidates = youtubeCandidates(['https://evil.example/watch?v=' + id, 'https://youtube.com/results?search_query=rain', 'https://youtube.com/@rain', 'https://youtube.com/playlist?list=abc', id,
    'https://user:pass@youtube.com/watch?v=' + id, 'https://youtube.com:4430/watch?v=' + id,
    url, 'https://youtu.be/' + id + '?t=60', 'https://m.youtube.com/shorts/' + other]);
  assert.deepEqual(candidates.map(c => c.videoId), [id, other]);
  assert.deepEqual(candidates.map(c => c.url), [url, videoUrl(other)]);
  assert.equal(youtubeCandidates(Array.from({ length: 20 }, (_, i) => videoUrl('testVideo' + String(i).padStart(2, '0')))).length, YOUTUBE_SEARCH_LIMITS.candidates);
});

test('actual provider sources and oEmbed metadata ground search; generated URLs and embed HTML are discarded', async () => {
  const d = wire({ sources: [url, 'https://youtu.be/' + id, 'https://example.org/' + other] });
  const found = await d.search('rain sounds', new AbortController().signal);
  assert.deepEqual(found, grounded); assert.equal(d.fetched.length, 1);
  assert.equal(d.fetched[0].searchParams.get('url'), url);
  const request = d.requests[0];
  assert.equal(request.store, false); assert.equal(request.max_tool_calls, 1);
  assert.deepEqual(request.tools[0].filters.allowed_domains, ['youtube.com', 'youtu.be']);
  assert.ok(request.include.includes('web_search_call.action.sources'));
  assert.equal(request.tools[0].search_context_size, 'low');
  assert.equal(JSON.stringify(found).includes('script'), false);
  assert.equal(JSON.stringify(found).includes(invented), false);
});

test('empty/uncited search and provider failures remain errors without invented links', async () => {
  const empty = wire({ sources: [], generatedText: `Found rain: ${url}` });
  await assert.rejects(empty.search('rain', new AbortController().signal), /No grounded/);
  assert.equal(empty.fetched.length, 0);
  await assert.rejects(wire({ failStatus: 429 }).search('rain', new AbortController().signal), error => error instanceof Error && /search is unavailable/.test(error.message) && !/secret-provider/.test(error.message));
});

test('failed, invalid, oversized and timed-out metadata retain only grounded links with honest labels', async () => {
  for (const metadata of [
    () => new Response('restricted', { status: 403 }), () => new Response('not found', { status: 404 }),
    () => new Response('{}'), () => new Response('invalid JSON'),
    () => new Response(JSON.stringify({ type: 'video', provider_name: 'Other', title: 'Wrong provider' })),
    () => new Response(JSON.stringify({ type: 'video', provider_name: 'YouTube', title: '   ' })),
    () => new Response('x'.repeat(YOUTUBE_SEARCH_LIMITS.responseBytes + 1)),
    () => { throw new DOMException('Metadata timed out', 'TimeoutError'); },
    () => { throw new Error('private-network-diagnostic'); },
  ]) {
    const found = await wire({ metadata }).search('music', new AbortController().signal);
    assert.deepEqual(found.results, [{ videoId: id, url, sourceUrl: url,
      title: `YouTube video ${id} (title unavailable)`, displayTitle: `YouTube video ${id} (title unavailable)`,
      channel: null, metadataVerified: false, playbackVerified: false }]);
    assert.doesNotMatch(JSON.stringify(found), /private-network|Wrong provider/);
    assert.equal(JSON.stringify(found).includes(invented), false);
  }
});

test('mixed metadata results preserve candidate order, verified titles and canonical provenance', async () => {
  const secondSource = `https://youtu.be/${other}?t=5`;
  const d = wire({ sources: [url, secondSource, `https://youtu.be/${id}`], metadata: endpoint =>
    endpoint.searchParams.get('url') === url ? new Response('no metadata', { status: 403 })
      : new Response(JSON.stringify({ type: 'video', provider_name: 'YouTube', title: 'Verified music title', author_name: 'Verified channel' })) });
  const found = await d.search('music', new AbortController().signal);
  assert.deepEqual(found.results.map(item => item.videoId), [id, other]);
  assert.equal(found.results[0].metadataVerified, false);
  assert.deepEqual(found.results[1], { videoId: other, url: videoUrl(other), sourceUrl: secondSource,
    title: 'Verified music title', displayTitle: 'Verified music title', channel: 'Verified channel', metadataVerified: true, playbackVerified: false });
  assert.equal(d.fetched.length, 2);
});

test('cancelling metadata acquisition rejects the search instead of returning fallback candidates', async () => {
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const d = wire({ metadata: (_endpoint, signal) => new Promise<Response>((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    started();
  }) });
  const controller = new AbortController();
  const pending = d.search('music', controller.signal);
  await ready; controller.abort();
  await assert.rejects(pending, error => error instanceof Error && error.name === 'AbortError');
});

test('metadata-free search can place a grounded video but never authorize an invented replacement', async () => {
  const fixture = canvasFixture();
  const d = wire({ metadata: () => new Response('no metadata', { status: 403 }) });
  const fallbackTitle = `YouTube video ${id} (title unavailable)`;
  const model = new MockLanguageModelV4({ doGenerate: [
    toolReply('search_youtube', { query: 'music' }, 'search'),
    toolReply('display_youtube', { surfaceId: 'wall', video: url, title: fallbackTitle, backlight: null, newPlayer: null }, 'place'),
    toolReply('display_youtube', { surfaceId: 'wall', video: videoUrl(invented), title: 'Invented', backlight: null, newPlayer: null }, 'invented'),
    textReply('Everything is playing.'),
  ] });
  const result = await createProjectionAgent({ canvas: fixture.port, model, youtubeSearch: d.search }).send('Find music and put it on the wall');
  assert.deepEqual(fixture.commands.map(command => command.type), ['content.create']);
  const video = fixture.scene().contents[0];
  assert.equal(video.kind, 'youtube');
  if (video.kind !== 'youtube') return;
  assert.equal(video.config.videoId, id); assert.equal(video.title, fallbackTitle);
  assert.match(result.text, /paused and muted/); assert.match(result.text, /Do not invent video IDs/);
  assert.doesNotMatch(result.text, /Everything is playing/);
  assert.match(JSON.stringify(model.doGenerateCalls[1].prompt), /"metadataVerified":false/);
});

test('search-only fallback reports unknown metadata without claiming playback or modifying the canvas', async () => {
  const fixture = canvasFixture();
  const model = new MockLanguageModelV4({ doGenerate: [toolReply('search_youtube', { query: 'music' }), textReply('Playing the verified artist.')] });
  const d = wire({ metadata: () => new Response('no metadata', { status: 403 }) });
  const result = await createProjectionAgent({ canvas: fixture.port, model, youtubeSearch: d.search }).send('Find music options');
  assert.match(result.text, /none have been placed yet/);
  assert.match(result.text, /title\/channel metadata unavailable; playback unverified/);
  assert.ok(result.text.includes(url)); assert.doesNotMatch(result.text, /Playing the verified artist/);
  assert.deepEqual(fixture.commands, []);
});

test('user reference provenance accepts supported schemeless/quoted/timestamp links without accepting lookalike hosts', () => {
  for (const prompt of [`Show (${url}&t=1m30s).`, `Play youtu.be/${id}?t=90!`, `Use "m.youtube.com/watch?v=${id}"`, `Display '${id}'.`, `Show https://www.youtube-nocookie.com/embed/${id}`]) {
    const ids = new Set<string>(); rememberUserVideos(prompt, ids); assert.ok(ids.has(id), prompt);
  }
  for (const prompt of [`Play https://notyoutube.com/watch?v=${id}`, `Play https://youtube.com.evil.test/watch?v=${id}`, 'put a rain sounds youtube video on the wall with backlight effect']) {
    const ids = new Set<string>(); rememberUserVideos(prompt, ids); assert.equal(ids.has(id), false);
  }
});

test('topic search selects a grounded video then displays it default-on while preserving room content and geometry', async () => {
  const fixture = canvasFixture();
  await fixture.port.dispatch({ type: 'content.create', id: 'fish', surfaceId: 'wall', title: 'Fish', spec: { kind: 'art', config: { preset: 'fish', palette: 'lagoon', speed: 1, seed: 3 } } });
  const before = structuredClone(fixture.scene()); let searches = 0;
  const model = new MockLanguageModelV4({ doGenerate: [toolReply('search_youtube', { query: 'rain sounds' }, 's'),
    toolReply('display_youtube', { surfaceId: 'wall', video: url, title: grounded.results[0].title, backlight: null, newPlayer: null }, 'd'), textReply('Playing perfectly!')] });
  const agent = createProjectionAgent({ canvas: fixture.port, model, youtubeSearch: async () => { searches++; return grounded; } });
  const result = await agent.send('put a rain sounds youtube video on the wall with backlight effect');
  assert.equal(searches, 1); assert.deepEqual(result.tools.map(t => t.toolName), ['search_youtube', 'display_youtube']);
  const video = fixture.scene().contents.find(c => c.kind === 'youtube')!;
  assert.deepEqual(video.config, { videoId: id, startSeconds: 0, backlight: true });
  assert.equal(video.title, grounded.results[0].title); assert.equal(video.surfaceId, 'wall');
  assert.deepEqual(fixture.scene().surfaces, before.surfaces); assert.deepEqual(fixture.scene().contents[0], before.contents[0]);
  assert.match(result.text, /Rain sounds for relaxation/); assert.ok(result.text.includes(url)); assert.doesNotMatch(result.text, /Playing perfectly/);
});

test('invented video IDs cannot be displayed or used for replacement after a search', async () => {
  const fixture = canvasFixture();
  await fixture.port.dispatch({ type: 'content.create', id: 'existing', surfaceId: 'wall', title: 'User video', spec: { kind: 'youtube', config: { videoId: other, startSeconds: 32, backlight: false } } });
  const before = structuredClone(fixture.scene());
  const model = new MockLanguageModelV4({ doGenerate: [toolReply('search_youtube', { query: 'rain' }, 's'),
    toolReply('display_youtube', { surfaceId: 'tabletop', video: videoUrl(invented), title: null, backlight: null, newPlayer: null }, 'd'),
    toolReply('update_content', { contentId: 'existing', title: null, spec: { kind: 'youtube', config: { videoId: invented, startSeconds: 0, backlight: true, backlightSettings: null } } }, 'u'), textReply('Done')] });
  const result = await createProjectionAgent({ canvas: fixture.port, model, youtubeSearch: async () => grounded }).send('Find a rain video');
  assert.deepEqual(fixture.scene(), before); assert.match(result.text, /Do not invent video IDs/); assert.match(result.text, /Search for the replacement/);
});

test('ordinary play requests reuse the only target-surface player on a crowded wall and preserve its settings and neighbors', async () => {
  let crowded = false;
  const fixture = canvasFixture(command => crowded && command.type === 'content.create' ? 'No free region fits this panel.' : undefined);
  await fixture.port.dispatch({ type: 'content.create', id: 'existing', surfaceId: 'wall', title: 'Old video', spec: { kind: 'youtube', config: {
    videoId: other, startSeconds: 38, backlight: false, backlightSettings: { intensity: 1.4, spread: .3, smoothingMs: 250 },
  } } });
  await fixture.port.dispatch({ type: 'content.create', id: 'fish', surfaceId: 'wall', title: 'Fish', spec: { kind: 'art', config: { preset: 'fish', palette: 'lagoon', speed: 1, seed: 3 } } });
  crowded = true; const before = structuredClone(fixture.scene()); const commandsBefore = fixture.commands.length;
  const model = new MockLanguageModelV4({ doGenerate: [toolReply('search_youtube', { query: 'rain sounds' }, 's'),
    toolReply('display_youtube', { surfaceId: 'wall', video: url, title: grounded.results[0].displayTitle, backlight: true, newPlayer: null }, 'replace'), textReply('Playing')] });
  const result = await createProjectionAgent({ canvas: fixture.port, model, youtubeSearch: async () => grounded }).send('put a rain sounds youtube video on the wall with backlight effect');
  assert.deepEqual(fixture.commands.slice(commandsBefore).map(command => command.type), ['content.update']);
  const video = fixture.scene().contents.find(c => c.id === 'existing')!;
  assert.deepEqual(video.bounds, before.contents[0].bounds); assert.equal(video.surfaceId, 'wall');
  assert.deepEqual(video.config, { videoId: id, startSeconds: 0, backlight: true, backlightSettings: { intensity: 1.4, spread: .3, smoothingMs: 250 } });
  assert.deepEqual(fixture.scene().contents[1], before.contents[1]); assert.deepEqual(fixture.scene().surfaces, before.surfaces);
  assert.equal(fixture.scene().contents.length, before.contents.length); assert.doesNotMatch(result.text, /No free region/);
  assert.match(result.text, /YouTube player updated on Back wall/);
  assert.match(JSON.stringify(model.doGenerateCalls[0].prompt), /exactly one YouTube player already exists/);
});

test('explicit additional players still allocate, while ambiguous multiple-player reuse makes no edits', async () => {
  let scene = reduceScene(initialScene(1000), { type: 'content.create', id: 'first', surfaceId: 'tabletop', title: 'First', spec: { kind: 'youtube', config: { videoId: other, startSeconds: 20, backlight: false } } });
  scene = reduceScene(scene, { type: 'content.move', id: 'first', bounds: { x: .12, y: .12, w: .2, h: .2 } });
  const fixture = canvasFixture(undefined, scene);
  const snapshot = await fixture.port.getSnapshot();
  const bound = await bindCanvasTurn(fixture.port, { turnId: 'additional', signal: new AbortController().signal, prompt: `Add a separate player using ${url}` });
  const displayed = await bound.tools.display_youtube.execute!({ surfaceId: 'tabletop', video: url, title: null, backlight: null, newPlayer: true }, { toolCallId: 'add', messages: [], context: {} }) as { ok: boolean };
  assert.equal(displayed.ok, true);
  assert.deepEqual(fixture.scene().contents.find(c => c.id === 'first'), snapshot.scene.contents[0]);
  assert.equal(fixture.commands.at(-1)?.type, 'content.create');
  const before = structuredClone(fixture.scene()); const count = fixture.commands.length;
  const ambiguous = await bound.tools.display_youtube.execute!({ surfaceId: 'tabletop', video: url, title: null, backlight: null, newPlayer: null }, { toolCallId: 'ambiguous', messages: [], context: {} }) as { ok: boolean; error: string };
  assert.equal(ambiguous.ok, false); assert.match(ambiguous.error, /More than one/); assert.deepEqual(fixture.scene(), before); assert.equal(fixture.commands.length, count);
});

test('search results survive a follow-up selection and search-only replies do not claim a canvas mutation', async () => {
  const fixture = canvasFixture();
  const model = new MockLanguageModelV4({ doGenerate: [toolReply('search_youtube', { query: 'rain' }, 's'), textReply('Found and playing a perfect video'),
    toolReply('display_youtube', { surfaceId: 'wall', video: url, title: grounded.results[0].title, backlight: false, newPlayer: null }, 'd'), textReply('Placed')] });
  const agent = createProjectionAgent({ canvas: fixture.port, model, youtubeSearch: async () => grounded });
  const listing = await agent.send('Find a rain video and show me the link'); assert.equal(fixture.commands.length, 0);
  assert.match(listing.text, /none have been placed yet/); assert.ok(listing.text.includes(url)); assert.ok(listing.text.includes('Rain channel')); assert.doesNotMatch(listing.text, /playing a perfect video/);
  await agent.send('Put that one on the wall without backlight');
  assert.equal(fixture.scene().contents[0].kind, 'youtube'); assert.equal(fixture.commands.length, 1);
});

test('repeated searches are deduplicated and distinct searches are bounded within a turn', async () => {
  const fixture = canvasFixture(); let calls = 0;
  const bound = await bindCanvasTurn(fixture.port, { turnId: 'search-limit', signal: new AbortController().signal, prompt: 'Find rain' }, { youtubeSearch: async () => { calls++; return grounded; } });
  const call = (query: string, toolCallId: string) => bound.tools.search_youtube.execute!({ query }, { toolCallId, messages: [], context: {} });
  await call('rain', 'one'); await call('rain', 'one'); await call('RAIN', 'two'); assert.equal(calls, 1);
  await call('rain forest', 'three'); const rejected = await call('rain window', 'four') as { ok: boolean; error: string };
  assert.equal(calls, 2); assert.equal(rejected.ok, false); assert.match(rejected.error, /limit reached/); assert.equal(fixture.commands.length, 0);
  assert.equal(roomContext(await fixture.port.getSnapshot(), true).capabilities.youtubeSearch, true);
  assert.match(await bound.instructions(), /Search metadata.*untrusted/);
});

test('search provider failure is honest and cancellation prevents a late search from placing content', async () => {
  const failed = canvasFixture();
  const errorModel = new MockLanguageModelV4({ doGenerate: [toolReply('search_youtube', { query: 'rain' }), textReply('Found and playing')] });
  const result = await createProjectionAgent({ canvas: failed.port, model: errorModel, youtubeSearch: async () => { throw new Error('YouTube search is unavailable right now.'); } }).send('Find rain');
  assert.match(result.text, /search is unavailable/); assert.doesNotMatch(result.text, /Found and playing/); assert.equal(failed.commands.length, 0);
  let started!: () => void, finish!: (value: YouTubeSearchResponse) => void;
  const ready = new Promise<void>(resolve => { started = resolve; }); const delayed = new Promise<YouTubeSearchResponse>(resolve => { finish = resolve; });
  const fixture = canvasFixture(); let searchSignal: AbortSignal | undefined;
  const model = new MockLanguageModelV4({ doGenerate: [toolReply('search_youtube', { query: 'rain' }), textReply('Done')] });
  const agent = createProjectionAgent({ canvas: fixture.port, model, youtubeSearch: async (_query, signal) => { searchSignal = signal; started(); return delayed; } });
  const pending = agent.send('Find rain and put it on the wall'); await ready; agent.cancel();
  await assert.rejects(pending, error => error instanceof AgentTurnError && error.code === 'cancelled');
  assert.equal(searchSignal?.aborted, true); finish(grounded); await new Promise(resolve => setImmediate(resolve));
  assert.equal(fixture.commands.length, 0); assert.equal(agent.busy, false);
});
