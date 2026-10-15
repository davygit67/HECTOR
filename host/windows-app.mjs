import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { inspectApp, npmCommand, probeStudio, reportLines, runProcess, setupSteps, supportsNode, windowsStartActions } from './app-environment.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const action = process.argv[2] ?? 'check';
try {
  if (!['start', 'setup', 'check', 'preview', 'desktop'].includes(action)) throw new Error('Choose start, setup, check, preview or desktop.');
  if (action === 'check') {
    console.log(reportLines(inspectApp(root)).join('\n'));
    console.log('Local studio: ' + await probeStudio());
    console.log('For helper prerequisites run: node sensor-helper/dist/cli.js --check');
  } else {
    if (process.platform !== 'win32') throw new Error('This launcher targets Windows. Use Launch Preview.command on Mac.');
    if (!supportsNode(process.versions.node)) throw new Error('Node.js 22.12 or newer is required.');
    const npm = npmCommand();
    if (action === 'start') {
      const actions = windowsStartActions(inspectApp(root), await probeStudio());
      for (const next of actions) {
        if (next === 'setup') console.log('First launch: downloading and preparing the app. Keep this window open. Existing API settings will be preserved.');
        await runProcess(process.execPath, [join(root, 'host', 'windows-app.mjs'), next], root);
      }
    } else if (action === 'setup') {
      const studio = await probeStudio();
      if (studio !== 'offline') throw new Error('Close your running studio before setup. Dependencies and renderer builds must not be replaced while it is using them.');
      for (const step of setupSteps(root)) { console.log('\n' + step.label + '…'); await runProcess(npm.command, [...npm.prefix, ...step.args], step.cwd); }
      console.log('\nSoftware setup complete. API settings are unchanged.\nRun sensor-helper/scripts/Build-Kinect.ps1 to build the native Kinect reader with the installed Microsoft SDK.\nThen run Launch Preview.cmd and start the helper separately.');
    } else if (action === 'preview') {
      await runProcess(process.execPath, [join(root, 'host', 'start-preview.mjs')], root);
    } else {
      await runProcess(npm.command, [...npm.prefix, 'start'], root);
    }
  }
} catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
