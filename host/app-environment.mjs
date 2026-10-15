import { existsSync } from 'node:fs';
import { join, win32 } from 'node:path';
import { spawn } from 'node:child_process';

export function supportsNode(version) {
  const [major, minor] = version.replace(/^v/, '').split('.').map(Number);
  return Number.isInteger(major) && (major > 22 || major === 22 && minor >= 12);
}

/** Execute npm's JS entry directly on Windows: no cmd.exe quoting or shell interpolation. */
export function npmCommand({ platform = process.platform, executable = process.execPath, env = process.env, exists = existsSync } = {}) {
  if (platform !== 'win32') return { command: 'npm', prefix: [] };
  const candidates = [env.npm_execpath, win32.join(win32.dirname(executable), 'node_modules', 'npm', 'bin', 'npm-cli.js')];
  const cli = candidates.find(candidate => candidate && /npm-cli\.js$/i.test(candidate) && exists(candidate));
  if (!cli) throw new Error('Cannot find npm beside Node.js. Install the standard Windows Node.js distribution, reopen this window, and retry.');
  return { command: executable, prefix: [cli] };
}

export function runProcess(command, args, cwd, spawnProcess = spawn) {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(command, args, { cwd, stdio: 'inherit', shell: false });
    child.once('error', error => reject(new Error(`Could not start ${command}: ${error.message}`)));
    child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`Command failed (${signal ?? code ?? 'unknown exit'}). See the output above.`)));
  });
}

export function setupSteps(root) {
  return [
    { cwd: root, args: ['ci'], label: 'Install studio dependencies' },
    { cwd: join(root, 'agent'), args: ['ci'], label: 'Install assistant dependencies' },
    { cwd: join(root, 'agent'), args: ['run', 'build'], label: 'Build assistant' },
    { cwd: join(root, 'sensor-helper'), args: ['ci'], label: 'Install sensor helper dependencies' },
    { cwd: join(root, 'sensor-helper'), args: ['run', 'build'], label: 'Build sensor helper relay' },
    { cwd: root, args: ['run', 'build'], label: 'Build studio and video renderer' },
  ];
}

export function inspectApp(root, { platform = process.platform, arch = process.arch, version = process.versions.node, exists = existsSync } = {}) {
  return {
    platform, arch, node: version, nodeSupported: supportsNode(version),
    studioDependencies: exists(join(root, 'node_modules', 'vite', 'bin', 'vite.js')),
    studioBuilt: exists(join(root, 'dist', 'index.html')) && exists(join(root, 'dist-electron', 'electron', 'media-worker.js')),
    mediaInstalled: exists(join(root, 'node_modules', 'electron', 'dist', platform === 'win32' ? 'electron.exe' : platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron')),
    agentDependencies: exists(join(root, 'agent', 'node_modules', 'ai', 'package.json')),
    agentBuilt: exists(join(root, 'agent', 'dist', 'index.js')),
    agentConfigPresent: exists(join(root, 'agent', '.env')),
    helperBuilt: exists(join(root, 'sensor-helper', 'dist', 'cli.js')),
    helperDependencies: exists(join(root, 'sensor-helper', 'node_modules', 'ws', 'package.json')),
    nativeHelperBuilt: exists(join(root, 'sensor-helper', 'native', 'bin', 'KinectCapture.exe')),
    nativePlatform: platform === 'win32' && arch === 'x64',
  };
}

/** First-run setup is needed only for an incomplete, stopped installation. */
export function windowsStartActions(report, studio) {
  if (!report.nodeSupported) throw new Error('Node.js 22.12 or newer is required.');
  if (studio === 'running') return ['preview'];
  if (studio !== 'offline') throw new Error(studio === 'blocked'
    ? 'Local network access is blocked. Run this launcher outside a sandbox.'
    : 'Port 5173 is used by another service. Nothing was stopped.');
  const ready = report.studioDependencies && report.studioBuilt && report.mediaInstalled
    && report.agentDependencies && report.agentBuilt && report.helperDependencies && report.helperBuilt;
  return ready ? ['preview'] : ['setup', 'preview'];
}

export function reportLines(report) {
  const mark = value => value ? 'OK' : 'MISSING';
  return [
    `Computer: ${report.platform} / ${report.arch}`,
    `Node.js ${report.node}: ${report.nodeSupported ? 'OK' : 'requires 22.12 or newer'}`,
    `Studio dependencies: ${mark(report.studioDependencies)}`,
    `Studio/video build: ${mark(report.studioBuilt)}`,
    `Video renderer executable: ${mark(report.mediaInstalled)}`,
    `Assistant build: ${mark(report.agentBuilt)}`,
    `Assistant .env file: ${report.agentConfigPresent ? 'present (contents not read)' : 'absent (manual controls still work; environment configuration may be used)'}`,
    `Sensor relay build: ${mark(report.helperBuilt)}`,
    `Native Kinect executable: ${mark(report.nativeHelperBuilt)}`,
    `Native Kinect platform: ${report.nativePlatform ? 'Windows x64; SDK/USB/device checks still required' : 'Windows x64 required; demo/replay remain available'}`,
    'This report does not establish that a Kinect is connected or that calibration is correct.',
  ];
}

export async function probeStudio(url = 'http://127.0.0.1:5173/', fetcher = fetch) {
  try {
    const response = await fetcher(url, { signal: AbortSignal.timeout(1500), redirect: 'error' });
    const body = (await response.text()).slice(0, 100000);
    return response.ok && /<title>Projection Mapper[^<]*<\/title>/i.test(body) ? 'running' : 'occupied';
  } catch (error) {
    if (['EPERM', 'EACCES'].includes(error.cause?.code)) return 'blocked';
    // An HTTP redirect means another service owns the port, not that the port is free.
    if (error.cause?.message?.includes('redirect')) return 'occupied';
    return 'offline';
  }
}
