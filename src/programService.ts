import type { Scene, Command } from './shared/domain.js';
import type { CommandReceipt } from './shared/bridge.js';
import type { StudioResult } from './shared/studio.js';
import { programParameters, validateProgramDefinition, type ProgramArtifact, type ProgramDefinition, type ProgramOperation, type ProgramReport, type ProgramRuntimeStatus, type ProgramTestValue, type ProgramApplyValue } from './shared/program.js';

export interface ProgramServices {
  scene(): Promise<Scene>;
  batch(commands: Command[], revision: number): Promise<CommandReceipt>;
  test(definition: ProgramDefinition, surfaceId: string): Promise<ProgramReport>;
  put(definition: ProgramDefinition, report: ProgramReport): Promise<ProgramArtifact>;
  get(id: string): Promise<ProgramArtifact>;
  runtime(id: string): ProgramRuntimeStatus | null;
  preview?(report: ProgramReport): ProgramTestValue['preview'];
}
/** Passes are short-lived, revision-bound capabilities, never a field supplied by the model. */
export class ProgramService {
  private candidates = new Map<string, { artifact: ProgramArtifact; surfaceId: string; revision: number; geometry: number; at: number }>();
  constructor(private readonly services: ProgramServices) {}
  async execute(op: ProgramOperation): Promise<StudioResult> {
    const scene = await this.services.scene();
    const fail = (message: string, value?: unknown): StudioResult => ({ ok: false, outcome: 'failed', message, sceneRevision: scene.revision, value });
    try {
      if (op.type === 'program.test') {
        validateProgramDefinition(op.definition);
        if (!scene.surfaces.some(s => s.id === op.surfaceId)) throw new Error('Choose an existing surface.');
        const definition = structuredClone(op.definition);
        const report = await this.services.test(definition, op.surfaceId);
        const value: ProgramTestValue = { report, sceneRevision: scene.revision, geometryRevision: scene.geometryRevision, surfaceId: op.surfaceId, preview: this.services.preview?.(report) };
        if (!report.passed) return fail('Candidate failed its offstage tests. No live content changed.', value);
        const artifact = await this.services.put(definition, report);
        value.testId = crypto.randomUUID();
        for (const [id, c] of this.candidates) if (Date.now() - c.at > 600000) this.candidates.delete(id);
        if (this.candidates.size >= 12) this.candidates.delete(this.candidates.keys().next().value!);
        this.candidates.set(value.testId, { artifact: structuredClone(artifact), surfaceId: op.surfaceId, revision: scene.revision, geometry: scene.geometryRevision, at: Date.now() });
        return { ok: true, outcome: 'applied', message: 'Candidate passed offstage tests. It has not been placed or started. Inspect the preview before applying.', sceneRevision: scene.revision, value };
      }
      const content = 'contentId' in op ? scene.contents.find(c => c.id === op.contentId) : undefined;
      if (op.type !== 'program.apply' && content?.kind !== 'program') throw new Error('Select a generated program.');
      if (op.type === 'program.inspect' && content?.kind === 'program') {
        const artifact = await this.services.get(content.config.artifactId);
        return { ok: true, outcome: 'applied', message: 'Program inspected.', sceneRevision: scene.revision, value: { definition: artifact.definition, artifactId: artifact.id, parameters: content.config.parameters, canRollback: !!content.config.previous?.length, runtime: this.services.runtime(content.id) } };
      }
      let commands: Command[], id: string;
      if (op.type === 'program.apply') {
        const candidate = this.candidates.get(op.testId);
        if (!candidate || Date.now() - candidate.at > 600000) throw new Error('Test this candidate again before applying.');
        if (op.expectedRevision !== scene.revision || candidate.revision !== scene.revision || candidate.geometry !== scene.geometryRevision || candidate.surfaceId !== op.surfaceId) throw new Error('The scene or target changed since testing. Retest against the current surface before applying.');
        if (op.contentId && (content?.kind !== 'program' || content.surfaceId !== op.surfaceId)) throw new Error('Only revise an existing program on the tested surface.');
        id = op.contentId ?? crypto.randomUUID();
        const previous = content?.kind === 'program' ? [{ artifactId: content.config.artifactId, parameters: content.config.parameters, seed: content.config.seed }, ...(content.config.previous ?? [])].slice(0,5) : [];
        const compatible = content?.kind === 'program' ? Object.fromEntries(candidate.artifact.definition.parameters.flatMap(p => { const value = content.config.parameters[p.key]; return Number.isFinite(value) && value >= p.min && value <= p.max ? [[p.key, value]] : []; })) : {};
        const config = { artifactId: candidate.artifact.id, parameters: programParameters(candidate.artifact.definition, compatible), seed: content?.kind === 'program' ? content.config.seed : 42, previous };
        commands = content ? [{ type: 'content.update', id, title: candidate.artifact.definition.title, spec: { kind: 'program', config } }, { type: 'content.action', id, action: 'reset' }]
          : [{ type: 'content.create', id, surfaceId: op.surfaceId, title: candidate.artifact.definition.title, spec: { kind: 'program', config } }];
      } else if (content?.kind === 'program' && op.type === 'program.configure') {
        const artifact = await this.services.get(content.config.artifactId);
        const parameters = programParameters(artifact.definition, { ...content.config.parameters, ...op.parameters });
        id = content.id; commands = [{ type: 'content.update', id, spec: { kind: 'program', config: { ...content.config, parameters } } }];
      } else if (content?.kind === 'program' && op.type === 'program.rollback') {
        const [previous, ...rest] = content.config.previous ?? [];
        if (!previous) throw new Error('No earlier working version is available.');
        const artifact = await this.services.get(previous.artifactId);
        id = content.id; commands = [{ type: 'content.update', id, title: artifact.definition.title, spec: { kind: 'program', config: { ...previous, previous: rest } } }, { type: 'content.action', id, action: 'reset' }];
      } else throw new Error('Unsupported program operation.');
      const receipt = await this.services.batch(commands, scene.revision);
      if (!receipt.ok) return fail(receipt.error);
      const applied = receipt.scene.contents.find(c => c.id === id)!;
      if (applied.kind !== 'program') throw new Error('Program receipt is missing.');
      if (op.type === 'program.apply') this.candidates.delete(op.testId);
      const value: ProgramApplyValue = { contentId: id, artifactId: applied.config.artifactId, version: applied.config.artifactId, paused: !applied.state.clock.running, parameters: applied.config.parameters };
      return { ok: true, outcome: 'applied', message: op.type === 'program.configure' ? 'Parameters updated; game progress retained.' : 'Tested program placed paused. Existing content and calibration retained. Start it to animate or play.', sceneRevision: receipt.scene.revision, value };
    } catch (e) { return fail(e instanceof Error ? e.message : 'Program operation failed.'); }
  }
}
