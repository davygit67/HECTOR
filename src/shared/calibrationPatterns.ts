/** Raw projector-raster patterns. Never pass these through the scene's surface warp. */
export interface CalibrationPattern {
  id: string;
  kind: 'black' | 'white' | 'grid' | 'gray';
  width: number;
  height: number;
  axis?: 'x' | 'y';
  bit?: number;
  inverted?: boolean;
}

export function validatePattern(value: unknown): asserts value is CalibrationPattern {
  const p = value as CalibrationPattern;
  if (!p || typeof p.id !== 'string' || !p.id || p.id.length > 100 ||
    !['black', 'white', 'grid', 'gray'].includes(p.kind) ||
    !Number.isInteger(p.width) || !Number.isInteger(p.height) || p.width < 16 || p.height < 16 || p.width > 4096 || p.height > 2160) {
    throw new Error('Invalid calibration pattern.');
  }
  if (p.kind === 'gray' && (!['x', 'y'].includes(p.axis!) || !Number.isInteger(p.bit) || p.bit! < 0 ||
    p.bit! >= Math.ceil(Math.log2(p.axis === 'x' ? p.width : p.height)) || typeof p.inverted !== 'boolean')) {
    throw new Error('Invalid stripe pattern.');
  }
}

export function patternSequence(width: number, height: number, kind: 'gray' | 'checks' = 'gray'): CalibrationPattern[] {
  const make = (name: 'black' | 'white' | 'grid'): CalibrationPattern => ({ id: name, kind: name, width, height });
  const result = [make('white'), make('black')];
  validatePattern(result[0]);
  if (kind === 'checks') return [...result, make('grid')];
  for (const axis of ['x', 'y'] as const) {
    const bits = Math.ceil(Math.log2(axis === 'x' ? width : height));
    for (let bit = bits - 1; bit >= 0; bit--) for (const inverted of [false, true]) {
      result.push({ id: `${axis}-${bit}-${inverted ? 'inverse' : 'normal'}`, kind: 'gray', width, height, axis, bit, inverted });
    }
  }
  return result;
}

export function patternValue(p: CalibrationPattern, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= p.width || y >= p.height) return 0;
  if (p.kind === 'white') return 255;
  if (p.kind === 'black') return 0;
  if (p.kind === 'grid') {
    const thickness = Math.max(1, Math.round(p.width / 640));
    return x < thickness || y < thickness || x >= p.width - thickness || y >= p.height - thickness ||
      x % Math.max(1, Math.round(p.width / 16)) < thickness || y % Math.max(1, Math.round(p.height / 9)) < thickness ? 255 : 16;
  }
  const coordinate = Math.floor(p.axis === 'x' ? x : y);
  const gray = coordinate ^ (coordinate >>> 1);
  return ((((gray >>> p.bit!) & 1) !== 0) !== p.inverted) ? 255 : 0;
}

export function patternLabel(p: CalibrationPattern): string {
  if (p.kind !== 'gray') return p.kind === 'grid' ? 'Alignment grid' : p.kind === 'white' ? 'White reference' : 'Black reference';
  return `${p.axis === 'x' ? 'Vertical' : 'Horizontal'} stripes · bit ${p.bit! + 1}${p.inverted ? ' · inverse' : ''}`;
}
