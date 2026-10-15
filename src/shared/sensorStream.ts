import { validateFrame, type SensorFrame } from './sensor.js';

export function abortError() { return new Error('Capture cancelled.'); }
export function checkAbort(signal: AbortSignal) { if (signal.aborted) throw abortError(); }
export function delay(ms: number, signal: AbortSignal): Promise<void> {
  checkAbort(signal);
  return new Promise((resolve, reject) => {
    const aborted = () => { clearTimeout(timer); signal.removeEventListener('abort', aborted); reject(abortError()); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', aborted); resolve(); }, ms);
    signal.addEventListener('abort', aborted, { once: true });
  });
}
/** Holds only the newest frame. Capture consumers never drain a delayed frame queue. */
export class SensorInbox {
  latest: { frame: SensorFrame; receivedAtMs: number } | null = null;
  generation = 0;
  private listeners = new Set<(entry: NonNullable<SensorInbox['latest']>) => void>();
  private failureListeners = new Set<(error: Error) => void>();
  private device = '';
  push(frame: SensorFrame, receivedAtMs = Date.now()) {
    validateFrame(frame);
    const descriptor = JSON.stringify(frame.device);
    if (this.device && this.device !== descriptor) throw new Error('Sensor mode changed. Reconnect before recording.');
    if (this.latest && (frame.sequence <= this.latest.frame.sequence || frame.capturedAtMs < this.latest.frame.capturedAtMs)) throw new Error('The sensor sent an out-of-order frame. Reconnect to start a new session.');
    if (frame.capturedAtMs > receivedAtMs + frame.clockUncertaintyMs + 1000) throw new Error('Sensor clock is ahead of this computer. Check bridge clock synchronization.');
    this.device = descriptor; this.latest = { frame, receivedAtMs };
    this.listeners.forEach(listener => listener(this.latest!));
  }
  subscribe(listener: (entry: NonNullable<SensorInbox['latest']>) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  reset(reason = 'Sensor disconnected.') {
    this.generation++;
    this.failureListeners.forEach(listener => listener(new Error(reason)));
    this.latest = null; this.device = '';
  }
  waitAfter(captureGateMs: number, signal: AbortSignal, timeoutMs = 5000): Promise<NonNullable<SensorInbox['latest']>> {
    checkAbort(signal);
    return new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); this.listeners.delete(receive); this.failureListeners.delete(fail); signal.removeEventListener('abort', cancel); };
      const fail = (error: Error) => { cleanup(); reject(error); };
      const cancel = () => fail(abortError());
      const receive = (entry: NonNullable<SensorInbox['latest']>) => {
        // Both source exposure time and client receipt must be beyond settling.
        if (entry.frame.capturedAtMs - entry.frame.clockUncertaintyMs - (entry.frame.exposureMs ?? 0) / 2 >= captureGateMs && entry.receivedAtMs >= captureGateMs) { cleanup(); resolve(entry); }
      };
      const timer = setTimeout(() => fail(new Error('No fresh sensor frame arrived after the pattern settled. Check the sensor and retry.')), timeoutMs);
      this.listeners.add(receive); this.failureListeners.add(fail); signal.addEventListener('abort', cancel, { once: true });
      if (this.latest) receive(this.latest);
    });
  }
}

export function localSensorURL(input: string): string {
  let url: URL;
  try { url = new URL(input); } catch { throw new Error('Enter a local sensor bridge address, such as ws://127.0.0.1:5174.'); }
  if (!['ws:', 'wss:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.hash) {
    throw new Error('Sensor connections must use a local bridge on this computer.');
  }
  return url.href;
}
