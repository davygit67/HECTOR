import type { Point } from '../core/model';
/** Inverse projective transform, column-major for GLSL. */
export function inverseQuad(p: Point[]): Float32Array {
  const [a,b,c,d] = p;
  const dx1 = b[0]-c[0], dx2 = d[0]-c[0], dx3 = a[0]-b[0]+c[0]-d[0];
  const dy1 = b[1]-c[1], dy2 = d[1]-c[1], dy3 = a[1]-b[1]+c[1]-d[1];
  const denominator = dx1*dy2-dx2*dy1;
  const g = (dx3*dy2-dx2*dy3)/denominator, h = (dx1*dy3-dx3*dy1)/denominator;
  const m = [b[0]-a[0]+g*b[0], d[0]-a[0]+h*d[0], a[0], b[1]-a[1]+g*b[1], d[1]-a[1]+h*d[1], a[1], g,h,1];
  const [A,B,C,D,E,F,G,H,I] = m;
  const cof = [E*I-F*H, F*G-D*I, D*H-E*G, C*H-B*I, A*I-C*G, B*G-A*H, B*F-C*E, C*D-A*F, A*E-B*D];
  const det = A*cof[0]+B*cof[1]+C*cof[2];
  if (!Number.isFinite(det) || Math.abs(det) < 1e-10) throw new Error('Surface is degenerate.');
  return new Float32Array(cof.map(v => v/det));
}
