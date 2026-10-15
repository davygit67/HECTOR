import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { applyUpdate } from '../host/apply-update.mjs';

const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const paths = ['src/SpatialStudio.tsx', 'src/ProjectionOutput.tsx', 'src/projection-output.css', 'src/shared/domain.ts', 'src/shared/spatial.ts', 'src/SpatialView.tsx'];
function fixture(version = 1, previousVersion = false) {
  const temp = mkdtempSync(join(tmpdir(), 'pm-fullscreen-update-')), root = join(temp, 'Room & wall'), patch = join(root, 'Fullscreen Update');
  mkdirSync(patch, { recursive: true }); writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'projection-mapper-prototype' }));
  const allPaths = version === 1 ? paths : [...paths, 'src/SurfaceEditor.tsx', 'src/bridge.ts', 'src/shared/outputPermissions.ts', 'electron/main.ts', 'src/shared/renderKeys.ts', 'src/browserMedia.ts', 'src/nativeMedia.ts', 'src/NativeYouTubePlayer.tsx', 'src/shared/media.ts', 'host/media-worker-client.ts', 'host/vite-media.ts', 'electron/media-worker.ts', 'electron/media-sources.ts'];
  const files = allPaths.map((path, i) => {
    const target = join(root, path), source = join(patch, 'payload', path); mkdirSync(dirname(target), { recursive: true }); mkdirSync(dirname(source), { recursive: true });
    if (previousVersion) writeFileSync(target, 'previous ' + path);
    else if (i !== 1 && i !== 2) writeFileSync(target, 'old ' + path);
    writeFileSync(source, 'new ' + path);
    return { path, beforeSha256: i === 1 || i === 2 ? null : hash('old ' + path), previousSha256: hash('previous ' + path), sha256: hash('new ' + path) };
  });
  writeFileSync(join(patch, 'manifest.json'), JSON.stringify({ id: 'projection-fullscreen-' + version, files }));
  mkdirSync(join(root, 'agent')); writeFileSync(join(root, 'agent', '.env'), 'PRIVATE FIXTURE - preserve');
  mkdirSync(join(root, '.local-data')); writeFileSync(join(root, '.local-data', 'room.json'), 'SAVED ROOM');
  return { temp, root, patch };
}
test('small update preserves credentials/room, backs up originals and is repeatable', () => {
  const f = fixture();
  try {
    const result = applyUpdate(f.patch, f.root); assert.equal(result.changed, 6);
    assert.equal(readFileSync(join(result.backup!, paths[0]), 'utf8'), 'old ' + paths[0]);
    for (const path of paths) assert.equal(readFileSync(join(f.root, path), 'utf8'), 'new ' + path);
    assert.equal(readFileSync(join(f.root, 'agent', '.env'), 'utf8'), 'PRIVATE FIXTURE - preserve');
    assert.equal(readFileSync(join(f.root, '.local-data', 'room.json'), 'utf8'), 'SAVED ROOM');
    assert.equal(applyUpdate(f.patch, f.root).changed, 0);
  } finally { rmSync(f.temp, { recursive: true, force: true }); }
});
test('incomplete downloads and different source versions are rejected before any write', () => {
  for (const kind of ['corrupt', 'different', 'unsafe']) {
    const f = fixture();
    try {
      if (kind === 'corrupt') writeFileSync(join(f.patch, 'payload', paths[4]), 'truncated');
      if (kind === 'different') writeFileSync(join(f.root, paths[4]), 'friend edits');
      if (kind === 'unsafe') {
        const m = JSON.parse(readFileSync(join(f.patch, 'manifest.json'), 'utf8')); m.files[4].path = '../agent/.env';
        writeFileSync(join(f.patch, 'manifest.json'), JSON.stringify(m));
      }
      assert.throws(() => applyUpdate(f.patch, f.root));
      assert.equal(readFileSync(join(f.root, paths[0]), 'utf8'), 'old ' + paths[0]);
      assert.equal(existsSync(join(f.root, '.local-data', 'updates')), false);
    } finally { rmSync(f.temp, { recursive: true, force: true }); }
  }
});

test('second update accepts the original package and first patch without resetting saved data', () => {
  for (const previousVersion of [false, true]) {
    const f = fixture(2, previousVersion);
    try {
      const result = applyUpdate(f.patch, f.root); assert.equal(result.changed, 19);
      assert.equal(readFileSync(join(f.root, 'agent', '.env'), 'utf8'), 'PRIVATE FIXTURE - preserve');
      assert.equal(readFileSync(join(f.root, '.local-data', 'room.json'), 'utf8'), 'SAVED ROOM');
      assert.equal(applyUpdate(f.patch, f.root).changed, 0);
    } finally { rmSync(f.temp, { recursive: true, force: true }); }
  }
});
