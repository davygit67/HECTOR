import { decodeSensorSession, encodeSensorSession, type SensorSession } from './shared/sensor';

export interface SessionSummary { id: string; name: string; createdAtMs: number; provenance: SensorSession['provenance']; kind: SensorSession['kind']; status: SensorSession['status']; frames: number; bytes: number }
let database: Promise<IDBDatabase> | null = null;
function open() {
  return database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('projection-mapper.sensor-sessions.v1', 1);
    request.onupgradeneeded = () => { request.result.createObjectStore('sessions'); request.result.createObjectStore('summaries', { keyPath: 'id' }); };
    request.onerror = () => { database = null; reject(new Error('Local recording storage is unavailable. Download recordings to keep them.')); };
    request.onsuccess = () => resolve(request.result);
  });
}
function result<T>(request: IDBRequest<T>): Promise<T> { return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
function completed(tx: IDBTransaction) { return new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(new Error('Recording could not be saved locally. Download it before leaving this page.')); }); }
export async function listSensorSessions(): Promise<SessionSummary[]> {
  const db = await open(); return (await result(db.transaction('summaries').objectStore('summaries').getAll()) as SessionSummary[]).sort((a, b) => b.createdAtMs - a.createdAtMs);
}
export async function saveSensorSession(session: SensorSession) {
  const bytes = encodeSensorSession(session), previous = await listSensorSessions();
  if (previous.filter(s => s.id !== session.id).length >= 12 || previous.filter(s => s.id !== session.id).reduce((sum, s) => sum + s.bytes, 0) + bytes.length > 768 * 1024 * 1024) {
    throw new Error('The local recording library is full. Download this recording, then delete an older one to make room.');
  }
  const db = await open(), tx = db.transaction(['sessions', 'summaries'], 'readwrite'), done = completed(tx);
  tx.objectStore('sessions').put(bytes.buffer, session.id);
  const summary: SessionSummary = { id: session.id, name: session.name, createdAtMs: session.createdAtMs, provenance: session.provenance, kind: session.kind, status: session.status, frames: session.frames.length, bytes: bytes.length };
  tx.objectStore('summaries').put(summary); await done;
}
export async function loadSensorSession(id: string): Promise<SensorSession> {
  const db = await open(), bytes = await result(db.transaction('sessions').objectStore('sessions').get(id));
  if (!(bytes instanceof ArrayBuffer)) throw new Error('This recording is no longer available.');
  return decodeSensorSession(new Uint8Array(bytes));
}
export async function deleteSensorSession(id: string) {
  const db = await open(), tx = db.transaction(['sessions', 'summaries'], 'readwrite'), done = completed(tx);
  tx.objectStore('sessions').delete(id); tx.objectStore('summaries').delete(id); await done;
}
export function downloadSensorSession(session: SensorSession) {
  const data = encodeSensorSession(session), blob = new Blob([data.buffer as ArrayBuffer], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = url; anchor.download = session.name.replace(/[^a-z0-9_-]+/gi, '-').slice(0, 100) + '.pmsession';
  anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
