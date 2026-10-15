import React, { Profiler } from 'react';
import { createRoot } from 'react-dom/client';
import { initialScene, reduceScene } from '../src/shared/domain';
import type { Snapshot } from '../src/shared/bridge';
import '../src/styles.css';

// Real Studio with an in-memory bridge. No browser scene store, worker or AI.
let scene = reduceScene(initialScene(), { type: 'effect.set', enabled: false });
scene = reduceScene(scene, { type: 'timer.create', id: 'audit-timer', title: 'Scheduling fixture', durationMs: 2000 });
const listeners = new Set<(snapshot: Snapshot) => void>();
const snapshot = (): Snapshot => ({ scene, saveStatus: 'saved', saveError: null, storage: 'browser', displays: [], output: { open: false, fullscreen: false, displayId: null } });
window.projection = {
  getSnapshot: async () => snapshot(),
  subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  output: async () => {},
  dispatch: async command => { scene = reduceScene(scene, command); listeners.forEach(fn => fn(snapshot())); return { ok: true, scene }; },
};
window.projectionChat = { getState: async () => ({ ready: true, busy: false, configurationError: null, progress: null, messages: [] }), subscribe: () => () => {}, send: async () => {}, cancel: async () => {}, clear: async () => {} };
const { SpatialStudio } = await import('../src/SpatialStudio');
let commits = 0;
const root = createRoot(document.getElementById('root')!);
root.render(<Profiler id="studio" onRender={() => commits++}><SpatialStudio /></Profiler>);
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
await wait(800);
const beforeIdle = commits; await wait(1000); const idleCommits = commits - beforeIdle;
await window.projection.dispatch({ type: 'timer.action', id: 'audit-timer', action: 'start' });
await wait(100); const beforeRunning = commits; await wait(900); const runningCommits = commits - beforeRunning;
await wait(1600); const beforeExpired = commits; await wait(800); const expiredCommits = commits - beforeExpired;
const result = { passed: idleCommits === 0 && runningCommits >= 3 && expiredCommits === 0, idleCommits, runningCommits, expiredCommits, storage: 'in-memory only', media: 'none' };
document.getElementById('results')!.textContent = JSON.stringify(result, null, 2);
window.addEventListener('beforeunload', () => root.unmount());
