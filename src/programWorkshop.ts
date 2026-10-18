import { agentBatch, bridge } from './bridge';
import { ProgramService } from './programService';
import { ProgramWorker } from './programClient';
import { programParameters, type ProgramReport } from './shared/program';
import { getProgram, putProgram } from './programStore';
import { readProgram } from './programRuntime';
import { paintProgramFrame } from './programPainter';

export function programPreview(report: ProgramReport) {
  if (!report.samples.length) return undefined;
  const canvas = document.createElement('canvas'); canvas.width = 768; canvas.height = 144;
  const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#000000'; ctx.fillRect(0,0,768,144);
  report.samples.slice(0,3).forEach((sample,i) => { ctx.save(); ctx.translate(i * 256,0); paintProgramFrame(ctx,sample.commands,256,144); ctx.restore(); });
  return { mimeType: 'image/png' as const, data: canvas.toDataURL('image/png').split(',')[1], width: 768, height: 144 };
}
export const programWorkshop = new ProgramService({
  scene: async () => (await bridge.getSnapshot()).scene,
  batch: async (commands, revision) => { if (!agentBatch) throw new Error('Restart the updated Studio to apply generated programs.'); return agentBatch(commands, revision); },
  test: async (definition, surfaceId) => {
    const scene = (await bridge.getSnapshot()).scene, surface = scene.surfaces.find(s => s.id === surfaceId)!;
    const worker = new ProgramWorker();
    try { return await worker.test(definition, { time: 0, dt: 0, params: programParameters(definition), seed: 42, input: [], surface: { width: surface.width, height: surface.height, measured: surface.provenance === 'measured' } }); }
    catch (e) { return { passed: false, checks: [{ name: 'Worker', passed: false, message: e instanceof Error ? e.message : 'Test worker failed.' }], frames: 0, meanStepMs: 0, maxStepMs: 0, samples: [] }; }
    finally { worker.dispose(); }
  },
  get: getProgram, put: putProgram, runtime: id => readProgram(id)?.status ?? null, preview: programPreview,
});
