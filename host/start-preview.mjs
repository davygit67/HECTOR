import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, closeSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { npmCommand, probeStudio, runProcess, supportsNode } from './app-environment.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const url = 'http://127.0.0.1:5173/';
async function start() {
  if (!supportsNode(process.versions.node)) throw new Error('Node.js 22.12 or newer is required.');
  const existing = await probeStudio(url);
  if (existing === 'running') { console.log('Studio is already running at ' + url); return; }
  if (existing === 'occupied') throw new Error('Port 5173 is used by another service. Nothing was stopped. Choose another port for that service before launching the studio.');
  if (existing === 'blocked') throw new Error('This environment blocks local network access. Run the preview launcher in your normal terminal.');
  if (!existsSync(join(root, 'node_modules/vite/bin/vite.js'))) throw new Error('Studio dependencies are missing. Run Setup Windows.cmd on Windows, or npm ci on Mac, then retry.');
  // Build only when starting a fresh server; never replace a running worker's assets.
  if (!existsSync(join(root, 'dist-electron/electron/media-worker.js')) || !existsSync(join(root, 'dist/index.html'))) {
    console.log('Preparing the local video renderer…');
    const npm = npmCommand(); await runProcess(npm.command, [...npm.prefix, 'run', 'build'], root);
  }
  const data = join(root, '.local-data');
  mkdirSync(data, { recursive: true });
  const log = openSync(join(data, 'preview.log'), 'a', 0o600);
  const server = spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '5173', '--strictPort'], {
    cwd: root, detached: true, windowsHide: true, stdio: ['ignore', log, log],
  });
  let launchError = null;
  server.on('error', error => { launchError = error; });
  server.unref(); closeSync(log);
  let ready = false;
  for (let attempt = 0; attempt < 30 && !ready && !launchError && server.exitCode === null; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 200)); ready = await probeStudio(url) === 'running';
  }
  if (ready) {
    if (server.pid) writeFileSync(join(data, 'preview.pid'), String(server.pid), { mode: 0o600 });
    console.log('Studio is running in the background at ' + url + '\nReturn to the studio and click Reconnect. You can close this terminal window.');
  }
  else {
    if (server.pid && server.exitCode === null) server.kill();
    throw new Error('Studio did not start. Check .local-data/preview.log in the project folder.' + (launchError ? ' ' + launchError.message : ''));
  }
}
start().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
