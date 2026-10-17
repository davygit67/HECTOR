import type { Command } from './domain.js';
import type { Snapshot, OutputCommand } from './bridge.js';
import type { MediaCommand, MediaState } from './media.js';

export type StudioView = 'room' | 'arrange' | 'align';
export type StudioInspector = 'assistant' | 'surface' | 'content' | 'projectors' | 'viewer';
export interface StudioUI { page: 'studio' | 'hardware'; view: StudioView; inspector: StudioInspector; fullscreen: boolean; coverage?: boolean; previews?: boolean; interact?: boolean }
export type HardwareAction =
  | { action: 'connect-demo' | 'connect-live' | 'disconnect' | 'stop-recording' | 'pause-replay' | 'play-replay' | 'capture' | 'cancel-capture' | 'clear-pattern' }
  | { action: 'record'; seconds?: number }
  | { action: 'open-session'; id: string }
  | { action: 'pattern'; pattern: 'white' | 'black' | 'grid' }
  | { action: 'configure'; settings: { address?: string; resolution?: '1920x1080' | '1280x720' | '640x480'; sequence?: 'checks' | 'gray'; settleMs?: 150 | 300 | 750 | 1500; outputTarget?: 'demo' | 'output'; replayRate?: .25 | 1 | 2; replayIndex?: number } }
  | { action: 'import-session' | 'download-session' }
  | { action: 'remove-session'; id: string };
export interface HardwareStatus {
  initialized: boolean; mode: 'demo' | 'live' | 'replay'; connection: string;
  message: string; provenance: 'synthetic' | 'sensor' | 'replay' | 'unknown';
  busy: boolean; canAcquire: boolean; frames: number; recording: boolean; capturing: boolean;
  sessions: { id: string; name: string; provenance: string; frames: number }[];
  geometrySolved: false;
  settings?: Extract<HardwareAction, { action: 'configure' }>['settings'];
}
export interface CompositionSummary { id: string; name: string; updatedAt: number; assets: number }
export interface StudioSnapshot {
  roomId: string; sceneRevision: number; geometryRevision: number; ui: StudioUI;
  output: Snapshot['output']; saveStatus: Snapshot['saveStatus']; saveError: string | null;
  media: (Omit<Partial<MediaState>, 'source'> & { contentId: string; source: string; ready: boolean; status: string; frameReady?: boolean })[];
  assets: { id: string; title: string; kind: string; surfaceId: string; ready?: boolean }[];
  compositions: CompositionSummary[]; hardware: HardwareStatus;
  capabilities: { sceneBatch: boolean; observation: boolean; nativeMedia: boolean; nativeOutput: boolean; fileImportRequiresClick: true; physicalObservation: false };
}
export type StudioOperation =
  | { type: 'ui.navigate'; page: StudioUI['page']; view?: StudioView; inspector?: StudioInspector }
  | { type: 'ui.configure'; coverage?: boolean; previews?: boolean; interact?: boolean; resetView?: boolean; expandedAssetId?: string | null }
  | { type: 'output.command'; command: OutputCommand }
  | { type: 'media.command'; command: MediaCommand }
  | { type: 'asset.import' }
  | { type: 'presentation'; mode: 'align' | 'project' | 'exit' }
  | { type: 'composition.save'; name: string }
  | { type: 'composition.recall' | 'composition.remove'; id: string }
  | { type: 'hardware.action'; command: HardwareAction }
  | { type: 'scene.batch'; commands: Command[]; expectedRevision: number };
export interface StudioResult { ok: boolean; outcome: 'applied' | 'handoff' | 'failed'; message: string; sceneRevision: number; value?: unknown }
export interface StudioObserveRequest { surfaceId?: string; maxWidth?: number }
export interface StudioObservation {
  sceneRevision: number; geometryRevision: number; at: number; kind: 'rendered-surface'; physical: false;
  surfaceId: string; stale: boolean;
  image: { mimeType: 'image/png'; data: string; width: number; height: number } | null;
  runtime: StudioSnapshot; limitations: string[];
}
export interface StudioPort {
  inspect(): Promise<StudioSnapshot>;
  execute(operation: StudioOperation): Promise<StudioResult>;
  observe(request: StudioObserveRequest): Promise<StudioObservation>;
}
/** Same shape as the agent-owned memory store; kept dependency-free for renderer/IPC. */
export interface MemoryEntry {
  id: string; kind: 'preference' | 'example'; text: string; roomId: string; activity?: string; surfaceId?: string;
  source: 'explicit' | 'observed'; confidence: 'explicit' | 'tentative'; updatedAt: number;
}
export interface AdjustmentEvent {
  id: string; actor: 'user' | 'agent' | 'system'; roomId: string; revision: number; geometryRevision: number;
  at: number; operation: string; targetId?: string; surfaceId?: string; activity?: string; before: unknown; after: unknown;
}
export interface MemoryState { entries: MemoryEntry[]; events: AdjustmentEvent[]; enabled: boolean }
export type MemoryRequest = { action: 'list' | 'clear' } | { action: 'remove'; id: string }
  | { action: 'setEnabled'; enabled: boolean }
  | { action: 'put'; entry: Pick<MemoryEntry, 'kind' | 'text' | 'roomId' | 'activity' | 'surfaceId'> & { id?: string } }
  | { action: 'record'; event: AdjustmentEvent };
export interface AgentMemory {
  list(): Promise<MemoryState>; put(entry: Extract<MemoryRequest, { action: 'put' }>['entry']): Promise<MemoryEntry>;
  remove(id: string): Promise<void>; clear(): Promise<void>; setEnabled(enabled: boolean): Promise<void>; record(event: AdjustmentEvent): Promise<void>;
}
export type StudioRpc = { operation: 'studio.inspect' } | { operation: 'studio.execute'; request: StudioOperation } | { operation: 'studio.observe'; request: StudioObserveRequest };
export const ROOM_ID = 'local-room';
