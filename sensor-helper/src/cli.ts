import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { demoSource, readRecording, replaySource } from './sources.js';
import { nativeSource } from './native.js';
import { allowedOrigin, startBridge } from './server.js';
import type { Mode } from './types.js';

async function main() {
  const { values } = parseArgs({ options: {
    mode: { type: 'string', default: 'live' }, file: { type: 'string' }, port: { type: 'string', default: '5174' },
    speed: { type: 'string', default: '1' }, origin: { type: 'string', multiple: true },
    check: { type: 'boolean' }, help: { type: 'boolean' },
  } });
  if (values.help) {
    console.log('Projection Mapper sensor helper\n  --mode live|demo|replay  (default: live)\n  --file recording.pmsession (replay only)\n  --speed 0.25..4 (replay only)\n  --port 5174\n  --origin http://127.0.0.1:5173 (repeat for alternate local app origins)\n  --check (read-only platform/build check)\nCtrl+C stops the helper and its native child.'); return;
  }
  const executable = fileURLToPath(new URL('../native/bin/KinectCapture.exe', import.meta.url));
  if (values.check) {
    console.log(JSON.stringify({ platform: process.platform, architecture: process.arch, node: process.version,
      nativeBuilt: existsSync(executable), liveSupportedPlatform: process.platform === 'win32' && process.arch === 'x64',
      nativePath: executable, hardwareVerified: false,
      next: process.platform === 'win32' ? 'Run Check Windows.cmd, then sensor-helper/scripts/Start-Kinect.ps1. A connected device must still pass the Kinect Configuration Verifier.' : 'Use demo/replay here. Build and run the native Kinect adapter on Windows x64.' }, null, 2)); return;
  }
  const mode = values.mode as Mode, port = Number(values.port), speed = Number(values.speed);
  if (!['live', 'demo', 'replay'].includes(mode)) throw new Error('Mode must be live, demo, or replay.');
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Port must be an integer from 1024 to 65535.');
  if (values.file && mode !== 'replay') throw new Error('--file is only supported in replay mode.');
  if (values.origin?.some(origin => !allowedOrigin(origin, [origin]))) throw new Error('Origins must be exact local HTTP(S) origins.');
  const source = mode === 'demo' ? demoSource : mode === 'live' ? nativeSource(executable) :
    values.file ? replaySource(await readRecording(resolve(values.file)), speed) : (() => { throw new Error('Replay requires --file recording.pmsession.'); })();
  let previous = '';
  const bridge = await startBridge({ mode, source, port, origins: values.origin, onStatus: status => {
    const text = `${status.state}: ${status.message}`; if (text !== previous) { console.log(text); previous = text; }
  } });
  console.log(`Sensor helper (${mode}) listening at ws://127.0.0.1:${bridge.port}. Open Hardware setup in Projection Mapper and connect the local bridge.`);
  const stop = async () => { await bridge.stop(); process.exitCode = 0; };
  process.once('SIGINT', () => void stop()); process.once('SIGTERM', () => void stop());
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
