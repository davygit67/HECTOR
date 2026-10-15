import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { inspectApp, npmCommand, probeStudio, reportLines, runProcess, setupSteps, supportsNode, windowsStartActions } from '../host/app-environment.mjs';

test('Windows npm execution preserves spaces and metacharacters without a shell', () => {
  const exe = 'C:\\User & Projects\\Node\\node.exe', cli = 'C:\\User & Projects\\Node\\node_modules\\npm\\bin\\npm-cli.js';
  assert.deepEqual(npmCommand({ platform: 'win32', executable: exe, env: {}, exists: (path: string) => path === cli }), { command: exe, prefix: [cli] });
  assert.deepEqual(npmCommand({ platform: 'darwin' }), { command: 'npm', prefix: [] });
  assert.throws(() => npmCommand({ platform: 'win32', env: {}, exists: () => false }), /Cannot find npm/);
});
test('setup installs each owned package in place and never overwrites secrets or scenes', () => {
  const steps = setupSteps('/fixture');
  assert.deepEqual(steps.map((s: any) => s.cwd), ['/fixture', '/fixture/agent', '/fixture/agent', '/fixture/sensor-helper', '/fixture/sensor-helper', '/fixture']);
  assert.deepEqual(steps.map((s: any) => s.args), [['ci'], ['ci'], ['run', 'build'], ['ci'], ['run', 'build'], ['run', 'build']]);
  const report = inspectApp('/fixture', { platform: 'darwin', arch: 'arm64', version: '22.12.0', exists: () => false });
  assert.equal(report.nativePlatform, false); assert.equal(report.studioBuilt, false); assert.equal(report.agentConfigPresent, false);
  assert.match(reportLines(report).join('\n'), /does not establish/);
  for (const v of ['22.12.0', '24.1.0']) assert.equal(supportsNode(v), true);
  for (const v of ['20.19.0', '22.11.0']) assert.equal(supportsNode(v), false);
});
test('startup distinguishes the studio, a foreign service and blocked/offline networking', async () => {
  const reply = (text: string, ok = true) => async () => ({ ok, text: async () => text });
  assert.equal(await probeStudio(undefined, reply('<title>Projection Mapper — Spatial Studio</title>')), 'running');
  assert.equal(await probeStudio(undefined, reply('<title>Something else</title>')), 'occupied');
  assert.equal(await probeStudio(undefined, reply('<title>Projection Mapper</title>', false)), 'occupied');
  assert.equal(await probeStudio(undefined, async () => { throw { cause: { code: 'EPERM' } }; }), 'blocked');
  assert.equal(await probeStudio(undefined, async () => { throw { cause: { code: 'ECONNREFUSED' } }; }), 'offline');
});
test('one-click handoff sets up only incomplete stopped installs and preserves running studios', () => {
  const ready = inspectApp('/fixture', { platform: 'win32', arch: 'x64', version: '22.23.3', exists: () => true });
  const empty = inspectApp('/fixture', { platform: 'win32', arch: 'x64', version: '22.23.3', exists: () => false });
  assert.deepEqual(windowsStartActions(empty, 'offline'), ['setup', 'preview']);
  assert.deepEqual(windowsStartActions(ready, 'offline'), ['preview']);
  assert.deepEqual(windowsStartActions(empty, 'running'), ['preview']);
  for (const missing of ['mediaInstalled', 'agentDependencies', 'helperDependencies', 'agentBuilt', 'studioBuilt']) {
    assert.deepEqual(windowsStartActions({ ...ready, [missing]: false }, 'offline'), ['setup', 'preview']);
  }
  // Credentials are not a reason to reinstall or overwrite local settings.
  assert.deepEqual(windowsStartActions({ ...ready, agentConfigPresent: false }, 'offline'), ['preview']);
  assert.throws(() => windowsStartActions(empty, 'occupied'), /Nothing was stopped/);
  assert.throws(() => windowsStartActions(empty, 'blocked'), /blocked/);
  assert.throws(() => windowsStartActions({ ...ready, nodeSupported: false }, 'offline'), /22.12/);
});
test('process runner uses argument arrays and reports launch errors and failed exits', async () => {
  let invocation: unknown;
  const success = (command: string, args: string[], options: any) => { invocation = { command, args, options }; const child = new EventEmitter(); queueMicrotask(() => child.emit('exit', 0)); return child; };
  await runProcess('node', ['C:\\Path & Files\\npm-cli.js', 'ci'], '/fixture', success);
  assert.deepEqual(invocation, { command: 'node', args: ['C:\\Path & Files\\npm-cli.js', 'ci'], options: { cwd: '/fixture', stdio: 'inherit', shell: false } });
  await assert.rejects(runProcess('node', [], '/fixture', () => { const child = new EventEmitter(); queueMicrotask(() => child.emit('error', new Error('not found'))); return child; }), /not found/);
  await assert.rejects(runProcess('node', [], '/fixture', () => { const child = new EventEmitter(); queueMicrotask(() => child.emit('exit', 1)); return child; }), /Command failed/);
});
