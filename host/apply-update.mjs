import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, copyFileSync, renameSync, writeFileSync, utimesSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const firstUpdate = ['src/SpatialStudio.tsx', 'src/SpatialView.tsx', 'src/ProjectionOutput.tsx', 'src/projection-output.css', 'src/shared/domain.ts', 'src/shared/spatial.ts'];
const profiles = {
  'projection-fullscreen-1': new Set(firstUpdate),
  'projection-fullscreen-2': new Set([...firstUpdate, 'src/SurfaceEditor.tsx', 'src/bridge.ts', 'src/shared/outputPermissions.ts', 'electron/main.ts', 'src/shared/renderKeys.ts', 'src/browserMedia.ts', 'src/nativeMedia.ts', 'src/NativeYouTubePlayer.tsx', 'src/shared/media.ts', 'host/media-worker-client.ts', 'host/vite-media.ts', 'electron/media-worker.ts', 'electron/media-sources.ts']),
};
profiles['projection-fullscreen-3'] = new Set([...profiles['projection-fullscreen-2'], 'src/shared/geometry.ts', 'src/shared/manualAlignment.ts', 'src/styles.css']);

/** Narrow update: verify everything before writing, and never touch settings or saved rooms. */
export function applyUpdate(patchDirectory, root) {
  const manifest = JSON.parse(readFileSync(join(patchDirectory, 'manifest.json'), 'utf8'));
  const allowed = profiles[manifest.id];
  if (!(allowed instanceof Set) || !Array.isArray(manifest.files) || manifest.files.length !== allowed.size) throw new Error('Invalid fullscreen update package.');
  if (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).name !== 'projection-mapper-prototype') throw new Error('This is not the Projection Mapper application folder.');
  const seen = new Set(), pending = [];
  for (const entry of manifest.files) {
    if (!allowed.has(entry.path) || seen.has(entry.path)) throw new Error('Unexpected update path. Nothing was changed.');
    seen.add(entry.path);
    const target = join(root, entry.path), source = join(patchDirectory, 'payload', entry.path);
    let ancestor = target;
    while (relative(root, ancestor)) {
      if (existsSync(ancestor) && lstatSync(ancestor).isSymbolicLink()) throw new Error('Update paths must not be symbolic links.');
      ancestor = dirname(ancestor);
    }
    const bytes = readFileSync(source);
    if (sha(bytes) !== entry.sha256) throw new Error('The update download is incomplete or changed. Extract a fresh copy.');
    const current = existsSync(target) ? sha(readFileSync(target)) : null;
    const accepted = [entry.beforeSha256, entry.previousSha256, entry.sha256, ...(manifest.id === 'projection-fullscreen-3' ? [entry.previous2Sha256] : [])];
    if (!accepted.includes(current)) throw new Error('A source file differs from the original handoff or previous update: ' + entry.path + '. Nothing was changed. Ask Nate for a matching update.');
    if (current !== entry.sha256) pending.push({ target, bytes, path: entry.path, existed: current !== null });
  }
  const backup = join(root, '.local-data', 'updates', manifest.id + '-' + Date.now());
  if (pending.length) mkdirSync(backup, { recursive: true });
  // Back up all originals before the first replacement; partial downloads cannot erase work.
  for (const entry of pending) if (entry.existed) {
    const destination = join(backup, entry.path); mkdirSync(dirname(destination), { recursive: true }); copyFileSync(entry.target, destination);
  }
  for (const entry of pending) {
    mkdirSync(dirname(entry.target), { recursive: true });
    const temporary = entry.target + '.fullscreen-update.tmp';
    writeFileSync(temporary, entry.bytes); renameSync(temporary, entry.target);
  }
  return { changed: pending.length, backup: pending.length ? backup : null };
}

async function main() {
  const patchDirectory = dirname(fileURLToPath(import.meta.url));
  const root = resolve(process.argv[2] ?? join(patchDirectory, '..'));
  if (!existsSync(join(root, 'package.json')) || !existsSync(join(root, 'host', 'app-environment.mjs'))) {
    throw new Error('Move this entire update folder inside your existing Projection Mapper Windows folder, then run its Apply Fullscreen Update.cmd again.');
  }
  const { npmCommand, runProcess } = await import(pathToFileURL(join(root, 'host', 'app-environment.mjs')).href);
  const npm = npmCommand();
  const result = applyUpdate(patchDirectory, root);
  console.log(result.changed ? 'Update source files installed. Original source files were backed up.' : 'Update files are already installed.');
  console.log('Preparing the updated app. Existing API key, dependencies and saved room stay in place.');
  await runProcess(npm.command, [...npm.prefix, 'run', 'build'], root);
  // Vite watches its config. Refresh its worker after the shared scene reader is rebuilt,
  // without finding/killing arbitrary processes or deleting the current room.
  const config = join(root, 'vite.config.ts');
  if (existsSync(config)) { const now = new Date(); utimesSync(config, now, now); }
  console.log('\nUPDATE COMPLETE. Reload Chrome. In Manual alignment, choose Align full screen, then Project.\nPress Esc to return. If the site is closed, run Start Projection Mapper.cmd.');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
