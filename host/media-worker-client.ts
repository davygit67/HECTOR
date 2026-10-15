import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

export function mediaWorkerEnvironment(environment: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform) {
  const env: NodeJS.ProcessEnv = { ...environment, PM_MEDIA_SOFTWARE: environment.PM_MEDIA_SOFTWARE ?? (platform === 'win32' ? '1' : '0') };
  delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
  return env;
}
export class MediaWorkerClient {
  private child: ChildProcessWithoutNullStreams;
  private pending = new Map<string, { resolve(value: any): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  private ready: Promise<void>;
  private failed = false;
  constructor(root: string, room: string, emit: (event: any) => void, unavailable: (message: string) => void) {
    const executable = createRequire(import.meta.url)('electron') as string;
    const directory = join(root, '.local-data', 'web-media', room); mkdirSync(directory, { recursive: true });
    const log = join(directory, 'renderer.log');
    const diagnostic = (message: string) => { try { appendFileSync(log, message.slice(0, 2000) + '\n'); } catch {} };
    try { writeFileSync(log, `Video renderer ${process.platform}/${process.arch} startup\n`); } catch {}
    let diagnosticBytes = 0;
    this.child = spawn(executable, [join(root, 'dist-electron/electron/media-worker.js')], {
      cwd: root, windowsHide: true, env: { ...mediaWorkerEnvironment(process.env), PM_MEDIA_DATA: directory }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child.stderr.on('data', data => { if (diagnosticBytes < 64000) { diagnosticBytes += data.length; diagnostic(String(data)); } });
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.failed = true; this.child.kill(); reject(new Error('Video renderer did not start. Reload the studio.')); }, 20000);
      const lines = createInterface({ input: this.child.stdout });
      lines.on('line', line => {
        if (!line.startsWith('PM_MEDIA:')) return;
        try {
          const message = JSON.parse(line.slice(9));
          if (message.ready) { clearTimeout(timer); resolve(); }
          else if (message.event) emit(message.event);
          else if (message.fatal) { clearTimeout(timer); reject(new Error(message.fatal)); unavailable(message.fatal); }
          else if (message.id) {
            const request = this.pending.get(message.id); if (!request) return;
            clearTimeout(request.timer); this.pending.delete(message.id);
            if (message.error) request.reject(new Error(message.error)); else request.resolve(message.value);
          }
        } catch { /* Ignore process diagnostics, never expose them as page code. */ }
      });
      const stopped = (cause?: unknown) => {
        diagnostic('Stopped: ' + String(cause ?? this.child.exitCode));
        this.failed = true;
        clearTimeout(timer); const error = new Error('Video renderer stopped. Reload the studio to reconnect.'); reject(error);
        for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(error); } this.pending.clear(); unavailable(error.message);
      };
      this.child.once('error', stopped); this.child.once('exit', stopped);
    });
    void this.ready.catch(() => {});
  }
  get running() { return !this.failed && this.child.exitCode === null && !this.child.killed; }
  async request(action: 'sync' | 'command' | 'input' | 'snapshot', value?: unknown): Promise<any> {
    await this.ready;
    if (this.child.exitCode !== null || this.child.killed) throw new Error('Video renderer is not running. Reload the studio.');
    return new Promise((resolve, reject) => {
      const id = randomUUID(), timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Video renderer did not reply.')); }, 12000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, action, value }) + '\n', error => { if (error) { clearTimeout(timer); this.pending.delete(id); reject(error); } });
    });
  }
  close() { this.child.stdin.end(); const timeout = setTimeout(() => this.child.kill(), 1500); timeout.unref(); }
}
