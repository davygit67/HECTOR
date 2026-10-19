/** Optional paid OpenAI scenarios on synthetic images/isolated ports, never the user's scene or Kinect. */
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { createProjectionAgent, readAgentConfig } from '../src/index.js';
import { mappingFixture } from './mapping-fixture.js';
import type { MappingImage } from '../../src/shared/mappingWorkshop.js';

function png(kind: 'camera' | 'depth' | 'overlay' | 'mask'): MappingImage {
  const w = 256, h = 192, raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = x / w, v = y / h, inObject = u >= .4 && u <= .52 && v >= .3 && v <= .5;
    const edge = inObject && (u < .408 || u > .512 || v < .31 || v > .49);
    const color = kind === 'mask' ? inObject && !edge ? [255,255,255] : [0,0,0]
      : kind === 'depth' ? inObject ? [245,190,30] : [45,75,125]
      : kind === 'overlay' && edge ? [255,225,0] : inObject ? [35,95,220] : v > .55 ? [100,85,65] : [210,210,210];
    const i = y * (1 + w * 3) + 1 + x * 3; raw.set(color, i);
  }
  const crc = (data: Buffer) => { let value = 0xffffffff; for (const byte of data) { value ^= byte; for (let b = 0; b < 8; b++) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1; } return (value ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => { const prefix = Buffer.alloc(4), body = Buffer.concat([Buffer.from(type), data]), checksum = Buffer.alloc(4); prefix.writeUInt32BE(data.length); checksum.writeUInt32BE(crc(body)); return Buffer.concat([prefix, body, checksum]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(w); header.writeUInt32BE(h, 4); header[8] = 8; header[9] = 2;
  return { mimeType: 'image/png', width: w, height: h, data: Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]).toString('base64') };
}
const images = { camera: png('camera'), depth: png('depth'), overlay: png('overlay'), projectorMask: png('mask') };
const selected = process.argv[2];
for (const scenario of ['refine', 'select', 'lost'] as const) {
  if (selected && selected !== scenario) continue;
  const f = mappingFixture(scenario !== 'select'), before = f.scene(), capture = f.studio.observeMapping!;
  f.studio.observeMapping = async input => ({ ...await capture(input), images: structuredClone(images) });
  const agent = createProjectionAgent({ canvas: f.port, config: { ...readAgentConfig(), maxSteps: 14, timeoutMs: 90000 } });
  if (scenario === 'lost') {
    f.hardware.canAcquire = false; f.hardware.objectMapping!.state = 'lost';
    f.studio.observeMapping = async () => { throw new Error('The Kinect is disconnected. No fresh physical camera/depth observation is available.'); };
  }
  const prompts = scenario === 'refine' ? [
    'Workshop the selected object mapping: set inset to 3 mask cells, feather to 2 mask cells, and trim just the left edge by 10%. Keep its existing color and calibration. Inspect the paired camera/depth before and after; do not claim physical alignment is verified.',
    'Undo only that last mapping refinement and inspect afterward. Keep the selected object, its color and calibration.',
  ] : scenario === 'select' ? ['Select the blue object visible in the paired camera/depth observation, then tighten its inset to 2 mask cells and soften inward by 1 cell. Inspect after each change. Keep it uncolored; do not create a scene asset.']
    : ['Tighten the selected object mapping to 3 mask cells, inspecting the current camera/depth before and after.'];
  for (const [index, prompt] of prompts.entries()) {
    const count = f.operations.length, result = await agent.send(prompt);
    console.log(JSON.stringify({ scenario, index, status: result.status, tools: result.tools.map(t => t.toolName), text: result.text, usage: result.usage }));
    if (result.status !== 'complete' && scenario !== 'lost') console.log(JSON.stringify({ reviewDiagnostics: result.tools.filter(t => t.toolName === 'review_request').map(t => t.output) }));
    assert.deepEqual(f.scene(), before); assert.deepEqual(f.commands, []);
    const actions = f.operations.slice(count);
    if (scenario === 'lost') { assert.equal(actions.length, 0); assert.notEqual(result.status, 'complete'); continue; }
    assert.equal(result.status, 'complete'); assert.ok(result.tools.filter(t => t.toolName === 'inspect_object_mapping').length >= 2);
    assert.equal(f.hardware.objectMapping!.calibrationId, 'test-calibration');
    if (scenario === 'select') {
      assert.deepEqual(actions.map(a => a.type), ['mapping.select', 'mapping.refine']);
      assert.equal(f.state.objectId, 'selected-candidate'); assert.equal(f.state.settings.insetPx, 2); assert.equal(f.state.settings.featherPx, 1); assert.equal(f.hardware.objectMapping!.object!.color, null);
    } else {
      assert.equal(actions.length, 1); assert.equal(f.state.settings.insetPx, index ? 1 : 3); assert.equal(f.state.settings.featherPx, index ? 0 : 2);
      assert.equal(f.state.settings.trim.left, index ? 0 : .1); assert.equal(f.hardware.objectMapping!.object!.color, '#ff0000');
    }
    assert.match(result.text, /physical alignment is not verified/i);
  }
}
console.log('Isolated mapping-agent checks passed. Synthetic RGB/depth images are not physical Kinect or optical qualification.');
