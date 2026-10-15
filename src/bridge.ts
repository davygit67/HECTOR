import { initialScene, readScene, reduceScene } from './shared/domain';
import type { Bridge, Snapshot } from './shared/bridge';
import { isOutputCalibrationCommand } from './shared/outputPermissions';

declare global { interface Window { projection?: Bridge } }

/** The browser preview uses the same commands and geometry; Electron owns production state. */
function browserBridge(): Bridge {
  const key = 'projection-mapper.scene.v3';
  const legacyKey = 'projection-mapper.scene.v2';
  let scene = initialScene();
  let error: string | null = null;
  let lastSavedRaw: string | null = null;
  try {
    const raw = localStorage.getItem(key) ?? localStorage.getItem(legacyKey) ?? localStorage.getItem('projection-mapper.scene.v1');
    if (raw) scene = readScene(JSON.parse(raw));
    lastSavedRaw = JSON.stringify(scene);
    localStorage.setItem(key, lastSavedRaw);
  }
  catch { error = 'Browser save could not be restored. A new preview was opened.'; }
  let outputWindow: Window | null = null;
  const listeners = new Set<(s: Snapshot) => void>();
  const channel = new BroadcastChannel('projection-mapper-v3');
  const get = (): Snapshot => ({ scene: structuredClone(scene), saveStatus: error ? 'error' : 'saved', saveError: error, storage: 'browser', displays: [],
    output: { open: !!outputWindow && !outputWindow.closed, fullscreen: false, displayId: null } });
  const emit = () => listeners.forEach(fn => fn(get()));
  const refresh = () => {
    try { const raw = localStorage.getItem(key); if (raw && raw !== lastSavedRaw) { scene = readScene(JSON.parse(raw)); lastSavedRaw = raw; error = null; emit(); } }
    catch { error = 'Browser save could not be read.'; emit(); }
  };
  channel.onmessage = refresh;
  window.addEventListener('storage', event => { if (event.key === key) refresh(); });
  return {
    getSnapshot: async () => get(),
    dispatch: async command => {
      if (new URLSearchParams(location.search).get('view') === 'output' && !isOutputCalibrationCommand(command)) return { ok: false, error: 'Use the studio to edit content. This window can adjust manual alignment.' };
      try {
        // Rebase synchronous edits on the latest persisted scene if another studio tab is open.
        const raw = localStorage.getItem(key); if (raw && raw !== lastSavedRaw) { scene = readScene(JSON.parse(raw)); lastSavedRaw = raw; }
        scene = reduceScene(scene, command);
        try { const saved = JSON.stringify(scene); localStorage.setItem(key, saved); lastSavedRaw = saved; error = null; }
        catch { error = 'Browser storage is full or unavailable; this layout is not saved.'; }
        channel.postMessage('changed'); emit(); return { ok: true, scene: structuredClone(scene) };
      } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
    },
    output: async () => {
      outputWindow = window.open(`${location.origin}${location.pathname}?view=output`, 'projection-output', 'width=960,height=540');
      if (!outputWindow) throw new Error('Allow popups to open the projection preview.');
      emit();
    },
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}

export const bridge = window.projection ?? browserBridge();
