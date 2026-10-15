import test from 'node:test';
import assert from 'node:assert/strict';
import { requestTabStream, startSharedVideo } from '../src/tabColorSource.ts';
test('tab capture keeps user activation, clears its deadline on success, and retains the selected stream', async () => {
  let requested = false, stopped = false;
  const stream = { getTracks: () => [{ stop: () => { stopped = true; } }] };
  const pending = requestTabStream(() => { requested = true; return Promise.resolve(stream); }, 1);
  assert.equal(requested, true); assert.equal(await pending, stream);
  await new Promise(resolve => setTimeout(resolve, 5)); assert.equal(stopped, false);
});
test('a stuck sharing picker times out and a late permission grant immediately releases every track', async () => {
  let grant!: (stream: { getTracks(): { stop(): void }[] }) => void, stopped = 0;
  const pending = requestTabStream(() => new Promise(resolve => { grant = resolve; }), 1);
  await assert.rejects(pending, /Tab sharing did not start/);
  grant({ getTracks: () => [{ stop: () => { stopped++; } }, { stop: () => { stopped++; } }] });
  await Promise.resolve(); assert.equal(stopped, 2);
});
test('denial returns its actual error without a second request', async () => {
  const denial = new Error('Permission denied'); let requests = 0;
  await assert.rejects(requestTabStream(() => { requests++; return Promise.reject(denial); }), error => error === denial);
  assert.equal(requests, 1);
});
test('permission is not mistaken for playable frames and a stalled decoder is bounded', async () => {
  await assert.rejects(startSharedVideo({ play: () => new Promise(() => {}) }, 1), /allowed, but video frames did not start/);
  await startSharedVideo({ play: () => Promise.resolve() }, 1);
});
