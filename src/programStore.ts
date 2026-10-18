import { PROGRAM_LIMITS, validateProgramDefinition, type ProgramArtifact, type ProgramDefinition, type ProgramReport } from './shared/program.js';
declare global { interface Window { projectionPrograms?: { read(): Promise<ProgramArtifact[]>; put(artifact: ProgramArtifact): Promise<void> } } }
const key = 'projection-mapper.programs.v1';
export async function programHash(definition: ProgramDefinition): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(definition))))).map(n => n.toString(16).padStart(2,'0')).join('');
}
export async function listPrograms(): Promise<ProgramArtifact[]> {
  const result: unknown = window.projectionPrograms ? await window.projectionPrograms.read() : JSON.parse(localStorage.getItem(key) ?? '[]');
  if (!Array.isArray(result) || result.length > PROGRAM_LIMITS.artifacts) throw new Error('Program library cannot be read.');
  return result;
}
export async function getProgram(id: string): Promise<ProgramArtifact> {
  const artifact = (await listPrograms()).find(a => a.id === id);
  if (!artifact) throw new Error('This program is missing from this device’s library. Ask the assistant to recreate it here.');
  validateProgramDefinition(artifact.definition);
  if (await programHash(artifact.definition) !== id || !artifact.report.passed) throw new Error('Program library validation failed. Test the program again.');
  return artifact;
}
export async function putProgram(definition: ProgramDefinition, report: ProgramReport): Promise<ProgramArtifact> {
  const id = await programHash(definition), artifact: ProgramArtifact = { id, definition, report: { ...report, samples: [] }, createdAt: Date.now() };
  if (window.projectionPrograms) { await window.projectionPrograms.put(artifact); return artifact; }
  return navigator.locks.request(key, async () => {
    const entries = await listPrograms(), existing = entries.find(a => a.id === id);
    if (existing) return existing;
    if (entries.length >= PROGRAM_LIMITS.artifacts) throw new Error('This device’s program library is full (30 versions). Existing versions have been retained.');
    localStorage.setItem(key, JSON.stringify([...entries, artifact])); return artifact;
  });
}
