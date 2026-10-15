import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

test('desktop preload uses shared media frames and preserves command errors, with no capture endpoint', async () => {
  const exposed: Record<string, any> = {}, requests: unknown[] = [], subscriptions = new Map<string, Function>();
  let fail = false;
  const electron = {
    contextBridge: { exposeInMainWorld: (name: string, api: unknown) => { exposed[name] = api; } },
    ipcRenderer: {
      invoke: async (channel: string, request: unknown) => { requests.push([channel, request]); if (fail) throw new Error('Video source is unavailable.'); return []; },
      on: (channel: string, fn: Function) => subscriptions.set(channel, fn),
      removeListener: (channel: string, fn: Function) => { if (subscriptions.get(channel) === fn) subscriptions.delete(channel); },
    },
  };
  runInNewContext(readFileSync(new URL('../electron/preload.cjs', import.meta.url), 'utf8'), { require: (id: string) => { assert.equal(id, 'electron'); return electron; } });
  assert.equal(exposed.projectionBacklight, undefined);
  assert.deepEqual(await exposed.projectionMedia.snapshot(), []);
  const command = { contentId: 'video', action: 'play' };
  await exposed.projectionMedia.command(command);
  assert.deepEqual(requests, [['media:snapshot', undefined], ['media:command', command]]);
  let received: unknown; const unsubscribe = exposed.projectionMedia.subscribe((event: unknown) => { received = event; });
  const event = { type:'removed',contentId:'video' }; subscriptions.get('media:event')!({}, event); assert.equal(received, event);
  unsubscribe(); assert.equal(subscriptions.size, 0);
  fail = true; await assert.rejects(exposed.projectionMedia.command(command), /Video source is unavailable/);
});

test('isolated media source preload has no scene, assistant or file/capture capabilities', () => {
  const exposed: Record<string, unknown> = {};
  runInNewContext(readFileSync(new URL('../electron/source-preload.cjs', import.meta.url), 'utf8'), { require: () => ({ contextBridge: { exposeInMainWorld: (name: string, value: unknown) => { exposed[name] = value; } }, ipcRenderer: {} }) });
  assert.deepEqual(Object.keys(exposed), ['projectionSource']);
  assert.deepEqual(Object.keys(exposed.projectionSource as object).sort(), ['report', 'subscribe']);
});
