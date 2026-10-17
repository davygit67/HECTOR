/** Optional paid check against OpenAI. Synthetic scenes only; search is a grounded
 * fixed fixture so this tests request orchestration without touching a live player. */
import assert from 'node:assert/strict';
import { createProjectionAgent, readAgentConfig } from '../src/index.js';
import { canvasFixture } from './canvas-fixture.js';

const config = { ...readAgentConfig(), maxSteps: 12, timeoutMs: 90000 };
const screenshot = 'Put a 2024 championship team highlight reel for the Celtics on the back wall with YouTube with a backlight at 30% room fill, and put some leprechauns frolicking through four-leaf clovers around the border of the room and also put a poster of Jason Tatum by the left side of the wall.';
const fixture = canvasFixture();
const agent = createProjectionAgent({ canvas: fixture.port, config, youtubeSearch: async () => ({ provider: 'OpenAI web search + YouTube oEmbed', results: [{
  videoId: 'k_AubmpRz7o', sourceUrl: 'https://www.youtube.com/watch?v=k_AubmpRz7o', url: 'https://www.youtube.com/watch?v=k_AubmpRz7o',
  title: 'The Boston Celtics Road To the 2024 NBA Championship', displayTitle: 'Celtics 2024 Championship',
  channel: null, metadataVerified: false, playbackVerified: false,
}] }) });
const start = Date.now();
const result = await agent.send(screenshot);
const video = fixture.scene().contents.find(c => c.kind === 'youtube');
assert.equal(video?.kind, 'youtube');
if (video?.kind === 'youtube') {
  assert.equal(video.config.videoId, 'k_AubmpRz7o');
  assert.equal(video.config.backlight, true);
  assert.equal(video.config.backlightSettings?.roomFill, .3);
}
assert.equal(result.status, 'incomplete');
assert.match(result.text, /leprechaun/i); assert.match(result.text, /clover/i); assert.match(result.text, /Tatum/i);
assert.match(result.text, /Not completed|Needs your input/);
assert.equal(fixture.scene().contents.length, 1);
console.log(JSON.stringify({ scenario: 'screenshot', elapsedMs: Date.now() - start, tools: result.tools.map(t => t.toolName), status: result.status, text: result.text, usage: result.usage }));

const supported = canvasFixture();
const composer = createProjectionAgent({ canvas: supported.port, config });
const second = await composer.send('Put a note reading Welcome on the back wall, create a three-minute Tea timer on the tabletop and start it, and add moving stars to the back wall. Set the timer layer opacity to 70%.');
assert.equal(supported.scene().contents.find(c => c.kind === 'note')?.config.text, 'Welcome');
assert.equal(supported.scene().contents.find(c => c.kind === 'art')?.config.preset, 'stars');
assert.equal(supported.scene().timers[0].status, 'running');
assert.equal(supported.scene().timers[0].durationMs, 180000);
assert.equal(supported.scene().timers[0].layer?.opacity, .7);
assert.equal(second.status, 'complete');
console.log(JSON.stringify({ scenario: 'supported-composition', tools: second.tools.map(t => t.toolName), status: second.status, text: second.text, usage: second.usage }));
console.log('Multipart live checks passed. No user canvas, player, or hardware was connected.');
