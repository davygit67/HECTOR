import test from 'node:test';
import assert from 'node:assert/strict';
import { initialScene, reduceScene } from '../src/shared/domain';
import { artworkSceneKey, mediaSourceKey } from '../src/shared/renderKeys';

test('corner and selection changes reuse artwork and do not resync native players', () => {
  let scene = reduceScene(initialScene(1000), {type:'content.create',id:'v',title:'Video',surfaceId:'wall',spec:{kind:'youtube',config:{videoId:'M7lc1UVf-VE',startSeconds:0,backlight:true}}});
  const pixels = artworkSceneKey(scene, false), source = mediaSourceKey(scene);
  for (let i = 0; i < 100; i++) {
    const quad = structuredClone(scene.manualOutput.quad); quad[0].x = .1 + i / 1000;
    scene = reduceScene(scene, {type:'calibration.set',quad});
    assert.equal(artworkSceneKey(scene,false), pixels); assert.equal(mediaSourceKey(scene),source);
  }
  scene = reduceScene(scene, {type:'surface.select',id:'wall'});
  assert.equal(artworkSceneKey(scene,false), pixels);
  const styled = reduceScene(scene,{type:'youtube.backlight',id:'v',enabled:false});
  assert.notEqual(artworkSceneKey(styled,false),pixels); assert.notEqual(mediaSourceKey(styled),source);
  const geometry = reduceScene(scene,{type:'surface.move',id:'wall',origin:[-2,0,-2]});
  assert.notEqual(artworkSceneKey(geometry,false),pixels);
  const replaced = structuredClone(scene); (replaced.contents[0].config as any).videoId = 'I5QMtbO-DNk';
  assert.notEqual(mediaSourceKey(replaced),source);
});
test('timer rendering keys change only in views that paint timers', () => {
  const scene=initialScene(1000), added=reduceScene(scene,{type:'timer.create',id:'t',title:'Timer',durationMs:60000});
  assert.equal(artworkSceneKey(scene,false),artworkSceneKey(added,false));
  assert.notEqual(artworkSceneKey(scene,true),artworkSceneKey(added,true));
  assert.equal(mediaSourceKey(scene),mediaSourceKey(added));
});
