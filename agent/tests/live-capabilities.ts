/** Explicit, paid smoke check. Synthetic canonical rooms only; never attaches to the user's app. */
import assert from 'node:assert/strict';
import { createProjectionAgent, readAgentConfig } from '../src/index.js';
import { canvasFixture } from './canvas-fixture.js';
import { initialScene, reduceScene } from '../../src/shared/domain.js';
const config = readAgentConfig();
const scene = reduceScene(initialScene(1000), { type: 'timer.create', id: 'test-timer', title: 'Pasta', durationMs: 300000, surfaceId: 'wall' }, 1000);
const fixture = canvasFixture(undefined, scene);
const agent = createProjectionAgent({ canvas: fixture.port, config, roomId: 'isolated-smoke-room' });
async function request(prompt: string, verify: () => void) {
  const start = Date.now(); const result = await agent.send(prompt); verify();
  console.log(JSON.stringify({ prompt, tools: result.tools.map(t => t.toolName), status: result.status, elapsedMs: Date.now() - start, usage: result.usage }));
}
await request('Move the Pasta timer to the top right of the back wall, 30% wide and 20% tall, with a 4% margin. Keep its duration and state.', () => {
  const timer = fixture.scene().timers[0]; assert.ok(timer.bounds.x > .6); assert.equal(timer.bounds.w, .3); assert.equal(timer.durationMs, 300000);
});
await request('Set that timer layer opacity to 60%, lock its position, and set output brightness to 120%.', () => {
  assert.equal(fixture.scene().timers[0].layer?.opacity, .6); assert.equal(fixture.scene().timers[0].layer?.locked, true); assert.equal(fixture.scene().display?.brightness, 1.2);
});
await request('Remember that I prefer gentle video lighting with 65% opacity for movies in this room.', () => {});
assert.ok((await agent.memory.list()).entries.some(e => e.source === 'explicit'));
agent.clear();
await request('What video lighting do I prefer for movies? Do not change the room.', () => { assert.equal(fixture.scene().timers.length, 1); });
console.log('Isolated live capability checks passed. No user scene or player was connected.');
