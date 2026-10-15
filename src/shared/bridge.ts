import type { Command, Scene } from './domain.js';
export interface DisplayInfo { id: string; label: string; width: number; height: number; scale: number; primary: boolean }
export interface Snapshot {
  scene: Scene; saveStatus: 'saved' | 'saving' | 'error'; saveError: string | null;
  storage: 'disk' | 'browser'; displays: DisplayInfo[];
  output: { open: boolean; fullscreen: boolean; displayId: string | null };
}
export type OutputCommand = { action: 'open' | 'fullscreen' | 'windowed'; displayId?: string };
/** The accepted scene includes placements resolved by the canvas, not guessed by a caller. */
export type CommandReceipt = { ok: true; scene: Scene } | { ok: false; error: string };
export interface Bridge {
  getSnapshot(): Promise<Snapshot>;
  dispatch(command: Command): Promise<CommandReceipt>;
  output(command: OutputCommand): Promise<void>;
  subscribe(listener: (snapshot: Snapshot) => void): () => void;
}
