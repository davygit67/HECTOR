import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
await build({ absWorkingDir: root, entryPoints: ['electron/main.ts', 'electron/preload.ts', 'electron/youtube-preload.ts'].map(p => fileURLToPath(new URL('../' + p, import.meta.url))), bundle: true, platform: 'node', target: 'node22', format: 'cjs', outdir: 'dist-electron', outExtension: { '.js': '.cjs' }, external: ['electron'] });
