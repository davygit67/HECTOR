import { validateRoomReference, type RoomReference } from './shared/roomModel';

let current: RoomReference | null = null, revision = 0;
let loading: Promise<RoomReference | null> | undefined;
const listeners = new Set<() => void>();
const channel = new BroadcastChannel('projection-mapper.fixed-room.v1');
channel.onmessage = () => { loading = undefined; void loadRoomReference().catch(() => { publish(null); }); };
export const getRoomReference = () => current;
export const roomReferenceRevision = () => revision;
export function subscribeRoomReference(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
function publish(r: RoomReference | null) { current = r; revision++; listeners.forEach(fn => fn()); }
async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('projection-mapper.fixed-room.v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('room');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Room storage is unavailable on this browser.'));
  });
}
export function loadRoomReference() {
  return loading ??= (async () => {
    const startRevision = revision, db = await database();
    try {
      const result = await new Promise<RoomReference | undefined>((resolve, reject) => {
        const request = db.transaction('room').objectStore('room').get('reference');
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      if (result) validateRoomReference(result);
      if (revision === startRevision) publish(result ?? null);
      return current;
    } finally { db.close(); }
  })();
}
export async function saveRoomReference(reference: RoomReference | null) {
  if (reference) validateRoomReference(reference);
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('room', 'readwrite');
      if (reference) tx.objectStore('room').put(reference, 'reference'); else tx.objectStore('room').delete('reference');
      tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(new Error('Room reference could not be saved. Previous reference retained.'));
    });
    publish(reference);
    channel.postMessage('reference-changed');
  } finally { db.close(); }
}
/** Compare-and-invalidate avoids a delayed observation retiring a newer room capture. */
export async function invalidateRoomReference(id: string, reason: 'moved' | 'different-sensor') {
  const db = await database();
  try {
    let updated: RoomReference | undefined;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('room', 'readwrite'), store = tx.objectStore('room'), request = store.get('reference');
      request.onsuccess = () => {
        const value = request.result as RoomReference | undefined;
        if (value?.id === id && !value.invalidated) { updated = { ...value, invalidated: reason }; store.put(updated, 'reference'); }
      };
      tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(new Error('Movement was detected but its warning could not be saved. Capture a new room before mapping.'));
    });
    if (updated && current?.id === id) { publish(updated); channel.postMessage('reference-changed'); }
  } finally { db.close(); }
}
