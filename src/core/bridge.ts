import type { Command, Scene, Source } from './model';
import type { EditMode, SessionState } from './session';
export interface DisplayInfo { id: number; label: string; width: number; height: number; primary: boolean }
export interface OutputState { open: boolean; fullscreen: boolean; displayId: number | null; blackout: boolean; disconnected: boolean }
export interface Transport { playing: boolean; position: number; anchor: number; revision: number }
export interface Snapshot {
  session: SessionState; displays: DisplayInfo[]; output: OutputState; transport: Transport;
  assets: Record<string, { url: string; missing: boolean }>; setups: string[];
}
export type Request =
  | { type: 'command'; command: Command }
  | { type: 'undo' | 'redo' | 'discard' | 'save' | 'apply' | 'import' | 'open' | 'export' }
  | { type: 'mode'; mode: EditMode; resolution?: 'apply' | 'discard' | 'cancel' }
  | { type: 'output'; displayId: number; fullscreen: boolean }
  | { type: 'blackout'; value: boolean }
  | { type: 'transport'; playing: boolean; position?: number }
  | { type: 'relink'; assetId: string }
  | { type: 'setup.save'; name: string }
  | { type: 'setup.load'; name: string };
export interface Bridge {
  snapshot(): Promise<Snapshot>;
  request(request: Request): Promise<{ ok: boolean; error?: string; sources?: Source[] }>;
  subscribe(callback: (snapshot: Snapshot) => void): () => void;
}
export interface MediaProbe {
  sourceId: string; kind: Source['kind']; generation: number; error: string;
  currentTime: number | null; paused: boolean | null; readyState: number | null; droppedFrames: number | null;
}
/** Read-only renderer measurements for diagnostics and automated qualification. */
export interface RendererProbe { frames: number; slowFrames: number; maxIntervalMs: number; intervals: number[]; media: MediaProbe[] }
declare global { interface Window { hector?: Bridge; hectorProbe?: () => RendererProbe | null } }
export type ProjectDocument = { scene: Scene; assets: Record<string, string> };
