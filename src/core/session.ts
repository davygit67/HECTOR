import { equal, initialScene, reduceScene, sceneSchema, type Scene } from './model';

export type EditMode = 'live' | 'preview';
export interface SessionState {
  draft: Scene; applied: Scene; saved: Scene | null; mode: EditMode;
  canUndo: boolean; canRedo: boolean; unsaved: boolean; unapplied: boolean; busy: boolean;
}
/** Main-process authority. All mutations (including AI) must pass through here. */
export class SceneSession {
  draft: Scene; applied: Scene; saved: Scene | null = null;
  mode: EditMode = 'preview'; busy = false;
  private past: Scene[] = []; private future: Scene[] = [];
  constructor(scene = initialScene(), private persist: (scene: Scene) => Promise<void> = async () => {}) {
    this.draft = sceneSchema.parse(scene); this.applied = structuredClone(this.draft);
  }
  snapshot(): SessionState {
    return structuredClone({ draft: this.draft, applied: this.applied, saved: this.saved, mode: this.mode,
      canUndo: !!this.past.length, canRedo: !!this.future.length, unsaved: !this.saved || !equal(this.draft, this.saved),
      unapplied: !equal(this.draft, this.applied), busy: this.busy });
  }
  private editable() { if (this.busy) throw new Error('A project operation is in progress.'); }
  private update(next: Scene) {
    this.editable(); if (equal(next, this.draft)) return;
    this.past.push(this.draft); if (this.past.length > 100) this.past.shift(); this.future = [];
    this.draft = next; if (this.mode === 'live') this.applied = structuredClone(next);
  }
  /** Every scene that output, Save, or undo/redo can still reach. Asset grants must outlive all of them. */
  reachableScenes(): Scene[] { return [this.draft, this.applied, ...(this.saved ? [this.saved] : []), ...this.past, ...this.future]; }
  command(raw: unknown) { this.update(reduceScene(this.draft, raw)); }
  stage(scene: unknown) { this.update(sceneSchema.parse(scene)); }
  undo() {
    this.editable(); const next = this.past.pop(); if (!next) return;
    this.future.push(this.draft); this.draft = next; if (this.mode === 'live') this.applied = structuredClone(next);
  }
  redo() {
    this.editable(); const next = this.future.pop(); if (!next) return;
    this.past.push(this.draft); this.draft = next; if (this.mode === 'live') this.applied = structuredClone(next);
  }
  discard() { this.editable(); this.draft = structuredClone(this.applied); this.past = []; this.future = []; }
  async save(apply = false) {
    this.editable(); const next = sceneSchema.parse(this.draft); this.busy = true;
    try { await this.persist(next); this.saved = structuredClone(next); if (apply) this.applied = structuredClone(next); }
    finally { this.busy = false; }
  }
  async switchMode(mode: EditMode, resolution?: 'apply' | 'discard' | 'cancel') {
    this.editable();
    if (mode === 'live' && !equal(this.draft, this.applied)) {
      if (!resolution || resolution === 'cancel') return false;
      if (resolution === 'apply') await this.save(true); else this.discard();
    }
    this.mode = mode; return true;
  }
}
