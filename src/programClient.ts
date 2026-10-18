import type { ProgramContext, ProgramDefinition, ProgramReport } from './shared/program';
import type { ProgramFrame } from './programEngine';
export class ProgramWorker {
  private worker = new Worker(new URL('./program.worker.ts', import.meta.url), { type: 'module' });
  private serial = 0;
  private pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  constructor() {
    this.worker.onmessage = ({ data }) => { const p = this.pending.get(data.id); if (!p) return; clearTimeout(p.timer); this.pending.delete(data.id); data.error ? p.reject(new Error(data.error)) : p.resolve(data.value); };
    this.worker.onerror = () => this.dispose('Program worker failed to load or stopped unexpectedly.');
  }
  private call<T>(message: object, timeout: number): Promise<T> {
    const id = ++this.serial;
    return new Promise((resolve, reject) => { const timer = setTimeout(() => this.dispose('Program exceeded its worker time budget.'), timeout); this.pending.set(id, { resolve: value => resolve(value as T), reject, timer }); this.worker.postMessage({ id, ...message }); });
  }
  test(definition: ProgramDefinition, ctx: ProgramContext) { return this.call<ProgramReport>({ action: 'test', definition, ctx }, 7000); }
  init(definition: ProgramDefinition, ctx: ProgramContext, restore?: unknown) { return this.call<ProgramFrame>({ action: 'init', definition, ctx, restore }, 5000); }
  frame(ctx: ProgramContext, update: boolean) { return this.call<ProgramFrame>({ action: 'frame', ctx, update }, 1000); }
  dispose(message = 'Program stopped.') { this.worker.terminate(); for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error(message)); } this.pending.clear(); }
}
