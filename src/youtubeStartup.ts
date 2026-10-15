export interface PlayerAttempt {
  current(): boolean;
  ready(): void;
  fail(message: string): void;
}
interface StartupEnvironment {
  visible(): boolean;
  subscribe(listener: () => void): () => void;
  schedule(callback: () => void): () => void;
}
/** Background tabs may defer iframe navigation. Only time out a visible attempt,
 * retry at most once, and never reload a player which has become ready. */
export function startVisiblePlayer(callbacks: {
  start(attempt: PlayerAttempt): () => void;
  loading(reconnecting: boolean): void;
  waiting(): void;
  failed(message: string): void;
}, env: StartupEnvironment = {
  visible: () => document.visibilityState === 'visible',
  subscribe: listener => { document.addEventListener('visibilitychange', listener); return () => document.removeEventListener('visibilitychange', listener); },
  schedule: callback => { const timer = setTimeout(callback, 20000); return () => clearTimeout(timer); },
}) {
  let disposed = false, settled = false, attempts = 0, generation = 0, suspended = false;
  let cancelTimer = () => {}, releasePlayer = () => {};
  const stopTimer = () => { cancelTimer(); cancelTimer = () => {}; };
  const arm = () => {
    stopTimer();
    if (disposed || settled) return;
    if (!env.visible()) { suspended = true; callbacks.waiting(); return; }
    cancelTimer = env.schedule(() => {
      if (disposed || settled) return;
      if (!env.visible()) { suspended = true; callbacks.waiting(); return; }
      if (attempts < 2) begin();
      else { settled = true; callbacks.failed('YouTube did not finish loading in this window. Retry, or open this studio address in Chrome if it keeps happening.'); }
    });
  };
  const begin = () => {
    stopTimer(); generation++; releasePlayer(); releasePlayer = () => {};
    const token = generation;
    settled = false; suspended = false; attempts++;
    callbacks.loading(attempts > 1);
    const current = () => !disposed && token === generation;
    arm();
    releasePlayer = callbacks.start({
      current,
      ready: () => { if (current()) { settled = true; stopTimer(); } },
      fail: message => { if (current()) { settled = true; stopTimer(); callbacks.failed(message); } },
    });
  };
  const visibilityChanged = () => {
    if (disposed || settled) return;
    if (!env.visible()) { stopTimer(); suspended = true; callbacks.waiting(); }
    else if (!attempts || suspended && attempts < 2) begin();
    else { callbacks.loading(attempts > 1); arm(); }
  };
  const unsubscribe = env.subscribe(visibilityChanged);
  visibilityChanged();
  return () => { disposed = true; generation++; stopTimer(); unsubscribe(); releasePlayer(); };
}
