import test from 'node:test';
import assert from 'node:assert/strict';
import { isOutputCalibrationCommand } from '../src/shared/outputPermissions';
import { initialScene, readScene, reduceScene } from '../src/shared/domain';
import type { Bridge } from '../src/shared/bridge';

test('output windows allow only manual corner commands', () => {
  assert.equal(isOutputCalibrationCommand({type:'calibration.set'}), true);
  assert.equal(isOutputCalibrationCommand({type:'calibration.reset'}), true);
  for (const input of [null, undefined, 'calibration.set', {}, {type:'timer.create'}, {type:'content.remove'}, {type:'grid.set'}, {type:'manual.target'}, {type:'surface.move'}, {type:'youtube.backlight'}]) {
    assert.equal(isOutputCalibrationCommand(input), false);
  }
});

test('browser output saves alignment through the canonical scene, preserves content and rejects other edits', async () => {
  const key = 'projection-mapper.scene.v3';
  const original = reduceScene(initialScene(), {type:'timer.create',id:'kept',title:'Keep this',durationMs:60000,surfaceId:'wall'});
  const store = new Map([[key, JSON.stringify(original)]]), broadcasts: unknown[] = [];
  const globals = {
    window: {addEventListener() {}}, location: {search:'?view=output'},
    localStorage: {getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k,v)},
    BroadcastChannel: class { onmessage: unknown; postMessage(value: unknown) { broadcasts.push(value); } },
  };
  const previous = Object.fromEntries(Object.keys(globals).map(k => [k, Object.getOwnPropertyDescriptor(globalThis,k)]));
  try {
    for (const [k,v] of Object.entries(globals)) Object.defineProperty(globalThis,k,{value:v, configurable:true, writable:true});
    const {bridge} = await import('../src/bridge') as {bridge: Bridge};
    const quad = structuredClone(original.manualOutput.quad); quad[0].x += .05;
    const result = await bridge.dispatch({type:'calibration.set',quad}); assert.equal(result.ok,true);
    const saved = readScene(JSON.parse(store.get(key)!));
    assert.deepEqual(saved.manualOutput.quad,quad); assert.deepEqual(saved.timers,original.timers);
    assert.deepEqual(saved.surfaces,original.surfaces); assert.equal(saved.showGrid,original.showGrid);
    assert.equal((await bridge.getSnapshot()).saveStatus,'saved'); assert.equal(broadcasts.length,1);
    const before = store.get(key);
    assert.equal((await bridge.dispatch({type:'timer.remove',id:'kept'})).ok,false);
    assert.equal((await bridge.dispatch({type:'grid.set',visible:!original.showGrid})).ok,false);
    assert.equal((await bridge.dispatch({type:'calibration.set',quad:[quad[0],quad[2],quad[1],quad[3]]})).ok,false);
    assert.equal(store.get(key),before);
    // Another studio can save between drags. The cached scene must rebase on it.
    const external=reduceScene(saved,{type:'timer.update',id:'kept',title:'Changed elsewhere'});
    store.set(key,JSON.stringify(external));
    assert.equal((await bridge.dispatch({type:'calibration.reset'})).ok,true);
    assert.equal(readScene(JSON.parse(store.get(key)!)).timers[0].title,'Changed elsewhere');
  } finally {
    for (const [k,descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis,k,descriptor); else Reflect.deleteProperty(globalThis,k);
    }
  }
});
