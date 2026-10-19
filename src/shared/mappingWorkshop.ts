import type { TrackingRegion } from './objectMapping.js';
import type { Vec3 } from './spatial.js';

export interface MappingSettings {
  /** Projector-mask cells, not native projector pixels. Both operations only remove light. */
  insetPx: number;
  featherPx: number;
  /** Fractions trimmed from current measured camera bounds, before projector occlusion. */
  trim: { left: number; top: number; right: number; bottom: number };
}
export const DEFAULT_MAPPING_SETTINGS: MappingSettings = { insetPx: 1, featherPx: 0, trim: { left: 0, top: 0, right: 0, bottom: 0 } };
export interface MappingCandidate {
  id: string; number: number; bounds: TrackingRegion; centerMeters: Vec3; extentMeters: Vec3;
  points: number; contour: { x: number; y: number }[]; selectable: boolean;
}
export interface MappingImage { mimeType: 'image/png'; data: string; width: number; height: number }
export interface MappingState {
  revision: number; objectId: string | null; settings: MappingSettings; canUndo: boolean;
}
export interface MappingObservation {
  observationId: string; revision: number; at: number; capturedAt: number; expiresAt: number;
  /** Raw source age at response; add clockUncertaintyMs for the conservative freshness bound. */
  ageMs: number; clockUncertaintyMs: number; stale: boolean;
  kind: 'mapping-observation'; source: 'registered-kinect'; opticalAlignmentVerified: false;
  roomReferenceId: string; sensorId: string; calibrationId: string | null;
  candidates: MappingCandidate[]; selected: MappingState;
  /** Paired physical images and computed overlays are deliberately separate. */
  images: { camera: MappingImage | null; depth: MappingImage | null; overlay: MappingImage | null; projectorMask: MappingImage | null };
  maskScale: { width: number; height: number; projectorPixelsPerCell: number } | null;
  limitations: string[];
}
export type MappingObserveRequest = Record<string, never>;
type Grounding = { observationId: string; expectedRevision: number };
export type MappingOperation = Grounding & (
  | { type: 'mapping.select'; candidateId: string }
  | { type: 'mapping.refine'; objectId: string; settings: Partial<MappingSettings> }
  | { type: 'mapping.undo' | 'mapping.reset'; objectId: string }
);
/** Single-use grounding: frame freshness is checked separately at each physical action. */
export class MappingLease {
  private current: { id:string; revision:number; signature:string; expiresAt:number } | null = null;
  issue(id:string,revision:number,signature:string,now=Date.now()) { this.current={id,revision,signature,expiresAt:now+15000};return this.current.expiresAt; }
  check(id:string,revision:number,signature:string,now=Date.now()) {
    const c=this.current;if(!c||id!==c.id||revision!==c.revision||signature!==c.signature||now>=c.expiresAt)throw new Error('Mapping observation expired or the mapping changed. Inspect it again before editing.');
  }
  consume(){this.current=null;}
}
export function validateMappingOperation(op:MappingOperation) {
  const extra=op?.type==='mapping.select'?['candidateId']:op?.type==='mapping.refine'?['objectId','settings']:['objectId'];
  if(!op||!['mapping.select','mapping.refine','mapping.undo','mapping.reset'].includes(op.type)||Object.keys(op).some(k=>!['type','observationId','expectedRevision',...extra].includes(k))||typeof op.observationId!=='string'||op.observationId.length<1||op.observationId.length>128||!Number.isSafeInteger(op.expectedRevision)||op.expectedRevision<0)throw new Error('Use the current mapping observation and revision.');
  const id=op.type==='mapping.select'?op.candidateId:op.objectId;if(typeof id!=='string'||!id||id.length>128)throw new Error('Choose a measured candidate or selected object.');
  if(op.type==='mapping.refine')mappingSettings(DEFAULT_MAPPING_SETTINGS,op.settings);
}
export function mappingSettings(current: MappingSettings, patch: Partial<MappingSettings>): MappingSettings {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some(k => !['insetPx', 'featherPx', 'trim'].includes(k))) throw new Error('Choose inset, feather or trim settings.');
  const value = { ...current, ...patch, trim: { ...current.trim, ...patch.trim } };
  if (!Number.isInteger(value.insetPx) || value.insetPx < 1 || value.insetPx > 8 || !Number.isInteger(value.featherPx) || value.featherPx < 0 || value.featherPx > 8) throw new Error('Inset must be 1–8 and feather 0–8 mask cells.');
  if (patch.trim !== undefined && (!patch.trim || typeof patch.trim !== 'object' || Array.isArray(patch.trim) || Object.keys(patch.trim).length !== 4 || Object.keys(patch.trim).some(k => !['left', 'top', 'right', 'bottom'].includes(k)))) throw new Error('Supply all four trim margins.');
  if (Object.values(value.trim).some(n => !Number.isFinite(n) || n < 0 || n > .3)) throw new Error('Trim margins must be between 0 and 0.3.');
  return value;
}

/** Manhattan distance to unknown/background, including the raster exterior. No dilation. */
export function softenMeasuredMask(mask: { width: number; height: number; bits: Uint8Array }, settings: MappingSettings) {
  const { width: w, height: h, bits } = mask, distances = new Uint16Array(bits.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y*w+x; distances[i] = !bits[i] ? 0 : Math.min(x && y ? 65534 : 1, x ? distances[i-1]+1 : 1, y ? distances[i-w]+1 : 1); }
  for (let y = h-1; y >= 0; y--) for (let x = w-1; x >= 0; x--) { const i = y*w+x; if (bits[i]) distances[i] = Math.min(distances[i], x<w-1 ? distances[i+1]+1 : 1, y<h-1 ? distances[i+w]+1 : 1); }
  const result = new Uint8Array(bits.length), alpha = new Uint8Array(bits.length);
  for (let i = 0; i < bits.length; i++) if (distances[i] > settings.insetPx) { result[i] = 1; alpha[i] = Math.round(255*Math.min(1,(distances[i]-settings.insetPx)/(settings.featherPx+1))); }
  return { width: w, height: h, bits: result, alpha };
}
