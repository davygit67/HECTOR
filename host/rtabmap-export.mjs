import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';

export const RTABMAP = Object.freeze({ version: '0.23.8', commit: 'd069becc724905d6465a8758c40dae88e13bb9e8', repository: 'https://github.com/introlab/rtabmap.git' });
/** Flags checked against the pinned upstream tools/Export/main.cpp. No shell interpolation. */
export function exportArguments(database, outputDirectory) {
  return ['--cloud', '--opt', '2', '--voxel', '0.02', '--decimation', '4', '--max_range', '4', '--output', 'room', '--output_dir', outputDirectory, database];
}
export async function exportRoom({ executable, database, destination, run = spawn }) {
  database = path.resolve(database); executable = path.resolve(executable);
  if (path.extname(database).toLowerCase() !== '.db' || !(await stat(database)).isFile()) throw new Error('Choose the saved RTAB-Map .db file.');
  if (!(await stat(executable)).isFile()) throw new Error('Choose the installed rtabmap-export executable.');
  await mkdir(destination, { recursive: true });
  const directory = await mkdtemp(path.join(destination, 'scan-'));
  await new Promise((resolve, reject) => {
    const child = run(executable, exportArguments(database, directory), { shell: false, stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true });
    child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`RTAB-Map export failed (${code}). See its output above.`)));
  });
  const file = path.join(directory, 'room_cloud.ply');
  if (!(await stat(file)).isFile()) throw new Error(`No cloud was exported. Inspect ${directory}.`);
  return file;
}
async function main() {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const clean = value => value.trim().replace(/^"(.*)"$/, '$1');
  try {
    const database = clean(process.argv[2] || await prompt.question('Path to your saved RTAB-Map .db: '));
    const executable = clean(process.argv[3] || await prompt.question('Path to RTABMap/bin/rtabmap-export.exe: '));
    const root = fileURLToPath(new URL('../', import.meta.url));
    const file = await exportRoom({ executable, database, destination: path.join(root, '.local-data', 'rtabmap-exports') });
    console.log(`\nOpen Studio → Hardware → Import room scan and choose:\n${file}\nThe scan is local and not projector-calibrated.`);
  } finally { prompt.close(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
