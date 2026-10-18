import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { measuredRoomFixture } from './fixtures/measured-room';
import { RoomScanPanel } from '../src/RoomScanPanel';
import { MeasuredRoomPanel } from '../src/MeasuredRoomPanel';
import { type RoomSolve } from '../src/shared/roomSolve';
import { initialScene, reduceScene } from '../src/shared/domain';
import { Stage } from '../src/SurfaceEditor';
import { getArtwork } from '../src/SpatialView';
import '../src/styles.css';
import '../src/spatial.css';
import '../src/hardware.css';
function Fixture() {
  const [result, setResult] = useState<RoomSolve | null>(null), [scene, setScene] = useState(initialScene()), [status, setStatus] = useState('Waiting');
  const [checks, setChecks] = useState({});
  useEffect(() => {
    const worker = new Worker(new URL('../src/roomSolve.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = ({data}) => { if (data.error) setStatus(data.error); else { setResult(data.result); setStatus('Synthetic solve complete'); } }; worker.postMessage(measuredRoomFixture());
    return () => worker.terminate();
  }, []);
  function apply() {
    let s = reduceScene(scene, { type: 'surface.measure', surface: result!.candidates[0].surface });
    s = reduceScene(s, { type: 'surface.fill', id: 'tabletop', color: '#ff0000' });
    const canvas = getArtwork(s, s.surfaces[0], 0).canvas, ctx = canvas.getContext('2d')!;
    const sample = (u: number, v: number) => [...ctx.getImageData(Math.floor(u * canvas.width), Math.floor(v * canvas.height), 1, 1).data];
    setChecks({ provenance: s.surfaces[0].provenance, calibration: s.manualOutput.calibration, fill: sample(.22,.22), occluder: sample(.5,.5), mask: !!s.surfaces[0].measurement }); setScene(s);
  }
  return <main className="hardware-workspace"><h1>Isolated measured-room check</h1><p>Generated data only. No bridge, live scene, sensor, media playback or agent calls.</p>
    <MeasuredRoomPanel result={result} state={result ? 'review' : 'solving'} message={status} busy={!result} canMap={false} canSolve={false} map={() => {}} solve={() => {}} useSurface={apply} />
    <pre id="checks">{JSON.stringify(checks, null, 2)}</pre><div style={{ maxWidth: 720 }}><Stage scene={scene} now={0} mode="align" clean /></div><RoomScanPanel />
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
