import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';

const entrySchema = z.object({
  id: z.string().min(1).max(100), kind: z.enum(['preference', 'example']), text: z.string().trim().min(1).max(3000),
  roomId: z.string().min(1).max(100), activity: z.string().max(100).optional(), surfaceId: z.string().max(100).optional(),
  source: z.enum(['explicit', 'observed']), confidence: z.enum(['explicit', 'tentative']), updatedAt: z.number().finite(),
  geometryRevision: z.number().int().nonnegative().optional(),
  evidence: z.object({ operation: z.string().max(100), targetId: z.string().max(100).optional(), settings: z.record(z.string(), z.unknown()) }).optional(),
});
const eventSchema = z.object({
  id: z.string().min(1).max(100), actor: z.enum(['user', 'agent', 'system']), roomId: z.string().min(1).max(100),
  revision: z.number().int().nonnegative(), geometryRevision: z.number().int().nonnegative(), at: z.number().finite(),
  operation: z.string().min(1).max(100), targetId: z.string().max(100).optional(), surfaceId: z.string().max(100).optional(),
  activity: z.string().max(100).optional(), before: z.unknown(), after: z.unknown(),
});
export type MemoryEntry = z.infer<typeof entrySchema>;
export type AdjustmentEvent = z.infer<typeof eventSchema>;
export type MemoryInput = Pick<MemoryEntry, 'kind' | 'text' | 'roomId' | 'activity' | 'surfaceId'> & { id?: string };
const stateSchema = z.object({ version: z.literal(1), enabled: z.boolean(), entries: z.array(entrySchema).max(200), events: z.array(eventSchema).max(100) });
type MemoryState = z.infer<typeof stateSchema>;
const empty = (): MemoryState => ({ version: 1, enabled: true, entries: [], events: [] });
const learnable = new Set(['content.move', 'timer.move', 'layer.configure', 'layer.reorder', 'display.configure',
  'media.configure', 'youtube.backlight', 'youtube.backlight.configure', 'content.update', 'timer.update']);

/** Values from the interface are evidence, never executable instructions. Exclude paths/credentials and cap size. */
function boundedEvidence(value: unknown): unknown {
  const raw = JSON.stringify(value ?? null, (key, item) => /password|secret|token|apiKey|path|dataUrl|jpeg|base64/i.test(key) ? undefined : item);
  if (!raw || raw.length > 12000) throw new Error('Adjustment evidence is too large. Send the changed item/settings only.');
  return JSON.parse(raw);
}

export interface MemoryStore {
  persistent: boolean;
  list(): Promise<{ entries: MemoryEntry[]; events: AdjustmentEvent[]; enabled: boolean }>;
  put(input: MemoryInput): Promise<MemoryEntry>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
  setEnabled(enabled: boolean): Promise<void>;
  record(input: AdjustmentEvent): Promise<void>;
  recall(query: { prompt: string; roomId: string; geometryRevision: number; surfaceId?: string; activity?: string }): Promise<MemoryEntry[]>;
}
// Development hosts cache-bust agent bundles while older conversations may remain open.
// All builds with this storage contract share one writer in the owning process.
const registry = globalThis as unknown as Record<symbol, Map<string, MemoryStore> | undefined>;
const fileStores = registry[Symbol.for('projection-mapper.agent-memory.v1')] ??= new Map<string, MemoryStore>();

function observedStyle(event: AdjustmentEvent): { text: string; evidence: NonNullable<MemoryEntry['evidence']> } | null {
  const object = (v: unknown): Record<string, any> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : {};
  const before = object(event.before), after = object(event.after);
  let previous = before, next = after;
  const label = String(after.title ?? event.targetId ?? 'the display').slice(0, 60);
  if (event.operation.endsWith('.move')) { previous = object(before.bounds ?? before); next = object(after.bounds ?? after); }
  else if (event.operation.startsWith('layer.')) { previous = object(before.layer); next = object(after.layer); }
  else if (event.operation === 'content.update' || event.operation.startsWith('youtube.backlight')) { previous = object(before.config ?? before); next = object(after.config ?? after); }
  const allowed = new Set(['x','y','w','h','visible','locked','opacity','order','quality','brightness','blackout','durationMs',
    'preset','palette','speed','seed','backlight','backlightSettings','fit','loop','playbackRate','volume','muted','rotation','flipX','flipY','contrast','saturation','accent',
    'intensity','spread','smoothingMs','toneProfile','vibrance','roomFill']);
  const settings = Object.fromEntries(Object.entries(next).filter(([key, value]) => allowed.has(key) && JSON.stringify(value) !== JSON.stringify(previous[key])));
  if (!Object.keys(settings).length || JSON.stringify(settings).length > 2000) return null;
  const terms: Record<string, string> = { x:'left', y:'top', w:'width', h:'height', roomFill:'room fill', toneProfile:'tone', smoothingMs:'smoothing', playbackRate:'playback speed', durationMs:'duration' };
  const readable = Object.entries(settings).flatMap(([key, value]) => {
    if (key === 'backlightSettings' && value && typeof value === 'object') return Object.entries(value).map(([k,v]) => `${terms[k] ?? k}: ${v}`);
    const val = typeof value === 'boolean' ? value ? 'on' : 'off' : typeof value === 'number' && ['x','y','w','h','opacity','brightness','vibrance','roomFill','volume'].includes(key) ? `${Math.round(value * 100)}%` : String(value);
    return [`${terms[key] ?? key}: ${val}`];
  }).join(', ');
  return { text: `You adjusted ${label}${event.surfaceId ? ` on ${event.surfaceId}` : ''}: ${readable}.`, evidence: { operation: event.operation, targetId: event.targetId, settings } };
}

/** One host owns each file. Writes are serialized and atomic; failed writes never replace accepted memory. */
export function createMemoryStore(path?: string): MemoryStore {
  if (path) {
    path = resolve(path);
    const existing = fileStores.get(path);
    if (existing) return existing;
  }
  let state: MemoryState | undefined;
  let queue: Promise<unknown> = Promise.resolve();
  async function load() {
    if (state) return state;
    if (!path) return state = empty();
    try {
      const data = await readFile(path, 'utf8');
      if (data.length > 4_000_000) throw new Error('Memory file is too large.');
      return state = stateSchema.parse(JSON.parse(data));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return state = empty();
      throw new Error('Saved learning memory could not be read. It has been preserved; repair or remove it locally to continue.');
    }
  }
  function serialized<T>(run: () => Promise<T>): Promise<T> {
    const result = queue.then(run); queue = result.catch(() => undefined); return result;
  }
  function change<T>(update: (next: MemoryState) => T) {
    return serialized(async () => {
      const next = structuredClone(await load());
      const result = update(next);
      if (path) {
        await mkdir(dirname(path), { recursive: true });
        const temporary = `${path}.tmp`;
        await writeFile(temporary, JSON.stringify(next), { mode: 0o600 });
        await rename(temporary, path);
      }
      state = next;
      return structuredClone(result);
    });
  }
  const api = {
    persistent: !!path,
    list: () => serialized(async () => { const s = await load(); return structuredClone({ entries: s.entries, events: s.events, enabled: s.enabled }); }),
    put: (input: MemoryInput) => change(s => {
      const entry = entrySchema.parse({ ...input, id: input.id ?? randomUUID(), source: 'explicit', confidence: 'explicit', updatedAt: Date.now() });
      const index = s.entries.findIndex(e => e.id === entry.id);
      if (index >= 0) s.entries[index] = entry;
      else {
        if (s.entries.length >= 200) {
          const replace = s.entries.findIndex(e => e.source === 'observed');
          if (replace < 0) throw new Error('Memory is full. Remove an old preference first.');
          s.entries.splice(replace, 1);
        }
        s.entries.push(entry);
      }
      return entry;
    }),
    remove: (id: string) => change(s => { s.entries = s.entries.filter(e => e.id !== id); }),
    clear: () => change(s => { s.entries = []; s.events = []; }),
    setEnabled: (enabled: boolean) => change(s => { if (typeof enabled !== 'boolean') throw new Error('Invalid learning switch.'); s.enabled = enabled; }),
    record: (input: AdjustmentEvent) => change(s => {
      if (!s.enabled) return;
      const event = eventSchema.parse({ ...input, before: boundedEvidence(input.before), after: boundedEvidence(input.after) });
      if (event.actor !== 'user' || s.events.some(e => e.id === event.id) || JSON.stringify(event.before) === JSON.stringify(event.after)) return;
      s.events.push(event); s.events = s.events.slice(-100);
      // Geometry is authoritative setup state, never a learned preference. Only completed aesthetic edits create examples.
      if (!learnable.has(event.operation)) return;
      const style = observedStyle(event);
      if (!style) return;
      const signature = `observed:${event.roomId}:${event.surfaceId ?? ''}:${event.activity ?? ''}:${event.operation}:${event.targetId ?? ''}`;
      const observedId = `observed-${createHash('sha256').update(signature).digest('hex').slice(0, 32)}`;
      const previous = s.entries.find(e => e.id === observedId);
      const entry: MemoryEntry = {
        id: observedId, kind: 'example', text: style.text, evidence: style.evidence,
        roomId: event.roomId, surfaceId: event.surfaceId, activity: event.activity, source: 'observed', confidence: 'tentative',
        geometryRevision: event.geometryRevision, updatedAt: event.at,
      };
      if (previous) s.entries[s.entries.indexOf(previous)] = entry;
      else if (s.entries.length < 200) s.entries.push(entry);
      else { const index = s.entries.findIndex(e => e.source === 'observed'); if (index >= 0) { s.entries.splice(index, 1); s.entries.push(entry); } }
    }),
    recall: (query: { prompt: string; roomId: string; geometryRevision: number; surfaceId?: string; activity?: string }) => serialized(async () => {
      const s = await load(); if (!s.enabled) return [];
      const words = new Set(query.prompt.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);
      return s.entries.filter(e => (e.roomId === query.roomId || e.roomId === '*') &&
        (!e.surfaceId || e.surfaceId === query.surfaceId || query.prompt.toLowerCase().includes(e.surfaceId.toLowerCase())) &&
        (!e.activity || e.activity === query.activity || query.prompt.toLowerCase().includes(e.activity.toLowerCase())) &&
        (e.geometryRevision === undefined || e.geometryRevision === query.geometryRevision))
        .map(e => ({ e, score: (e.source === 'explicit' ? 3 : 0) + [...words].filter(w => e.text.toLowerCase().includes(w)).length }))
        .filter(({ e, score }) => e.source === 'explicit' || score > 0)
        .sort((a, b) => b.score - a.score || b.e.updatedAt - a.e.updatedAt).slice(0, 6).map(({ e }) => structuredClone(e));
    }),
  };
  if (path) fileStores.set(path, api);
  return api;
}
