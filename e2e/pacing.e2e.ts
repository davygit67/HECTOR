// Repeatable local-video timing runs (npm run measure). Results go to artifacts/pacing-report.json.
// What this can see: decoder drops, decoded-frame cadence, which frames reached the GPU texture, frame age at upload, and the
// render loop's rAF cadence. What it cannot see: actual scan-out on a projector (no photodiode / external capture).
import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { FrameTrace } from '../src/core/bridge';
import { fullFrame, Hector } from './harness';
import { encodeClip, fixtureDir } from './fixtures';

const runs = Number(process.env.HECTOR_PACING_RUNS ?? 2), seconds = 20, recordMs = 14000, seekAtMs = 6000;
const pct = (values: number[], p: number) => { if (!values.length) return null; const s = [...values].sort((a, b) => a - b); return Number(s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(2)); };
const mean = (values: number[]) => values.length ? Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(2)) : null;

function analyse(trace: FrameTrace, source: string, fps: number) {
  const t0 = trace.start, rel = (t: number) => t - t0;
  const frames = trace.frames.filter(f => f.source === source), uploads = trace.uploads.filter(u => u.source === source);
  const firstFrame = frames.length ? rel(frames[0].now) : 0;
  const seek = trace.events.find(e => e.source === source && e.type.startsWith('seek-to') && rel(e.now) > firstFrame);
  const seekAt = seek ? rel(seek.now) : Infinity;
  const phase = (t: number) => t < firstFrame + 1000 ? 'startup' : t >= seekAt && t < seekAt + 1000 ? 'seek' : 'steady';
  const steady = (t: number) => phase(rel(t)) === 'steady';
  // Decoder drops attributed to the phase in which the counter increased.
  const quality = trace.quality.filter(q => q.source === source), dropped = { startup: 0, seek: 0, steady: 0 };
  for (let i = 1; i < quality.length; i++) dropped[phase(rel(quality[i].now))] += quality[i].dropped - quality[i - 1].dropped;
  const period = 1 / fps;
  // Source cadence: consecutive decoded frames in steady state, excluding loop wraps.
  const deltas: number[] = [];
  for (let i = 1; i < frames.length; i++) if (steady(frames[i].now) && steady(frames[i - 1].now)) { const d = frames[i].mediaTime - frames[i - 1].mediaTime; if (d > 0) deltas.push(d); }
  const skippedSource = deltas.reduce((sum, d) => sum + Math.max(0, Math.round(d / period) - 1), 0);
  const steadyUploads = uploads.filter(u => steady(u.now));
  // Gaps only between adjacent samples that are both steady, so excluded windows never count as one long gap.
  const gaps = (times: number[]) => times.slice(1).flatMap((t, i) => steady(t) && steady(times[i]) ? [t - times[i]] : []);
  const uploadGaps = gaps(uploads.map(u => u.now));
  const steadyMs = trace.end - t0 - (firstFrame + 1000) - (Number.isFinite(seekAt) ? 1000 : 0);
  const rafGaps = gaps(trace.raf), refresh = pct(rafGaps, 0.5) ?? 16.7;
  // How many display refreshes each new source frame stayed on screen (ideal: refreshRate / fps, constant).
  const held: Record<string, number> = {};
  for (const gap of uploadGaps) { const ticks = String(Math.round(gap / refresh)); held[ticks] = (held[ticks] ?? 0) + 1; }
  return {
    firstFrameMs: Math.round(firstFrame),
    droppedByPhase: dropped,
    steady: {
      seconds: Number((steadyMs / 1000).toFixed(1)),
      expectedFrames: Math.round((steadyMs / 1000) * fps),
      decodedFrames: deltas.length + 1, sourceFramesSkipped: skippedSource,
      uploadedFrames: steadyUploads.length,
      uploadIntervalMs: { mean: mean(uploadGaps), p95: pct(uploadGaps, 0.95), max: pct(uploadGaps, 1) },
      refreshMs: refresh, refreshesPerSourceFrame: held,
      frameAgeAtUploadMs: { p50: pct(steadyUploads.map(u => u.age), 0.5), p95: pct(steadyUploads.map(u => u.age), 0.95), max: pct(steadyUploads.map(u => u.age), 1) },
      rafIntervalMs: { mean: mean(rafGaps), p99: pct(rafGaps, 0.99), max: pct(rafGaps, 1), over25ms: rafGaps.filter(g => g > 25).length }
    }
  };
}

test('local video pacing: startup, seek and steady playback measured separately', async () => {
  await mkdir(fixtureDir, { recursive: true });
  const report: unknown[] = [];
  for (const fps of [30, 60]) {
    const file = join(fixtureDir, `cfr-${fps}fps-720p-${seconds}s.webm`);
    for (let run = 1; run <= runs; run++) {
      const h = await Hector.launch();
      try {
        if (!existsSync(file)) await writeFile(file, await encodeClip(h.studio, { width: 1280, height: 720, fps, seconds }));
        const [video] = await h.importFiles([file]);
        await h.updateSurface({ sourceId: video.id, corners: fullFrame });
        const output = await h.openOutput();
        await output.evaluate(() => window.hectorProbe!.startTrace());
        await h.ok({ type: 'transport', playing: true, position: 0 });
        await h.ok({ type: 'apply' });
        await output.waitForTimeout(seekAtMs);
        await h.ok({ type: 'transport', playing: true, position: 12 });
        await output.waitForTimeout(recordMs - seekAtMs);
        const trace = (await output.evaluate(() => window.hectorProbe!.stopTrace()))!;
        const result = { fps, run, platform: process.platform, output: 'windowed, built-in display', studioPreviewDecodesSameFile: true, ...analyse(trace, video.id, fps) };
        console.log(JSON.stringify(result));
        report.push(result);
        expect(trace.frames.length).toBeGreaterThan(0);
      } finally { await h.close(); }
    }
  }
  await mkdir(resolve('artifacts'), { recursive: true });
  await writeFile(resolve('artifacts', 'pacing-report.json'), JSON.stringify(report, null, 2));
});
