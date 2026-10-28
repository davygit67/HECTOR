// Stable stdio entry point for tunnel-client and other MCP clients, from any cwd.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { spawn } from 'node:child_process';

const root = dirname(fileURLToPath(import.meta.url));
try {
  const file = resolve(process.argv[2] || resolve(root, '.env'));
  let settings = {};
  try { settings = parseEnv(readFileSync(file, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }

  // The proxy needs its submit credential, never the model or tunnel API key.
  const env = {};
  for (const name of ['PATH', 'SystemRoot', 'WINDIR', 'TMP', 'TEMP', 'TMPDIR']) {
    if (process.env[name] !== undefined) env[name] = process.env[name];
  }
  for (const name of ['PROJECTION_RELAY_URL', 'PROJECTION_RELAY_SUBMIT_TOKEN']) {
    if (process.env[name] !== undefined || settings[name] !== undefined) {
      env[name] = process.env[name] ?? settings[name];
    }
  }
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/relay/stdio.ts'], {
    cwd: root, env, stdio: 'inherit', windowsHide: true,
  });
  const interrupt = () => child.kill('SIGINT');
  const terminate = () => child.kill('SIGTERM');
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', terminate);
  child.once('error', () => {
    console.error('Projection MCP proxy could not launch. Check Node and agent dependencies.');
    process.exitCode = 1;
  });
  child.once('exit', (code, signal) => {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', terminate);
    process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 143);
  });
} catch {
  console.error('Projection MCP settings could not be read. Check the private environment file.');
  process.exitCode = 1;
}
