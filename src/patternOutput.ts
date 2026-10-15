import type { CalibrationPattern } from './shared/calibrationPatterns';
import type { PatternPresentation } from './shared/sensor';
import { checkAbort } from './shared/sensorStream';

export const PATTERN_CHANNEL = 'projection-mapper.pattern-output.v1';
export interface PatternOutputStatus {
  outputId: string; visible: boolean; width: number; height: number; devicePixelRatio: number; atMs: number;
  activeOwner: string | null; patternId: string | null;
}
export class PatternOutputClient {
  readonly ownerId = crypto.randomUUID();
  readonly outputs = new Map<string, PatternOutputStatus>();
  private channel = new BroadcastChannel(PATTERN_CHANNEL);
  private pending = new Map<string, { outputId: string; resolve: (value: PatternPresentation) => void; reject: (error: Error) => void }>();
  private activeOutput: string | null = null;
  private timer: ReturnType<typeof setInterval>;
  constructor(private changed: () => void) {
    this.channel.onmessage = ({ data }) => {
      if (!data || typeof data !== 'object') return;
      if (data.type === 'status' && typeof data.outputId === 'string' && Number.isFinite(data.width) && Number.isFinite(data.height) && Number.isFinite(data.devicePixelRatio)) {
        this.outputs.set(data.outputId, { ...data, atMs: Date.now() }); this.changed();
      }
      if (data.ownerId !== this.ownerId) return;
      const pending = this.pending.get(data.requestId);
      if (!pending || pending.outputId !== data.outputId) return;
      if (data.type === 'presented') pending.resolve(data.presentation);
      if (data.type === 'error') pending.reject(new Error(String(data.message).slice(0, 300)));
    };
    this.channel.postMessage({ type: 'discover' });
    this.timer = setInterval(() => {
      for (const [id, status] of this.outputs) if (Date.now() - status.atMs > 3500) { this.outputs.delete(id); this.changed(); }
      if (this.activeOutput) this.channel.postMessage({ type: 'lease', ownerId: this.ownerId, outputId: this.activeOutput });
    }, 750);
  }
  present(pattern: CalibrationPattern, outputId: string, signal: AbortSignal): Promise<PatternPresentation> {
    checkAbort(signal);
    if (!this.outputs.get(outputId)?.visible) return Promise.reject(new Error('Open the projection output and keep it visible before capturing.'));
    this.activeOutput = outputId;
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const cleanup = () => { clearTimeout(timer); this.pending.delete(requestId); signal.removeEventListener('abort', aborted); };
      const fail = (error: Error) => { cleanup(); reject(error); };
      const aborted = () => fail(new Error('Capture cancelled.'));
      const timer = setTimeout(() => fail(new Error('The output did not display this pattern in time. Keep its window visible, then retry.')), 5000);
      this.pending.set(requestId, { outputId, resolve: value => { cleanup(); resolve(value); }, reject: fail });
      signal.addEventListener('abort', aborted, { once: true });
      this.channel.postMessage({ type: 'present', requestId, ownerId: this.ownerId, outputId, pattern });
    });
  }
  verify(presentation: PatternPresentation) {
    if (presentation.mode !== 'output-window') return;
    const state = this.outputs.get(presentation.outputId);
    if (!state || !state.visible || state.activeOwner !== this.ownerId || state.patternId !== presentation.patternId || Date.now() - state.atMs > 3000 || state.width !== presentation.viewport.width || state.height !== presentation.viewport.height || state.devicePixelRatio !== presentation.viewport.devicePixelRatio) {
      throw new Error('The projection output was hidden, disconnected or resized. Keep it fixed, then retry.');
    }
  }
  clear() {
    this.channel.postMessage({ type: 'clear', ownerId: this.ownerId, outputId: this.activeOutput }); this.activeOutput = null;
  }
  dispose() {
    this.clear(); clearInterval(this.timer);
    for (const pending of this.pending.values()) pending.reject(new Error('Hardware setup closed.'));
    this.pending.clear(); this.channel.close();
  }
}

/** Pixel-exact source raster; any output-window scaling is recorded in presentation metadata. */
export function paintPattern(canvas: HTMLCanvasElement, pattern: CalibrationPattern) {
  canvas.width = pattern.width; canvas.height = pattern.height;
  const ctx = canvas.getContext('2d', { alpha: false }); if (!ctx) throw new Error('Pattern canvas unavailable.');
  ctx.fillStyle = pattern.kind === 'white' ? '#fff' : pattern.kind === 'grid' ? '#101010' : '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (pattern.kind === 'gray') {
    ctx.fillStyle = '#fff';
    const extent = pattern.axis === 'x' ? pattern.width : pattern.height;
    let start = -1;
    for (let c = 0; c <= extent; c++) {
      const on = c < extent && (((((c ^ (c >>> 1)) >>> pattern.bit!) & 1) !== 0) !== pattern.inverted);
      if (on && start < 0) start = c;
      if (!on && start >= 0) { if (pattern.axis === 'x') ctx.fillRect(start, 0, c - start, canvas.height); else ctx.fillRect(0, start, canvas.width, c - start); start = -1; }
    }
  }
  if (pattern.kind === 'grid') {
    ctx.fillStyle = '#fff'; const thickness = Math.max(1, Math.round(pattern.width / 640));
    for (let x = 0; x < canvas.width; x += Math.max(1, Math.round(canvas.width / 16))) ctx.fillRect(x, 0, thickness, canvas.height);
    for (let y = 0; y < canvas.height; y += Math.max(1, Math.round(canvas.height / 9))) ctx.fillRect(0, y, canvas.width, thickness);
    ctx.fillRect(canvas.width - thickness, 0, thickness, canvas.height); ctx.fillRect(0, canvas.height - thickness, canvas.width, thickness);
  }
}
