import { z } from 'zod';
import { privateJson } from './private-json.js';
import { relayId, relayUrl, receiptSchema, type ProjectionRelayWorkerOptions, type ProjectionRelayWorker, type ProjectionDeliveryReceipt, type ProjectionRelayStatus } from './types.js';

const leaseSchema = z.object({ job: z.object({ id: z.string().uuid(), targetId: relayId, kind: z.enum(['task_update', 'creative_prompt']),
  prompt: z.string().min(1).max(8000), createdAt: z.number(), expiresAt: z.number() }).strict(), leaseToken: z.string().uuid() }).strict();
const journalSchema = z.object({ version: z.literal(1), relay: z.string(), deviceId: relayId,
  pending: z.object({ lease: leaseSchema, receipt: receiptSchema.optional() }).nullable() });
type Journal = z.infer<typeof journalSchema>;

/** Outbound only. A lost result never causes the local agent to execute a job twice. */
export function createProjectionRelayWorker(options: ProjectionRelayWorkerOptions): ProjectionRelayWorker {
  const url = relayUrl(options.url), deviceId = relayId.parse(options.deviceId);
  if (options.token.length < 32) throw new Error('A relay device token of at least 32 characters is required.');
  const interval = options.pollIntervalMs ?? 3000;
  if (!Number.isFinite(interval) || interval < 250 || interval > 60000) throw new Error('Invalid relay polling interval.');
  const journal = privateJson<Journal>(options.receiptPath, { version: 1, relay: url.origin, deviceId, pending: null }, data => journalSchema.parse(data));
  if (journal.get().relay !== url.origin || journal.get().deviceId !== deviceId) { journal.close(); throw new Error('This receipt journal belongs to a different relay or device. Use a separate private receipt path.'); }
  let enabled = false, closed = false, stopping = false, delivering = false, timer: ReturnType<typeof setTimeout> | undefined;
  let active: Promise<void> | undefined, failures = 0;
  const status = (value: ProjectionRelayStatus) => { try { options.onStatus?.(value); } catch { /* Observers cannot interrupt receipt handling. */ } };
  const post = async (path: string, body: unknown): Promise<unknown> => {
    const response = await fetch(new URL(path, url), { method: 'POST', redirect: 'error',
      headers: { Authorization: 'Bearer ' + options.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId, ...body as object }), signal: AbortSignal.timeout(10000) });
    if (!response.ok) { await response.body?.cancel(); throw new Error('Relay request was not accepted.'); }
    // Bound even a compromised/misconfigured upstream response before JSON parsing.
    const reader = response.body?.getReader(); if (!reader) throw new Error('Relay response was empty.');
    const parts: Uint8Array[] = []; let length = 0;
    try { for (;;) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > 65536) throw new Error('Relay response was too large.'); parts.push(value); } }
    finally { await reader.cancel(); }
    return JSON.parse(Buffer.concat(parts).toString('utf8'));
  };
  async function acknowledge() {
    const state = journal.get(), pending = state.pending; if (!pending) return;
    if (!pending.receipt) {
      pending.receipt = { status: 'uncertain', text: 'Local delivery was interrupted before a durable result was recorded. Inspect the studio before submitting another request. No automatic replay.' };
      journal.save(state);
    }
    const remote = z.object({ id: z.string(), state: z.string() }).passthrough().parse(await post('/device/status', { id: pending.lease.job.id }));
    if (remote.id !== pending.lease.job.id) throw new Error('Relay request identity did not match.');
    // These states prove execution never started (start is required before delivery).
    if (['cancelled', 'expired', 'queued'].includes(remote.state) && pending.receipt.status === 'uncertain') {
      journal.save({ ...state, pending: null }); return;
    }
    // Acknowledge only this recorded result; never call target.deliver during recovery.
    const result = await post('/device/finish', { id: pending.lease.job.id, leaseToken: pending.lease.leaseToken, receipt: pending.receipt });
    const recorded = z.object({ id: z.string(), state: z.string(), receipt: receiptSchema.optional() }).passthrough().parse(result);
    if (recorded.id !== pending.lease.job.id || recorded.state !== pending.receipt.status || JSON.stringify(recorded.receipt) !== JSON.stringify(pending.receipt)) throw new Error('Relay receipt did not match.');
    journal.save({ ...state, pending: null });
  }
  async function poll() {
    if (closed || stopping) return;
    try {
      await acknowledge();
      if (stopping || !(await options.target.ready())) { status({ phase: 'waiting', message: 'Waiting for the selected studio to be ready.' }); return; }
      const raw = await post('/device/claim', {});
      if (raw === null) { failures = 0; status({ phase: 'connected', message: 'Connected. Waiting for cloud requests.' }); return; }
      const lease = leaseSchema.parse(raw);
      if (lease.job.targetId !== deviceId) throw new Error('Relay returned a request for another installation.');
      // Persist intent before the server start or any scene-changing callback.
      journal.save({ ...journal.get(), pending: { lease } });
      if (stopping || lease.job.expiresAt <= Date.now() || !(await options.target.ready())) { await acknowledge(); return; }
      const started = z.object({ id: z.string(), state: z.literal('running') }).passthrough().parse(await post('/device/start', { id: lease.job.id, leaseToken: lease.leaseToken }));
      if (started.id !== lease.job.id) throw new Error('Relay start receipt did not match.');
      let receipt: ProjectionDeliveryReceipt;
      if (stopping || lease.job.expiresAt <= Date.now()) receipt = { status: 'cancelled', text: 'Delivery stopped before the agent was invoked.' };
      else {
        delivering = true; status({ phase: 'delivering', message: 'The canvas agent is handling a cloud request.', jobId: lease.job.id });
        try { receipt = receiptSchema.parse(await options.target.deliver(lease.job)); }
        catch { receipt = { status: 'uncertain', text: 'The local agent did not return a valid result. Changes may already be on the canvas. Inspect the studio; this request will not replay automatically.' }; }
        finally { delivering = false; }
      }
      journal.save({ ...journal.get(), pending: { lease, receipt } });
      await acknowledge(); failures = 0;
      status({ phase: 'connected', message: 'Cloud request result recorded.', jobId: lease.job.id });
    } catch {
      failures++;
      status({ phase: 'error', message: 'Cloud connection needs attention. Check relay settings or connectivity. Started requests are not replayed automatically.' });
    }
  }
  function pollOnce() { if (closed) return Promise.reject(new Error('Relay worker is closed.')); return active ??= poll().finally(() => { active = undefined; }); }
  function schedule() {
    if (!enabled || closed) return;
    timer = setTimeout(() => { timer = undefined; void pollOnce().finally(schedule); }, Math.min(60000, interval * 2 ** Math.min(failures, 4)));
    timer.unref?.();
  }
  async function stop() {
    enabled = false; stopping = true; if (timer) clearTimeout(timer); timer = undefined;
    if (delivering) { try { options.target.cancel?.(); } catch { /* Await the current receipt. */ } }
    await active; status({ phase: 'stopped', message: 'Cloud delivery is paused.' });
  }
  return {
    start() { if (closed) throw new Error('Relay worker is closed.'); if (enabled) return; stopping = false; enabled = true; void pollOnce().finally(schedule); },
    stop, pollOnce,
    async close() { if (closed) return; await stop(); closed = true; journal.close(); },
  };
}
