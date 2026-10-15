import assert from 'node:assert/strict';
import test from 'node:test';
import { asSchema } from 'ai';
import { initialScene, readScene, reduceScene } from '../../src/shared/domain.js';
import { MEDIA_DEFAULTS } from '../../src/shared/mediaContent.js';
import { DISPLAY_DEFAULTS } from '../../src/shared/layers.js';
import { bindCanvasTurn, roomContext } from '../src/canvas.js';
import { AGENT_COMMAND_TYPES } from '../src/commands.js';
import { createProjectionAgent } from '../src/projection-agent.js';
import { canvasFixture } from './canvas-fixture.js';
import { MockLanguageModelV4, textReply, toolReply } from './model.js';

function uploaded(mediaType: 'video' | 'image' = 'video') {
  let scene = reduceScene(initialScene(1000), { type: 'content.create', id: 'uploaded', surfaceId: 'wall', title: 'My local file',
    spec: { kind: 'media', config: { ...MEDIA_DEFAULTS, assetId: 'local-asset-1', mediaType,
      fileName: mediaType === 'video' ? 'trip.mp4' : 'photo.png', mimeType: mediaType === 'video' ? 'video/mp4' : 'image/png',
      width: 640, height: 360, duration: mediaType === 'video' ? 60 : 0, volume: .4, playbackRate: 1.5 } },
  }, 1000);
  scene = reduceScene(scene, { type: 'content.create', id: 'note', surfaceId: 'tabletop', title: 'Keep me', spec: { kind: 'note', config: { text: 'Untouched', accent: '#abcdef' } } }, 1000);
  scene.contents[0].layer = { order: 4, visible: true, locked: false, opacity: .65 };
  return canvasFixture(undefined, readScene(scene));
}
async function call(fixture: ReturnType<typeof canvasFixture>, tool: string, input: unknown) {
  const model = new MockLanguageModelV4({ doGenerate: [toolReply(tool, input), textReply('Done, a generated game is showing and playing with sound.')] });
  return createProjectionAgent({ canvas: fixture.port, model }).send('Apply the requested change.');
}

test('uploaded media title edit preserves asset, playback, layers and unrelated content', async () => {
  const fixture = uploaded(), before = structuredClone(fixture.scene());
  const result = await call(fixture, 'update_content', { contentId: 'uploaded', title: 'Holiday', spec: null });
  const after = fixture.scene().contents[0];
  assert.equal(after.title, 'Holiday');
  assert.deepEqual(after.config, before.contents[0].config);
  assert.deepEqual(after.state, before.contents[0].state);
  assert.deepEqual(after.layer, before.contents[0].layer);
  assert.deepEqual(fixture.scene().contents[1], before.contents[1]);
  assert.match(result.text, /Uploaded video.*Holiday.*updated/);
  assert.match(result.text, /not been verified/);
  assert.doesNotMatch(result.text, /game|generated|playing with sound/);
  const receipt = result.tools[0].output as { assetAvailability: string; playback: { verified: boolean }; presentation: { outputVerified: boolean } };
  assert.equal(receipt.assetAvailability, 'unverified'); assert.equal(receipt.playback.verified, false); assert.equal(receipt.presentation.outputVerified, false);
});

test('existing uploaded video actions and attachment retain source and audio settings', async () => {
  const fixture = uploaded(), before = structuredClone(fixture.scene().contents[0]);
  for (const action of ['start', 'pause', 'reset'] as const) {
    const result = await call(fixture, 'control_content', { contentId: 'uploaded', action });
    const item = fixture.scene().contents[0];
    if (item.kind !== 'media') throw new Error('Expected uploaded media');
    assert.equal(item.state.clock.running, action === 'start');
    assert.deepEqual(item.config, before.config); assert.deepEqual(item.layer, before.layer);
    assert.match(result.text, action === 'start' ? /playback requested/ : /paused in the scene/);
    assert.match(result.text, /not been verified/);
  }
  const clock = structuredClone(fixture.scene().contents[0].state);
  const result = await call(fixture, 'attach_content', { contentId: 'uploaded', surfaceId: 'tabletop' });
  const moved = fixture.scene().contents[0];
  assert.equal(moved.surfaceId, 'tabletop'); assert.deepEqual(moved.config, before.config);
  assert.deepEqual(moved.layer, before.layer); assert.deepEqual(moved.state, clock);
  assert.match(result.text, /Uploaded video.*Tabletop: moved/);
});

test('image actions fail honestly; removal remains available for existing media', async () => {
  const fixture = uploaded('image'), before = structuredClone(fixture.scene());
  const result = await call(fixture, 'control_content', { contentId: 'uploaded', action: 'start' });
  assert.deepEqual(fixture.scene(), before);
  assert.match(result.text, /Could not.*Images/); assert.doesNotMatch(result.text, /game|playing with sound/);
  const removed = await call(fixture, 'remove_content', { contentId: 'uploaded' });
  assert.equal(fixture.scene().contents.some(item => item.id === 'uploaded'), false);
  assert.deepEqual(fixture.scene().contents[0], before.contents[1]); assert.match(removed.text, /Removed/);
});

test('assistant cannot invent an uploaded asset or expose UI-only commands', async () => {
  const fixture = uploaded(), before = structuredClone(fixture.scene());
  const result = await call(fixture, 'update_content', { contentId: 'uploaded', title: null,
    spec: { kind: 'media', config: { ...fixture.scene().contents[0].config, assetId: 'invented-file' } } });
  assert.deepEqual(fixture.scene(), before); assert.equal(fixture.commands.length, 0); assert.match(result.text, /could not|Could not/i);
  const bound = await bindCanvasTurn(fixture.port, { turnId: 'inspect', signal: new AbortController().signal });
  assert.equal(Object.keys(bound.tools).length, 17);
  const schema = JSON.stringify(await asSchema(bound.tools.update_content.inputSchema).jsonSchema);
  assert.doesNotMatch(schema, /"const":"media"|"assetId"/);
  for (const type of ['media.seek', 'layer.configure', 'layer.reorder', 'display.configure']) assert.equal((AGENT_COMMAND_TYPES as readonly string[]).includes(type), false);
});

test('agent context resolves legacy presentation defaults and current hidden settings', async () => {
  const legacy = canvasFixture();
  assert.deepEqual(roomContext(await legacy.port.getSnapshot()).display, DISPLAY_DEFAULTS);
  const scene = structuredClone(uploaded().scene());
  scene.contents[0].layer = { order: 0, visible: false, locked: true, opacity: 0 };
  scene.display = { quality: 'fast', brightness: 0, blackout: true };
  const fixture = canvasFixture(undefined, readScene(scene));
  const context = roomContext(await fixture.port.getSnapshot());
  assert.deepEqual(context.display, scene.display);
  assert.deepEqual(context.layers.find(layer => layer.surfaceId === 'wall')!.backToFront[0], {
    id: 'uploaded', visible: false, opacity: 0, locked: true,
  });
  assert.equal(context.capabilities.localMedia.uploadThroughTools, false);
  const result = await call(fixture, 'update_content', { contentId: 'uploaded', title: 'Renamed while hidden', spec: null });
  assert.match(result.text, /Visibility is disabled by output blackout and zero output brightness and hidden layer and zero layer opacity/);
  assert.deepEqual(fixture.scene().display, scene.display); assert.deepEqual(fixture.scene().contents[0].layer, scene.contents[0].layer);
});

test('hidden existing notes also report output visibility limits without undoing controls', async () => {
  const scene = structuredClone(uploaded().scene());
  scene.contents[1].layer = { order: 3, visible: false, locked: false, opacity: 1 };
  const fixture = canvasFixture(undefined, readScene(scene));
  const result = await call(fixture, 'update_content', { contentId: 'note', title: 'Renamed note', spec: null });
  assert.match(result.text, /Updated note/); assert.match(result.text, /Visibility is disabled by hidden layer/);
  assert.deepEqual(fixture.scene().contents[1].layer, scene.contents[1].layer);
});
