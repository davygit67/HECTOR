import { useEffect, useRef, useState, type ReactNode } from 'react';
import { PATTERN_CHANNEL, paintPattern } from './patternOutput';
import { validatePattern, type CalibrationPattern } from './shared/calibrationPatterns';

/** A temporary raw-raster override. The scene remains mounted underneath and is never edited. */
export function PatternOutput({ children }: { children: ReactNode }) {
  const canvas = useRef<HTMLCanvasElement>(null), [pattern, setPattern] = useState<CalibrationPattern | null>(null);
  useEffect(() => {
    const outputId = crypto.randomUUID(), channel = new BroadcastChannel(PATTERN_CHANNEL);
    let ownerId: string | null = null, patternId: string | null = null, leaseUntil = 0, generation = 0, disposed = false;
    const metrics = () => ({ width: innerWidth, height: innerHeight, devicePixelRatio });
    const status = () => { if (!disposed) channel.postMessage({ type: 'status', outputId, visible: document.visibilityState === 'visible', activeOwner: ownerId, patternId, fullscreen: !!document.fullscreenElement, ...metrics() }); };
    const clear = () => { generation++; ownerId = null; patternId = null; leaseUntil = 0; setPattern(null); status(); };
    const geometryChanged = () => { clear(); status(); };
    const afterPaint = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    channel.onmessage = async ({ data }) => {
      if (!data || typeof data !== 'object') return;
      if (data.type === 'discover') { status(); return; }
      if (data.outputId !== outputId) return;
      if (data.type === 'lease' && data.ownerId === ownerId) { leaseUntil = Date.now() + 3000; return; }
      if (data.type === 'clear' && data.ownerId === ownerId) { clear(); return; }
      if (data.type !== 'present' || typeof data.ownerId !== 'string' || typeof data.requestId !== 'string') return;
      const fail = (message: string) => channel.postMessage({ type: 'error', outputId, ownerId: data.ownerId, requestId: data.requestId, message });
      try {
        validatePattern(data.pattern);
        if (document.visibilityState !== 'visible') throw new Error('The projection output must stay visible.');
        if (ownerId && ownerId !== data.ownerId && leaseUntil > Date.now()) throw new Error('Another studio tab is using the pattern output. Stop that capture first.');
        ownerId = data.ownerId; patternId = data.pattern.id; leaseUntil = Date.now() + 3000;
        const current = ++generation, before = metrics();
        setPattern(data.pattern);
        await afterPaint();
        if (current !== generation || ownerId !== data.ownerId || !canvas.current) return;
        paintPattern(canvas.current, data.pattern);
        await afterPaint();
        if (current !== generation || document.visibilityState !== 'visible' || JSON.stringify(before) !== JSON.stringify(metrics())) { fail('The output changed while presenting the pattern.'); return; }
        const rect = canvas.current.getBoundingClientRect();
        status(); channel.postMessage({ type: 'presented', outputId, ownerId, requestId: data.requestId,
          presentation: { patternId: data.pattern.id, presentedAtMs: Date.now(), outputId, mode: 'output-window', fullscreen: !!document.fullscreenElement, viewport: before, rasterRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } } });
      } catch (error) { fail(error instanceof Error ? error.message : String(error)); }
    };
    const timer = setInterval(() => { if (ownerId && Date.now() > leaseUntil) clear(); status(); }, 750);
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') clear(); };
    window.addEventListener('resize', geometryChanged); document.addEventListener('visibilitychange', geometryChanged); window.addEventListener('keydown', escape);
    status();
    return () => { disposed = true; generation++; clearInterval(timer); channel.close(); window.removeEventListener('resize', geometryChanged); document.removeEventListener('visibilitychange', geometryChanged); window.removeEventListener('keydown', escape); };
  }, []);
  return <>{children}<div className="calibration-output" hidden={!pattern}><canvas ref={canvas} aria-label="Calibration pattern output" style={pattern ? { width: `min(100vw, ${100 * pattern.width / pattern.height}vh)`, height: `min(100vh, ${100 * pattern.height / pattern.width}vw)` } : undefined} /></div></>;
}
