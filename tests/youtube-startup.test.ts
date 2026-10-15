import test from 'node:test';
import assert from 'node:assert/strict';
import { startVisiblePlayer, type PlayerAttempt } from '../src/youtubeStartup.ts';

function setup(visible = true) {
  let listener: (() => void) | undefined, nextTimer = 0;
  const timers = new Map<number, () => void>(), attempts: PlayerAttempt[] = [], states: string[] = [];
  let destroyed = 0;
  const dispose = startVisiblePlayer({
    start: attempt => { attempts.push(attempt); return () => { destroyed++; }; },
    loading: retry => states.push(retry ? 'retry' : 'loading'), waiting: () => states.push('hidden'), failed: message => states.push(message),
  }, {
    visible: () => visible, subscribe: next => { listener = next; return () => { listener = undefined; }; },
    schedule: callback => { const id = ++nextTimer; timers.set(id, callback); return () => { timers.delete(id); }; },
  });
  return { attempts, states, timers, dispose, destroyed: () => destroyed,
    visibility: (next: boolean) => { visible = next; listener?.(); },
    tick: () => { for (const [id, callback] of [...timers]) { timers.delete(id); callback(); } },
  };
}
test('hidden tabs wait instead of failing; returning replaces a stalled frame and ignores its late events', () => {
  const s = setup(false);
  assert.equal(s.attempts.length, 0); assert.equal(s.timers.size, 0);
  s.visibility(true); assert.equal(s.attempts.length, 1);
  s.visibility(false); s.tick(); assert.equal(s.timers.size, 0); assert.equal(s.attempts.length, 1);
  s.visibility(true); assert.equal(s.attempts.length, 2); assert.equal(s.destroyed(), 1);
  assert.equal(s.attempts[0].current(), false);
  s.attempts[0].ready(); s.attempts[0].fail('late failure');
  assert.equal(s.timers.size, 1); assert.equal(s.states.includes('late failure'), false);
  s.attempts[1].ready(); s.tick(); assert.equal(s.timers.size, 0);
  s.visibility(false); s.visibility(true); assert.equal(s.attempts.length, 2);
  s.dispose(); assert.equal(s.destroyed(), 2);
});
test('a visible load retries once, reports a persistent failure and never loops', () => {
  const s = setup(); s.tick(); assert.equal(s.attempts.length, 2); assert.equal(s.destroyed(), 1);
  s.tick(); assert.match(s.states.at(-1)!, /did not finish loading/);
  s.visibility(false); s.visibility(true); s.tick(); assert.equal(s.attempts.length, 2);
  s.dispose(); assert.equal(s.timers.size, 0);
});
test('ready playback and provider errors are not restarted by visibility or timeout', () => {
  for (const outcome of ['ready', 'error']) {
    const s = setup();
    if (outcome === 'ready') s.attempts[0].ready(); else s.attempts[0].fail('Embedding disabled');
    s.tick(); s.visibility(false); s.visibility(true);
    assert.equal(s.attempts.length, 1); assert.equal(s.timers.size, 0);
    s.dispose(); assert.equal(s.attempts[0].current(), false);
    s.attempts[0].fail('late error'); assert.notEqual(s.states.at(-1), 'late error');
  }
});
