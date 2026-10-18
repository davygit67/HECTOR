import type { RoomModelStatus } from './shared/roomModel';

export function RoomReferencePanel({ status, busy, canScan, scan, forget }: { status: RoomModelStatus; busy: boolean; canScan: boolean; scan(): void; forget(): void }) {
  return <section className="hardware-card" aria-label="Stable measured room">
    <div className="hardware-card-title"><div><span className="eyebrow">02 / STABLE ROOM</span><h3>Keep the room in place</h3></div><span className="hardware-badge">{status.state === 'ready' ? 'Live reference verified' : status.state}</span></div>
    <p>Mount the Kinect firmly with the projector, then capture the room while everything is still. Twelve observations combine into one measured reference. Short USB interruptions keep this reference intact.</p>
    <div className="hardware-actions"><button className="primary" disabled={busy || !canScan} onClick={scan}>{status.referenceId ? 'Capture new room reference' : 'Capture room reference'}</button>
      {status.referenceId && <button className="secondary" disabled={busy} onClick={forget}>Forget room reference</button>}</div>
    <p role="status">{status.message}</p>
    {status.referenceId && <p>{status.points.toLocaleString()} stable points · {status.frames} observations · {Math.round((status.stableFraction ?? 0) * 100)}% of observed rays stable · {status.floorAligned ? 'Measured floor orientation' : 'Camera-relative orientation; choose surface roles manually'}</p>}
    <p className="hardware-footnote">The saved cloud appears in Studio’s 3D room. Next, scan the projector patterns below to align a tabletop or wall. Capturing a new reference retires earlier automatic mapping eligibility; it does not move or delete your content. Existing output stays visible during a dropout, but new physical actions wait for verification. This reference covers the Kinect’s current view, not unseen sides of the room.</p>
  </section>;
}
