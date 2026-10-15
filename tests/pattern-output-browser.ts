import { PatternOutputClient } from '../src/patternOutput';
import { capturePatterns } from '../src/shared/calibrationCapture';
import { patternSequence, patternValue, type CalibrationPattern } from '../src/shared/calibrationPatterns';
import { SensorInbox } from '../src/shared/sensorStream';
import { demoSensor } from '../src/sensorSources';
import { decodeSensorSession, encodeSensorSession } from '../src/shared/sensor';

const results = document.getElementById('results')!, button = document.getElementById('run') as HTMLButtonElement;
const frame = document.querySelector('iframe')!, client = new PatternOutputClient(() => {});
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
button.onclick = async () => {
  button.disabled = true; results.textContent = 'Checking…';
  let active: CalibrationPattern | null = null;
  const inbox = new SensorInbox(), source = demoSensor(inbox, () => active);
  const checks: Record<string, unknown> = {};
  try {
    const output = [...client.outputs.values()].find(item => item.visible && item.width === 640 && item.height === 400);
    assert(output, 'Fixture output was not discovered.');
    const target = output!.outputId, doc = frame.contentDocument!;
    const original = doc.getElementById('original-scene');
    for (const pattern of patternSequence(640, 480)) {
      active = pattern;
      const presentation = await client.present(pattern, target, new AbortController().signal);
      client.verify(presentation);
      const canvas = doc.querySelector('canvas')!, pixels = canvas.getContext('2d')!.getImageData(0, 0, 640, 480).data;
      for (let y = 0; y < 480; y += 13) for (let x = 0; x < 640; x += 11) assert(pixels[(y * 640 + x) * 4] === patternValue(pattern, x, y), 'Displayed raster differs from pattern data.');
      assert(Math.abs(presentation.rasterRect.width / presentation.rasterRect.height - 4 / 3) < .001, 'Raster aspect ratio changed.');
    }
    checks.exactDisplayedRasters = true;
    const run = (abort: AbortController, cancelAfterOne = false) => capturePatterns({ id: crypto.randomUUID(), name: 'Output fixture', patterns: patternSequence(640, 480, 'checks'), settleMs: 150, provenance: 'synthetic', inbox, signal: abort.signal,
      present: (pattern, signal) => { active = pattern; return client.present(pattern, target, signal); }, verify: value => client.verify(value),
      clear: () => { active = null; client.clear(); }, progress: value => { if (cancelAfterOne && value.index === 1) abort.abort(); } });
    const complete = await run(new AbortController());
    assert(complete.status === 'complete' && complete.frames.length === 3, complete.message || 'Capture failed.');
    assert(decodeSensorSession(encodeSensorSession(complete)).captures.every(c => c.presentation.mode === 'output-window'), 'Output metadata lost.');
    checks.outputCapture = true;
    const cancelled = await run(new AbortController(), true);
    assert(cancelled.status === 'cancelled' && cancelled.frames.length === 1, 'Cancellation did not retain exactly one observation.');
    await pause(100);
    assert(doc.querySelector('.calibration-output')?.hasAttribute('hidden') && doc.getElementById('original-scene') === original, 'Cancellation did not restore the original mounted content.');
    checks.cancelRestoresContent = true;
    const retry = await run(new AbortController()); assert(retry.status === 'complete', retry.message); checks.retry = true;
    const presentation = await client.present(patternSequence(640, 480)[0], target, new AbortController().signal);
    frame.style.width = '620px'; await pause(300);
    let resizeRejected = false; try { client.verify(presentation); } catch { resizeRejected = true; }
    assert(resizeRejected && doc.querySelector('.calibration-output')?.hasAttribute('hidden'), 'Resizing did not invalidate and clear the pattern.'); checks.resizeGuard = true;
    results.textContent = JSON.stringify({ passed: true, ...checks }, null, 2);
  } catch (error) { results.textContent = JSON.stringify({ passed: false, ...checks, error: String(error) }, null, 2); }
  finally { active = null; source.stop(); client.clear(); frame.style.width = '640px'; button.disabled = false; }
};
window.addEventListener('pagehide', () => client.dispose(), { once: true });
