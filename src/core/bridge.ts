import type { Command, Scene, Source } from './model';
import type { EditMode, SessionState } from './session';
import type { PlayerStatus } from './youtube';
export interface DisplayInfo { id: number; label: string; width: number; height: number; primary: boolean }
export interface OutputState {
  open: boolean; fullscreen: boolean; displayId: number | null; blackout: boolean; disconnected: boolean;
  /** Media/capture problems reported by the output renderer (bounded, rate-limited). */
  errors: string[];
}
export interface Transport { playing: boolean; position: number; anchor: number; revision: number }
/** A live screen/window grant. The OS source id stays in main. */
export interface CaptureGrant { name: string; kind: 'screen' | 'window' }
export interface CaptureChoice { id: string; name: string; kind: 'screen' | 'window'; thumbnail: string; outputDisplay: boolean }
export type CaptureAccess = 'granted' | 'denied' | 'restricted' | 'not-determined' | 'not-required' | 'unknown';
export interface Snapshot {
  session: SessionState; displays: DisplayInfo[]; output: OutputState; transport: Transport;
  assets: Record<string, { url: string; missing: boolean }>; captures: Record<string, CaptureGrant>;
  /** YouTube player windows, keyed by playerKey(source). */
  players: Record<string, PlayerStatus>; setups: string[];
  platform: string; captureAccess: CaptureAccess;
}
export type Request = (
  | { type: 'command'; command: Command }
  | { type: 'undo' | 'redo' | 'discard' | 'save' | 'apply' | 'import' | 'open' | 'export' | 'capture.sources' }
  | { type: 'mode'; mode: EditMode; resolution?: 'apply' | 'discard' | 'cancel' }
  | { type: 'output'; displayId: number; fullscreen: boolean }
  | { type: 'blackout'; value: boolean }
  | { type: 'transport'; playing: boolean; position?: number }
  | { type: 'relink'; assetId: string }
  | { type: 'capture.add'; sourceId: string; replace?: string }
  | { type: 'youtube.add'; link: string }
  | { type: 'youtube.reload' | 'youtube.show'; sourceId: string }
  | { type: 'setup.save'; name: string }
  | { type: 'setup.load'; name: string }) & { /** Studio-only: persist and publish this edit. */ autoSave?: boolean };
export interface RequestResult { ok: boolean; error?: string; choices?: CaptureChoice[] }
export interface Bridge {
  snapshot(): Promise<Snapshot>;
  request(request: Request): Promise<RequestResult>;
  subscribe(callback: (snapshot: Snapshot) => void): () => void;
  /** Ask main to hand this window the granted capture on its next getDisplayMedia call. */
  armCapture(captureId: string): Promise<{ ok: boolean; error?: string }>;
  /** Output only: report renderer-side media problems so the studio can show them. */
  report(status: { errors: string[] }): void;
}
export interface MediaProbe {
  sourceId: string; kind: Source['kind']; generation: number; error: string;
  currentTime: number | null; duration: number | null; paused: boolean | null; ended: boolean | null; readyState: number | null;
  playbackRate: number | null; loop: boolean | null; muted: boolean | null; volume: number | null;
  droppedFrames: number | null; totalFrames: number | null; width: number; height: number; live: boolean | null;
}
/** Read-only renderer measurements for diagnostics and automated qualification. */
/** Ambient backlight measurements for one lit surface in one renderer. */
export interface AmbientProbe { surfaceId: string; samples: number; analysisMs: number; fieldMs: number; dark: boolean; sampleAgeMs: number | null; alpha: number; asyncReadback: boolean; worker: boolean }
export interface RendererProbe { frames: number; slowFrames: number; maxIntervalMs: number; intervals: number[]; media: MediaProbe[]; ambient: AmbientProbe[] }
/** Opt-in timing trace; all times are performance.now() milliseconds in the renderer. */
export interface FrameTrace {
  start: number; end: number;
  /** requestAnimationFrame timestamps of the render loop. */
  raf: number[];
  /** Decoded frames handed to the renderer (requestVideoFrameCallback). */
  frames: { source: string; now: number; mediaTime: number; presented: number; presentationTime: number; expectedDisplayTime: number }[];
  /** GPU texture uploads of new frames; age = upload time − the frame's presentationTime. */
  uploads: { source: string; now: number; mediaTime: number; age: number }[];
  /** getVideoPlaybackQuality samples, every 250 ms. */
  quality: { source: string; now: number; total: number; dropped: number }[];
  /** Media lifecycle events (load, seeking, seeked, waiting, playing, ended, update). */
  events: { source: string; now: number; type: string }[];
}
export interface ProbeApi { snapshot(): RendererProbe; startTrace(): void; stopTrace(): FrameTrace | null }
declare global { interface Window { hector?: Bridge; hectorProbe?: ProbeApi } }
export type ProjectDocument = { scene: Scene; assets: Record<string, string> };
