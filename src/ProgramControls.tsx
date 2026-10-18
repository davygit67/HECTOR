import { useEffect, useState } from 'react';
import type { ProgramContent } from './shared/content';
import type { Command } from './shared/domain';
import type { ProgramArtifact } from './shared/program';
import { getProgram } from './programStore';
import { readProgram } from './programRuntime';
import { programWorkshop } from './programWorkshop';

export function ProgramControls({ content, send, onPlay }: { content: ProgramContent; send(c: Command): unknown; onPlay(): void }) {
  const [artifact, setArtifact] = useState<ProgramArtifact>(), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [, refresh] = useState(0);
  useEffect(() => { let active = true; setError(''); getProgram(content.config.artifactId).then(a => { if (active) setArtifact(a); }).catch(e => { if (active) setError(String(e.message)); }); return () => { active = false; }; }, [content.config.artifactId]);
  useEffect(() => { const timer = setInterval(() => refresh(n => n + 1), 500); return () => clearInterval(timer); }, []);
  const runtime = readProgram(content.id)?.status;
  const act = async (type: 'program.configure' | 'program.rollback', parameters?: Record<string,number>) => {
    setBusy(true); setError('');
    try { const result = await programWorkshop.execute(type === 'program.configure' ? { type, contentId: content.id, parameters: parameters! } : { type, contentId: content.id }); if (!result.ok) setError(result.message); }
    catch (e) { setError(String(e)); } finally { setBusy(false); }
  };
  return <section aria-label="Generated program controls">
    <p>{artifact?.definition.description}</p>
    <p role="status" className="hint">{runtime?.message ?? 'Loading program…'}{runtime?.frameMs ? ` · ${runtime.frameMs.toFixed(1)} ms per update` : ''}</p>
    {error && <p role="alert">{error}</p>}
    <div className="content-actions"><button className="primary" disabled={busy || runtime?.status === 'error'} onClick={() => { send({ type: 'content.action', id: content.id, action: content.state.clock.running ? 'pause' : 'start' }); if (!content.state.clock.running) onPlay(); }}>{content.state.clock.running ? 'Pause' : 'Start & interact'}</button>
      <button className="secondary" onClick={() => send({ type: 'content.action', id: content.id, action: 'reset' })}>Reset</button></div>
    <button className="secondary full-width" onClick={onPlay}>Interact on canvas</button>
    <p className="hint">Click the artwork to focus it for pointer and keyboard input. Every view shares the same progress. Physical hand tracking is not connected yet.</p>
    {artifact?.definition.parameters.map(p => <label className="field" key={p.key}><span>{p.label} · {content.config.parameters[p.key] ?? p.default}</span><input aria-label={p.label} type="range" min={p.min} max={p.max} step={p.step} disabled={busy} value={content.config.parameters[p.key] ?? p.default} onChange={e => void act('program.configure', { [p.key]: Number(e.target.value) })} /></label>)}
    <button className="secondary full-width" disabled={busy || !content.config.previous?.length} onClick={() => void act('program.rollback')}>Restore previous version</button>
    <details><summary>Test results & program</summary>
      <p className="hint">Version {content.config.artifactId.slice(0,8)} · {artifact?.report.frames ?? 0} offstage frames. Passing checks does not prove every possible behavior.</p>
      <ul>{artifact?.report.checks.map((c,i) => <li key={i}>{c.passed ? '✓' : '×'} {c.name}: {c.message}</li>)}</ul>
      <details><summary>Generated source</summary><pre style={{ whiteSpace: 'pre-wrap', maxHeight: 320, overflow: 'auto', fontSize: 12 }}>{artifact?.definition.source}</pre></details>
      <details><summary>Live game state</summary><pre style={{ maxHeight: 180, overflow: 'auto', whiteSpace: 'pre-wrap' }}>{JSON.stringify(runtime?.state, null, 2)}</pre></details>
    </details>
  </section>;
}
