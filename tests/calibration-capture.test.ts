import test from 'node:test';
import assert from 'node:assert/strict';
import { patternSequence, patternValue } from '../src/shared/calibrationPatterns.ts';
import { capturePatterns, type CaptureOptions } from '../src/shared/calibrationCapture.ts';
import { decodeSensorSession, encodeSensorSession, validateSession } from '../src/shared/sensor.ts';
import { syntheticFrame } from '../src/shared/syntheticSensor.ts';
import { SensorInbox } from '../src/shared/sensorStream.ts';

test('1080p Gray-code sequence includes reference images and invertible x/y pairs for every pixel', () => {
  const patterns = patternSequence(1920, 1080); assert.equal(patterns.length, 46);
  assert.deepEqual(patterns.slice(0, 2).map(p => p.kind), ['white', 'black']);
  for (const axis of ['x', 'y'] as const) {
    const normal = patterns.filter(p => p.axis === axis && !p.inverted);
    for (let coordinate = 0; coordinate < (axis === 'x' ? 1920 : 1080); coordinate++) {
      let gray = 0;
      for (const p of normal) {
        const value = patternValue(p, axis === 'x' ? coordinate : 0, axis === 'y' ? coordinate : 0);
        const inverse = patterns.find(other => other.axis === axis && other.bit === p.bit && other.inverted)!;
        assert.equal(value + patternValue(inverse, axis === 'x' ? coordinate : 0, axis === 'y' ? coordinate : 0), 255);
        gray = (gray << 1) | (value ? 1 : 0);
      }
      let binary = gray; for (let shifted = gray >>> 1; shifted; shifted >>>= 1) binary ^= shifted;
      assert.equal(binary, coordinate);
    }
  }
});
function fixture() {
  let clock = 1000, sequence = 0, cleared = 0;
  const controller = new AbortController(), inbox = new SensorInbox();
  const options: CaptureOptions = { id: 'capture-test', name: 'Fixture capture', patterns: patternSequence(640, 480, 'checks'), settleMs: 300, provenance: 'synthetic', signal: controller.signal, inbox,
    now: () => clock, progress: () => {}, clear: () => { cleared++; },
    present: async pattern => ({ patternId: pattern.id, presentedAtMs: clock, outputId: 'fixture-projector', mode: 'synthetic', viewport: { width: 640, height: 480, devicePixelRatio: 1 }, rasterRect: { x: 0, y: 0, width: 640, height: 480 } }),
    wait: async ms => { clock += ms; inbox.push(syntheticFrame(sequence++, clock), clock); },
  };
  return { options, controller, inbox, cleared: () => cleared };
}
test('each observation is paired with its acknowledged pattern, settling time and fresh frame', async () => {
  const f = fixture(), phases: string[] = []; f.options.progress = p => phases.push(p.phase);
  const session = await capturePatterns(f.options);
  assert.equal(session.status, 'complete'); assert.equal(session.frames.length, 3); assert.equal(f.cleared(), 1);
  assert.deepEqual(phases, ['presenting', 'settling', 'capturing', 'presenting', 'settling', 'capturing', 'presenting', 'settling', 'capturing']);
  assert.deepEqual(decodeSensorSession(encodeSensorSession(session)), session);
  for (const c of session.captures) assert.ok(session.frames[c.frameIndex].capturedAtMs >= c.presentation.presentedAtMs + c.settleMs);
});
test('cancellation retains completed observations, restores output and supports a clean retry', async () => {
  const f = fixture(), present = f.options.present;
  f.options.present = async (p, signal) => { const shown = await present(p, signal); if (p.id === 'black') f.controller.abort(); return shown; };
  const cancelled = await capturePatterns(f.options);
  assert.equal(cancelled.status, 'cancelled'); assert.equal(cancelled.frames.length, 1); assert.equal(f.cleared(), 1); validateSession(cancelled);
  const retry = await capturePatterns(fixture().options); assert.equal(retry.status, 'complete'); assert.equal(retry.frames.length, 3);
});
test('wrong acknowledgements, resized outputs and lost output leases cannot complete a capture', async () => {
  const wrong = fixture(), present = wrong.options.present;
  wrong.options.present = async (p, s) => ({ ...await present(p, s), patternId: 'wrong' });
  assert.equal((await capturePatterns(wrong.options)).status, 'failed'); assert.equal(wrong.cleared(), 1);
  const resized = fixture(), initial = resized.options.present;
  resized.options.present = async (p, s) => ({ ...await initial(p, s), viewport: { width: p.id === 'black' ? 800 : 640, height: 480, devicePixelRatio: 1 } });
  const result = await capturePatterns(resized.options); assert.equal(result.frames.length, 1); assert.equal(result.status, 'failed'); assert.match(result.message, /window changed/);
  const lost = fixture(); lost.options.verify = () => { throw new Error('Output disconnected'); };
  const failed = await capturePatterns(lost.options); assert.equal(failed.frames.length, 0); assert.match(failed.message, /disconnected/);
});
test('recording importer refuses swapped or stale pattern/frame associations', async () => {
  const session = await capturePatterns(fixture().options); session.captures[0].presentation.presentedAtMs += 1000;
  assert.throws(() => validateSession(session), /predates/);
  const swapped = await capturePatterns(fixture().options); swapped.captures.reverse(); assert.throws(() => validateSession(swapped), /metadata/);
});
test('real sensor acquisition cannot use a synthetic presentation acknowledgement', async () => {
  const f = fixture(); f.options.provenance = 'sensor';
  const result = await capturePatterns(f.options); assert.equal(result.status, 'failed'); assert.equal(result.frames.length, 0);
});
test('a sensor loss and recovery during settling cannot silently complete calibration', async () => {
  const f = fixture(), wait = f.options.wait!;
  f.options.wait = async (ms, signal) => { f.inbox.reset('USB disconnected.'); await wait(ms, signal); };
  const result = await capturePatterns(f.options);
  assert.equal(result.status, 'failed'); assert.equal(result.frames.length, 0); assert.match(result.message, /connection changed/); assert.equal(f.cleared(), 1);
});
