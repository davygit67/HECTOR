import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { localAgentEnvironment } from './chat-controller.js';
import type { ChatOutcome } from '../src/shared/chat.js';
import type { CloudRelayAction, CloudRelayState } from '../src/shared/cloudRelay.js';
import type { ProjectionDelivery, ProjectionDeliveryReceipt, ProjectionRelayStatus, ProjectionRelayWorker, ProjectionRelayWorkerOptions } from '../agent/src/relay/types.js';

interface Target {
  /** Synchronous check; deliver must take the same room lock before its first await. */
  ready(): boolean;
  deliver(prompt: string): Promise<ChatOutcome>;
  cancel(): void;
}
interface Configuration { url: string; token: string; deviceId: string }
interface Loaded { config: Configuration; createWorker(options: ProjectionRelayWorkerOptions): ProjectionRelayWorker }
export type CloudReceiverLoader = () => Promise<Loaded | null>;

export function localCloudReceiverLoader(root: string): CloudReceiverLoader {
  return async () => {
    const env = localAgentEnvironment(root);
    if (![env.PROJECTION_RELAY_URL, env.PROJECTION_RELAY_DEVICE_TOKEN, env.PROJECTION_RELAY_DEVICE_ID].some(v => v?.trim())) return null;
    const bundle = join(root, 'agent/dist/index.js');
    if (!existsSync(bundle)) throw new Error('Agent bundle unavailable.');
    const module = await import(pathToFileURL(bundle).href + '?build=' + statSync(bundle).mtimeMs);
    if (typeof module.createProjectionRelayWorker !== 'function' || typeof module.readProjectionRelayConfig !== 'function') throw new Error('Updated agent bundle required.');
    const config = module.readProjectionRelayConfig(env) as Configuration | null;
    return config && { config, createWorker: module.createProjectionRelayWorker };
  };
}

/** One opted-in Studio per host. The worker owns network delivery and its private journal. */
export function createCloudReceiver(load: CloudReceiverLoader, privateDirectory: string) {
  const targets = new Map<string, Target>();
  let loaded: Loaded | null = null, owner: string | null = null, paused = true, disposed = false;
  let worker: ProjectionRelayWorker | null = null, stopping: Promise<void> | null = null, loading: Promise<void> | null = null;
  let status: ProjectionRelayStatus = { phase: 'stopped', message: '' };
  let issue = '', lastReceipt: CloudRelayState['lastReceipt'];
  let active: { entry: Target; started: boolean; stopped: boolean } | null = null;
  const canReceive = () => !disposed && !paused && !!owner && !!targets.get(owner)?.ready();
  const cancelActive = () => { if (active && !active.stopped) { active.stopped = true; if (active.started) active.entry.cancel(); } };
  async function configure() {
    if (loaded || disposed) return;
    if (!loading) loading = load().then(value => { loaded = value; issue = ''; }).catch(() => {
      issue = 'Cloud setup is unavailable. Check the local relay settings and updated agent build.';
    }).finally(() => { loading = null; });
    await loading;
  }
  function stop(close: boolean) {
    paused = true; cancelActive();
    if (!worker) return stopping ?? Promise.resolve();
    const current = worker;
    const previous = stopping;
    const operation = (async () => {
      try { await previous; await current.stop(); if (close) { await current.close(); if (worker === current) worker = null; } }
      catch { issue = 'Cloud delivery could not finish stopping. Check the inbox receipt before trying again.'; }
    })();
    stopping = operation;
    void operation.finally(() => { if (stopping === operation) stopping = null; });
    return operation;
  }
  async function deliverToTarget(job: ProjectionDelivery): Promise<ProjectionDeliveryReceipt> {
    const id = owner, entry = id && targets.get(id);
    if (!entry || !loaded || active || job.targetId !== loaded.config.deviceId) return { status: 'failed', text: 'No matching Studio receiver is available. No request was started.' };
    const request = { entry, started: false, stopped: false }; active = request;
    // Leave room inside the remote running lease for the bounded agent turn and receipt.
    const waitUntil = performance.now() + 30000;
    try {
      // A manual request may win the race between readiness and the remote claim.
      // Wait without creating a second agent or holding up the UI thread.
      while (!entry.ready()) {
        if (disposed || paused || owner !== id || targets.get(id!) !== entry || request.stopped) return { status: 'cancelled', text: 'Studio receiver stopped before this request began.' };
        if (Date.now() >= job.expiresAt) return { status: 'failed', text: 'Request expired while waiting for manual chat. No request was started.' };
        if (performance.now() >= waitUntil) return { status: 'incomplete', text: 'Manual chat remained busy for 30 seconds after delivery was claimed. No cloud request was started; submit a new request when this Studio is ready.' };
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      if (disposed || paused || owner !== id || targets.get(id!) !== entry || request.stopped) return { status: 'cancelled', text: 'Studio receiver stopped before this request began.' };
      if (Date.now() >= job.expiresAt) return { status: 'failed', text: 'Request expired before delivery. No request was started.' };
      if (performance.now() >= waitUntil) return { status: 'incomplete', text: 'Studio did not become ready within the delivery wait limit. No cloud request was started.' };
      request.started = true;
      const result = await entry.deliver(job.prompt);
      const receipt: ProjectionDeliveryReceipt = request.stopped && result.status === 'complete'
        ? { status: 'cancelled', text: 'Cloud request was stopped. Changes already applied may remain on the canvas.' } : result;
      return receipt;
    } catch {
      const receipt: ProjectionDeliveryReceipt = { status: 'uncertain', text: 'Studio did not confirm completion. Inspect the canvas before submitting a new request; changes may already be applied.' };
      return receipt;
    } finally { if (active === request) active = null; }
  }
  async function deliver(job: ProjectionDelivery): Promise<ProjectionDeliveryReceipt> {
    const receipt = await deliverToTarget(job);
    lastReceipt = { jobId: job.id, ...receipt };
    return receipt;
  }
  function view(id: string): CloudRelayState {
    const ownsTarget = owner === id, claimedElsewhere = owner !== null && !ownsTarget;
    const receiving = ownsTarget && !paused && !disposed;
    const phase = issue ? 'error' : active ? 'delivering' : paused ? 'stopped' : status.phase;
    const message = issue || (claimedElsewhere ? 'Another Studio is the cloud receiver. Release it there before choosing this one.'
      : !loaded ? 'Cloud delivery has not been configured on this computer.'
        : stopping ? 'Stopping cloud delivery. Applied changes remain on the canvas.'
          : !receiving ? 'Cloud delivery is paused. Choose Receive here to use this Studio.'
            : active ? 'Processing a cloud request in the canvas conversation.'
              : status.phase === 'error' ? 'The cloud inbox is unavailable. Connection will retry; check the inbox for receipts.'
                : !canReceive() ? 'Waiting for this Studio and manual chat to be ready.' : 'Listening for cloud requests.');
    return { configured: !!loaded, ownsTarget, claimedElsewhere, receiving, busy: !!active || !!stopping, phase, message,
      ...(loaded && { deviceId: loaded.config.deviceId }), ...(lastReceipt && { lastReceipt: structuredClone(lastReceipt) }) };
  }
  return {
    register(id: string, target: Target) {
      if (disposed || targets.has(id)) throw new Error('Studio receiver already registered or closed.');
      targets.set(id, target);
      let released = false;
      return () => { if (released) return; released = true; if (targets.get(id) !== target) return;
        targets.delete(id); if (owner === id) { owner = null; void stop(true); } };
    },
    async request(id: string, action: CloudRelayAction): Promise<CloudRelayState> {
      const entry = targets.get(id);
      if (disposed || !entry) throw new Error('Reconnect this Studio before changing cloud delivery.');
      if (!['state', 'receive', 'pause', 'release'].includes(action)) throw new Error('Unknown cloud delivery action.');
      await configure();
      if (disposed || targets.get(id) !== entry) throw new Error('Studio disconnected while checking cloud setup.');
      if (action === 'receive') {
        if (!loaded) throw new Error(issue || 'Configure the cloud relay on this computer first.');
        if (stopping) throw new Error('Wait for the current cloud request to stop.');
        if (owner && owner !== id) throw new Error('Another Studio owns cloud delivery. Release it in that Studio first.');
        owner = id;
        if (!worker) {
          const key = createHash('sha256').update(loaded.config.url + '\n' + loaded.config.deviceId).digest('hex').slice(0, 24);
          try { worker = loaded.createWorker({ ...loaded.config, receiptPath: join(privateDirectory, 'cloud-receipts', key + '.json'),
            target: { ready: async () => canReceive(), deliver, cancel: cancelActive }, onStatus: value => { status = value; } }); }
          catch { issue = 'Cloud receiver could not start. Check its local receipt store and whether another host is receiving.'; throw new Error(issue); }
        }
        issue = ''; paused = false;
        try { worker.start(); }
        catch { issue = 'Cloud receiver could not start. Release this Studio and check the local receipt store.'; void stop(true); throw new Error(issue); }
      } else if (action === 'pause' || action === 'release') {
        if (owner && owner !== id) throw new Error('Only the receiving Studio can pause or release cloud delivery.');
        if (action === 'release') owner = null;
        void stop(action === 'release');
      }
      return view(id);
    },
    view,
    async dispose() { disposed = true; owner = null; targets.clear(); await stop(true); },
  };
}
