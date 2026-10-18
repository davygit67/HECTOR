import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { parseRoomScan } from '../src/shared/roomScan.js';
import { exportArguments, exportRoom, RTABMAP } from '../host/rtabmap-export.mjs';

const header = (format = 'ascii') => `ply\nformat ${format} 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n`;
const ascii = () => new TextEncoder().encode(header() + '0 0 0 255 0 0\n1 0 0 0 255 0\n0 2 1 0 0 255\n').buffer;
test('RTAB-Map PLY cloud import preserves XYZ meters, colors and frame without claiming calibration', () => {
  const scan = parseRoomScan(ascii());
  assert.deepEqual([...scan.positions], [0,0,0,1,0,0,0,2,1]);
  assert.deepEqual(scan.bounds, { min: [0,0,0], max: [1,2,1] });
  assert.equal(scan.frame, 'rtabmap-export'); assert.equal(scan.inputPoints, 3);
  assert.deepEqual([...scan.colors], [1,0,0,0,1,0,0,0,1]);
});
test('binary PCL-style PLY exports read in both byte orders', () => {
  for (const little of [true, false]) {
    const h = new TextEncoder().encode(header(little ? 'binary_little_endian' : 'binary_big_endian')), b = new Uint8Array(h.length + 45); b.set(h);
    const data = new DataView(b.buffer);
    for (let i = 0; i < 3; i++) { data.setFloat32(h.length + i * 15, i, little); data.setFloat32(h.length + i * 15 + 4, i * 2, little); data.setUint8(h.length + i * 15 + 12, 255); }
    assert.deepEqual([...parseRoomScan(b.buffer).positions], [0,0,0,1,2,0,2,4,0]);
  }
});
test('mesh, invalid point count, absent geometry and garbage imports fail', () => {
  const bytes = (s: string) => new TextEncoder().encode(s).buffer;
  assert.throws(() => parseRoomScan(bytes('nope')), /PLY/);
  assert.throws(() => parseRoomScan(bytes(header().replace('vertex 3', 'vertex 1000001'))), /1,000,000/);
  assert.throws(() => parseRoomScan(bytes(header().replace('end_header', 'element face 1\nproperty list uchar int vertex_indices\nend_header'))), /mesh/);
  assert.throws(() => parseRoomScan(bytes(header() + '0 0 0 0 0 0\n'.repeat(3))), /geometry/);
});
test('external reconstruction uses pinned recipe and argument boundaries; output directories never reused', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'pm-rtab-export-'));
  try {
    const database = path.join(folder, 'room with spaces.db'), executable = path.join(folder, 'rtabmap-export.exe');
    await writeFile(database, 'fixture'); await writeFile(executable, 'fixture');
    const calls: string[][] = [];
    const run = (_exe: string, args: string[], options: { shell: boolean }) => {
      assert.equal(_exe, executable); assert.equal(options.shell, false); calls.push(args);
      const child = new EventEmitter();
      setImmediate(async () => { await writeFile(path.join(args[args.indexOf('--output_dir') + 1], 'room_cloud.ply'), new Uint8Array(ascii())); child.emit('exit', 0); });
      return child;
    };
    const a = await exportRoom({ executable, database, destination: folder, run }), b = await exportRoom({ executable, database, destination: folder, run });
    assert.notEqual(a, b); assert.equal(calls[0].at(-1), database); assert.deepEqual(calls[0], exportArguments(database, path.dirname(a)));
    assert.equal(RTABMAP.version, '0.23.8'); assert.ok(!calls[0].includes('--save_in_db'));
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('PCL camera metadata after vertices is accepted and ignored', () => {
  const content = new TextDecoder().decode(ascii()).replace('end_header', 'element camera 1\nproperty float view_px\nend_header') + '0\n';
  assert.equal(parseRoomScan(new TextEncoder().encode(content).buffer).inputPoints, 3);
});
