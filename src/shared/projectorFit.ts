import { decodeProjectorPixels } from './roomSolve.js';
import { roomMatchesFrame, type RoomReference } from './roomModel.js';
import type { SensorSession } from './sensor.js';
import type { Vec3 } from './spatial.js';
import { projectCamera, type ProjectorFit } from './objectMapping.js';

export interface ProjectorPair { p: Vec3; x: number; y: number }
function linear(rows: number[][]) {
  const a = rows.map(r => r.slice()), n = a.length;
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    [a[c], a[p]] = [a[p], a[c]];
    if (Math.abs(a[c][c]) < 1e-8) throw new Error('Calibration geometry is flat or too narrow. Add boxes at different depths and scan again.');
    const d = a[c][c]; for (let j = c; j <= n; j++) a[c][j] /= d;
    for (let r = 0; r < n; r++) if (r !== c) { const k = a[r][c]; for (let j = c; j <= n; j++) a[r][j] -= k * a[c][j]; }
  }
  return a.map(r => r[n]);
}
/** Normalized camera DLT with the denominator fixed at the sample centroid. */
function fit(pairs: ProjectorPair[]) {
  const mean = [0, 1, 2].map(a => pairs.reduce((s, v) => s + v.p[a], 0) / pairs.length);
  const size = Math.sqrt(pairs.reduce((s, v) => s + v.p.reduce((q, n, a) => q + (n - mean[a]) ** 2, 0), 0) / pairs.length);
  const normal = Array.from({ length: 11 }, () => new Array(12).fill(0));
  for (const pair of pairs) {
    const [x, y, z] = pair.p.map((n, a) => (n - mean[a]) / size), u = pair.x - .5, v = pair.y - .5;
    for (const row of [[x,y,z,1,0,0,0,0,-u*x,-u*y,-u*z,u], [0,0,0,0,x,y,z,1,-v*x,-v*y,-v*z,v]])
      for (let a = 0; a < 11; a++) for (let b = 0; b <= 11; b++) normal[a][b] += row[a] * row[b];
  }
  const h = [...linear(normal), 1], matrix: number[] = [];
  for (let r = 0; r < 3; r++) {
    const row = h.slice(r * 4, r * 4 + 4).map((n, a) => n + (r < 2 ? .5 * h[8 + a] : 0));
    matrix.push(row[0] / size, row[1] / size, row[2] / size, row[3] - row.slice(0,3).reduce((s,n,a) => s + n * mean[a] / size, 0));
  }
  return matrix;
}
/** Train/held-out split before robust fitting. No holdout samples enter the final fit. */
export function fitProjectorPairs(pairs: ProjectorPair[], width: number, height: number) {
  if (pairs.length < 600 || pairs.some(v => ![...v.p,v.x,v.y].every(Number.isFinite))) throw new Error('At least 600 valid 3D projector matches are needed.');
  const hold = pairs.filter((_, i) => i % 5 === 0), train = pairs.filter((_, i) => i % 5 !== 0);
  const residual = (m: number[], p: ProjectorPair) => { const q = projectCamera(m, p.p); return q.depth > .05 ? Math.hypot((q.x-p.x)*width,(q.y-p.y)*height) : Infinity; };
  let best: ProjectorPair[] = [], seed = 47291;
  const rand = () => ((seed = (Math.imul(seed,1664525)+1013904223)>>>0) / 2**32);
  for (let k = 0; k < 100; k++) {
    const indices = new Set<number>(); while (indices.size < 12) indices.add(Math.floor(rand()*train.length));
    try { const m = fit([...indices].map(i => train[i])), inliers = train.filter(p => residual(m,p)<3); if (inliers.length>best.length) best=inliers; } catch { /* Degenerate random subset. */ }
  }
  if (best.length < train.length*.85) throw new Error('3D projector fit is inconsistent. Keep the scene still and improve pattern contrast.');
  const matrix = fit(best), errors = hold.map(p => residual(matrix,p)).sort((a,b)=>a-b), accepted = errors.filter(n=>n<=4);
  const rmsPx = Math.sqrt(accepted.reduce((s,n)=>s+n*n,0)/accepted.length), p95Px = errors[Math.floor(errors.length*.95)];
  if (accepted.length<hold.length*.95 || rmsPx>2.5 || p95Px>4) throw new Error('Independent projector checks failed. Recalibrate with clearer patterns and geometry at several depths.');
  const min = [0,1,2].map(a=>Math.min(...best.map(p=>p.p[a]))) as Vec3, max = [0,1,2].map(a=>Math.max(...best.map(p=>p.p[a]))) as Vec3;
  const bins = new Set(best.map(p=>`${Math.floor(p.x*4)},${Math.floor(p.y*4)}`));
  if (bins.size<8 || max[2]-min[2]<.1 || Math.max(...best.map(p=>p.x))-Math.min(...best.map(p=>p.x))<.35 || Math.max(...best.map(p=>p.y))-Math.min(...best.map(p=>p.y))<.3) throw new Error('Spread calibration objects across the projection and at least 10 cm in depth.');
  // Refit with normalized normal equations: flat/nearly flat samples must remain singular.
  // A held-out check alone cannot resolve the third dimension of a single plane.
  const mean = min.map((_,a)=>best.reduce((s,p)=>s+p.p[a],0)/best.length);
  const cov = Array.from({length:3},()=>[0,0,0]);
  for (const {p} of best) for(let a=0;a<3;a++) for(let b=0;b<3;b++) cov[a][b]+=(p[a]-mean[a])*(p[b]-mean[b])/best.length;
  const det = cov[0][0]*(cov[1][1]*cov[2][2]-cov[1][2]**2)-cov[0][1]*(cov[0][1]*cov[2][2]-cov[1][2]*cov[0][2])+cov[0][2]*(cov[0][1]*cov[1][2]-cov[1][1]*cov[0][2]);
  const trace = cov[0][0]+cov[1][1]+cov[2][2];
  if (det<=1e-7 || det/trace**3<.00005) throw new Error('Calibration is too close to a single plane. Use a table plus sizeable boxes at different depths.');
  return {matrix,bounds:{min,max},rmsPx,p95Px,samples:best.length,heldOut:hold.length};
}
export function solveProjector(session: SensorSession, room: RoomReference): ProjectorFit {
  if (session.provenance!=='sensor' || room.source!=='sensor' || room.invalidated) throw new Error('Use a live physical room and sensor capture for object projection.');
  const decoded=decodeProjectorPixels(session), f=decoded.reference, presentation=session.captures[0].presentation;
  if (!session.frames.every(frame=>roomMatchesFrame(room,frame)) || presentation.mode!=='output-window' || !presentation.fullscreen) throw new Error('Keep the room, sensor and full-screen projector unchanged during calibration.');
  const pairs:ProjectorPair[]=[];
  const stride=Math.max(1,Math.ceil(decoded.pixels.length/6000));
  for(let i=0;i<decoded.pixels.length;i+=stride) { const uv=decoded.pixels[i]; if(uv) pairs.push({p:[f.cameraPoints![3*i],f.cameraPoints![3*i+1],f.cameraPoints![3*i+2]],...uv}); }
  return {id:session.id,roomReferenceId:room.id,sensorId:room.sensorId,descriptor:room.descriptor,...fitProjectorPairs(pairs,decoded.width,decoded.height),raster:{width:decoded.width,height:decoded.height},viewport:presentation.viewport,rasterRect:presentation.rasterRect,outputId:presentation.outputId};
}
