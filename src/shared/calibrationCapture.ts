import type { CalibrationPattern } from './calibrationPatterns.js';
import { canAppendFrame, copyFrame, type PatternPresentation, type SensorSession } from './sensor.js';
import { checkAbort, delay, type SensorInbox } from './sensorStream.js';

export interface CaptureProgress { phase: 'presenting' | 'settling' | 'capturing'; index: number; total: number; pattern: CalibrationPattern }
export interface CaptureOptions {
  id: string; name: string; patterns: CalibrationPattern[]; settleMs: number; provenance: SensorSession['provenance'];
  inbox: SensorInbox; signal: AbortSignal;
  present(pattern: CalibrationPattern, signal: AbortSignal): Promise<PatternPresentation>;
  clear(): void;
  verify?(presentation: PatternPresentation): void;
  progress(value: CaptureProgress): void;
  now?: () => number;
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
}
/** Acquisition only. An acknowledged browser paint is recorded, not claimed as optical synchronization. */
export async function capturePatterns(options: CaptureOptions): Promise<SensorSession> {
  const { signal, patterns, inbox } = options, now = options.now ?? Date.now;
  const result: SensorSession = { version: 1, id: options.id, name: options.name, createdAtMs: now(), kind: 'pattern-capture',
    provenance: options.provenance, status: 'complete', message: '', frames: [], captures: [], plannedPatterns: structuredClone(patterns) };
  let baselineOutput = '';
  const sourceGeneration = inbox.generation;
  const checkSource = () => { if (inbox.generation !== sourceGeneration) throw new Error('The sensor connection changed during capture. Completed observations were retained; reconnect and retry.'); };
  try {
    if (!patterns.length || patterns.length > 64 || options.settleMs < 100 || options.settleMs > 5000 || !Number.isFinite(options.settleMs)) throw new Error('Choose a valid pattern sequence and settling time.');
    for (let index = 0; index < patterns.length; index++) {
      checkAbort(signal); checkSource();
      const pattern = patterns[index], update = (phase: CaptureProgress['phase']) => options.progress({ phase, index, total: patterns.length, pattern });
      update('presenting');
      const presentation = await options.present(pattern, signal); checkAbort(signal); checkSource();
      if (presentation.patternId !== pattern.id || !Number.isFinite(presentation.presentedAtMs) || presentation.presentedAtMs > now() + 1000 ||
        options.provenance === 'sensor' && presentation.mode !== 'output-window') throw new Error('The correct projection output did not acknowledge this pattern.');
      const outputIdentity = JSON.stringify([presentation.outputId, presentation.mode, presentation.viewport]);
      if (baselineOutput && baselineOutput !== outputIdentity) throw new Error('The output window changed size or display during capture. Retry after positioning it.');
      baselineOutput = outputIdentity;
      const gate = presentation.presentedAtMs + options.settleMs;
      update('settling'); await (options.wait ?? delay)(Math.max(0, gate - now()), signal); checkAbort(signal); checkSource();
      update('capturing'); const entry = await inbox.waitAfter(gate, signal); checkAbort(signal); checkSource();
      options.verify?.(presentation);
      if ((entry.frame.device.kind === 'synthetic') !== (options.provenance === 'synthetic')) throw new Error('Sensor source changed during capture.');
      if (!canAppendFrame(result.frames, entry.frame)) throw new Error('The recording limit was reached. Use a smaller sensor mode or capture fewer patterns.');
      result.captures.push({ frameIndex: result.frames.length, pattern: structuredClone(pattern), presentation, settleMs: options.settleMs, receivedAtMs: entry.receivedAtMs });
      result.frames.push(copyFrame(entry.frame));
    }
  } catch (error) {
    result.status = signal.aborted ? 'cancelled' : 'failed';
    result.message = signal.aborted ? 'Capture cancelled. Completed observations were retained.' : error instanceof Error ? error.message : String(error);
  } finally { options.clear(); }
  return result;
}
