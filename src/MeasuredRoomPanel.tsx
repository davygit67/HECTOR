import { measuredMaskPath } from './shared/measured';
import type { RoomSolve } from './shared/roomSolve';

export function MeasuredRoomPanel({ result, state, message, busy, canMap, canSolve, appliedId, map, solve, useSurface }: {
  result: RoomSolve | null; state: string; message: string; busy: boolean; canMap: boolean; canSolve: boolean; appliedId?: string;
  map(): void; solve(): void; useSurface(id: string, kind: 'table' | 'wall'): void;
}) {
  return <section className="hardware-card measured-room-card" aria-label="Measured surfaces">
    <div className="hardware-card-title"><div><span className="eyebrow">03 / MEASURE & MAP</span><h3>Find the tabletop</h3></div><span className="hardware-badge">One stationary projector</span></div>
    <p>Keep the Kinect, projector and table still. Both devices need a clear view of the same surface. Open the output on the projector and choose <strong>Full screen</strong>, then start mapping.</p>
    <p>The scan projects a short sequence of black and white stripes. It measures flat patches and their projector alignment. Unknown pixels, depth gaps and objects above the plane stay excluded.</p>
    <div className="hardware-actions"><button className="primary" disabled={busy || !canMap} onClick={map}>Scan & map table</button><button className="secondary" disabled={busy || !canSolve} onClick={solve}>Solve selected capture</button></div>
    <p className="hardware-caption" role="status">{message || 'Connect the updated Kinect helper to begin. First scan takes roughly one minute.'}</p>
    {state === 'solving' && <p role="status">Finding flat surfaces and checking projector matches…</p>}
    {result && <div className="measured-candidates">{result.candidates.map(candidate => <article key={candidate.id} className={appliedId === candidate.id ? 'selected' : ''}>
      <svg viewBox="0 0 192 108" aria-label={`${candidate.label} observed coverage`}><rect width="192" height="108" fill="#000" /><path d={measuredMaskPath(candidate.surface.measurement!.mask, 192, 108)} fill="#8ec8a5" /></svg>
      <div><strong>{candidate.label}</strong><p>{candidate.surface.width.toFixed(2)} × {candidate.surface.height.toFixed(2)} m · {candidate.rmsPx.toFixed(2)} px fit error</p>
        <small>{candidate.surface.measurement!.source === 'synthetic' ? 'Generated test data · not a physical calibration' : candidate.kind === 'table' ? 'Horizontal and table-height; object identity is an estimate.' : 'Choose the role after checking this patch.'}</small>
        <div className="hardware-actions"><button className="secondary" disabled={busy} onClick={() => useSurface(candidate.id, 'table')}>{appliedId === candidate.id ? 'Reapply as table' : 'Use as table'}</button><button className="secondary" disabled={busy} onClick={() => useSurface(candidate.id, 'wall')}>Use as wall</button></div>
      </div>
    </article>)}</div>}
    <div className="hardware-footnote">Once mapped, return to Studio and ask “Make the tabletop red.” Use Project full screen on the same display. Re-scan after moving either device or the surface, or changing projector keystone/zoom. This maps flat surfaces; curved objects and live object tracking are not supported yet.</div>
  </section>;
}
