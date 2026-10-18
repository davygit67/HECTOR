import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';

export const RTABMAP_VERSION = '0.23.8';
export const MAX_SCAN_BYTES = 32 * 1024 * 1024;
export interface RoomScan {
  positions: Float32Array; colors: Float32Array; inputPoints: number;
  bounds: { min: number[]; max: number[] }; frame: 'rtabmap-export';
}

/** Consume RTAB-Map's assembled cloud; preserve its coordinates and never imply projector registration. */
export function parseRoomScan(bytes: ArrayBuffer): RoomScan {
  if (bytes.byteLength > MAX_SCAN_BYTES) throw new Error('Export a smaller point cloud (32 MB maximum).');
  const header = new TextDecoder().decode(bytes.slice(0, Math.min(bytes.byteLength, 16384)));
  const end = header.indexOf('end_header');
  if (!header.startsWith('ply\n') && !header.startsWith('ply\r\n') || end < 0) throw new Error('Choose a PLY point-cloud export from RTAB-Map.');
  const lines = header.slice(0, end).split(/\r?\n/);
  const count = Number(lines.find(l => /^element vertex \d+$/.test(l))?.split(' ')[2]);
  if (!Number.isInteger(count) || count < 3 || count > 1000000) throw new Error('Export between 3 and 1,000,000 points; use voxel filtering for a large scan.');
  if (lines.some(l => l.startsWith('element ') && !/^element vertex /.test(l) && l !== 'element camera 1' && !/ 0$/.test(l)) || lines.some(l => l.startsWith('property list'))) throw new Error('Choose an assembled point cloud, rather than a mesh.');
  if (!['x', 'y', 'z'].every(axis => lines.some(l => new RegExp(`^property (float|float32|double|float64) ${axis}$`).test(l)))) throw new Error('This cloud is missing XYZ coordinates.');
  const geometry = new PLYLoader().parse(bytes);
  try {
    const positions = geometry.getAttribute('position'), colors = geometry.getAttribute('color');
    if (positions.count !== count) throw new Error('The cloud is incomplete. Export it again.');
    const xyz: number[] = [], rgb: number[] = [], min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    const stride = Math.max(1, Math.ceil(count / 100000));
    for (let i = 0; i < count; i++) {
      const p = [positions.getX(i), positions.getY(i), positions.getZ(i)];
      if (!p.every(n => Number.isFinite(n) && Math.abs(n) < 10000)) continue;
      p.forEach((v, a) => { min[a] = Math.min(min[a], v); max[a] = Math.max(max[a], v); });
      if (i % stride) continue;
      xyz.push(...p);
      const c = colors ? [colors.getX(i), colors.getY(i), colors.getZ(i)] : [.55, .8, .7];
      rgb.push(...c.map(n => Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : .5));
    }
    if (xyz.length < 9 || !max.some((v, a) => v - min[a] > .001)) throw new Error('No usable room geometry was found in this cloud.');
    return { positions: new Float32Array(xyz), colors: new Float32Array(rgb), inputPoints: count, bounds: { min, max }, frame: 'rtabmap-export' };
  } finally { geometry.dispose(); }
}
