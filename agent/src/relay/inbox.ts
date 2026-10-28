import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { privateJson } from './private-json.js';
import { deliveryPrompt, relayId, receiptSchema, submissionSchema, type ProjectionDelivery, type ProjectionDeliveryReceipt, type ProjectionJobView, type ProjectionLease } from './types.js';

const storedJob = z.object({
  id: z.string().uuid(), requestId: relayId, targetId: relayId, kind: z.enum(['task_update', 'creative_prompt']),
  prompt: z.string().max(8000), fingerprint: z.string(),
  createdAt: z.number(), expiresAt: z.number(), updatedAt: z.number(),
  state: z.enum(['queued', 'leased', 'running', 'complete', 'incomplete', 'failed', 'cancelled', 'expired', 'uncertain']),
  leaseToken: z.string().optional(), leaseUntil: z.number().optional(), receipt: receiptSchema.optional(),
});
const stateSchema = z.object({ version: z.literal(1), jobs: z.array(storedJob).max(5000) });
type Job = z.infer<typeof storedJob>;
const view = (job: Job): ProjectionJobView => ({ id: job.id, requestId: job.requestId, targetId: job.targetId, kind: job.kind, state: job.state,
  createdAt: job.createdAt, expiresAt: job.expiresAt, updatedAt: job.updatedAt, ...(job.receipt ? { receipt: job.receipt } : {}), projectionVerified: false });
export class RelayError extends Error { constructor(public readonly code: string, message: string) { super(message); } }

export function createProjectionInbox(options: { path: string; targetId: string; now?: () => number; capacity?: number }) {
  const targetId = relayId.parse(options.targetId), now = options.now ?? Date.now;
  const capacity = options.capacity ?? 1000;
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 5000) throw new Error('Invalid inbox capacity.');
  const store = privateJson(options.path, { version: 1 as const, jobs: [] as Job[] }, data => stateSchema.parse(data));
  if (store.get().jobs.some(job => job.targetId !== targetId)) { store.close(); throw new Error('This inbox belongs to another installation. Use a separate private store.'); }
  let lastSeen: number | null = null;
  function transaction<T>(work: (jobs: Job[], time: number) => T): T {
    const state = store.get(), before = JSON.stringify(state), time = now();
    for (const job of state.jobs) {
      if (job.state === 'queued' && job.expiresAt <= time) { job.state = 'expired'; job.updatedAt = time; }
      if (job.state === 'leased' && job.leaseUntil! <= time) {
        job.state = job.expiresAt <= time ? 'expired' : 'queued'; delete job.leaseToken; delete job.leaseUntil; job.updatedAt = time;
      }
      if (job.state === 'running' && job.leaseUntil! <= time) {
        job.state = 'uncertain'; job.updatedAt = time;
        job.receipt = { status: 'uncertain', text: 'Delivery started but its result was not acknowledged. Inspect the studio before submitting another request. No automatic replay.' };
      }
    }
    const result = work(state.jobs, time);
    // Idle receiver checks and status reads do not rewrite the persistent inbox.
    if (JSON.stringify(state) !== before) store.save(state);
    return result;
  }
  const find = (jobs: Job[], id: string) => { const job = jobs.find(job => job.id === id && job.targetId === targetId); if (!job) throw new RelayError('not_found', 'Projection request not found.'); return job; };
  const ownsLease = (job: Job, token: string) => { if (!token || job.leaseToken !== token) throw new RelayError('lease_mismatch', 'Delivery lease is no longer valid.'); };
  return {
    targetId,
    submit(raw: unknown) {
      const input = submissionSchema.parse(raw);
      if (input.targetId !== targetId) throw new RelayError('wrong_target', 'Unknown projector installation.');
      const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex');
      const prompt = deliveryPrompt(input);
      if (prompt.length > 8000) throw new RelayError('too_large', 'Formatted task data exceeds the agent message limit. Shorten the summary.');
      return transaction((jobs, time) => {
        const previous = jobs.find(job => job.requestId === input.requestId);
        if (previous) {
          if (previous.fingerprint !== fingerprint) throw new RelayError('id_conflict', 'This request ID already belongs to different content.');
          return { ...view(previous), duplicate: true };
        }
        if (jobs.length >= capacity) throw new RelayError('inbox_full', 'Inbox retention limit reached. Archive its private data while stopped before submitting new requests.');
        const job: Job = { id: randomUUID(), requestId: input.requestId, targetId, kind: input.kind, prompt, fingerprint,
          createdAt: time, updatedAt: time, expiresAt: time + input.ttlSeconds * 1000, state: 'queued' };
        jobs.push(job); return { ...view(job), duplicate: false };
      });
    },
    get(id: string) { return transaction(jobs => view(find(jobs, id))); },
    status() { return transaction((jobs, time) => ({ targetId, deviceOnline: lastSeen !== null && time - lastSeen < 30000, lastSeen,
      counts: Object.fromEntries(['queued', 'leased', 'running', 'complete', 'incomplete', 'failed', 'cancelled', 'expired', 'uncertain'].map(state => [state, jobs.filter(job => job.state === state).length])),
      projectionVerified: false, note: 'Agent completion describes accepted canvas work, not observed physical projector output.' })); },
    cancel(id: string) { return transaction((jobs, time) => {
      const job = find(jobs, id);
      if (job.state === 'cancelled') return view(job);
      if (!['queued', 'leased'].includes(job.state)) throw new RelayError('already_started', 'Only requests that have not started can be cancelled here. Use Stop in the studio for an active request.');
      job.state = 'cancelled'; job.updatedAt = time; delete job.leaseToken; delete job.leaseUntil; return view(job);
    }); },
    claim(): ProjectionLease | null { return transaction((jobs, time) => {
      lastSeen = time;
      if (jobs.some(job => job.state === 'leased' || job.state === 'running')) return null;
      const job = jobs.find(job => job.state === 'queued'); if (!job) return null;
      job.state = 'leased'; job.leaseToken = randomUUID(); job.leaseUntil = time + 30000; job.updatedAt = time;
      const delivery: ProjectionDelivery = { id: job.id, targetId, kind: job.kind, prompt: job.prompt, createdAt: job.createdAt, expiresAt: job.expiresAt };
      return { job: delivery, leaseToken: job.leaseToken };
    }); },
    start(id: string, token: string) { return transaction((jobs, time) => {
      const job = find(jobs, id); ownsLease(job, token);
      if (job.state !== 'leased' || job.expiresAt <= time) throw new RelayError('not_startable', 'Request expired or is no longer waiting for this device.');
      job.state = 'running'; job.leaseUntil = time + 180000; job.updatedAt = time; return view(job);
    }); },
    finish(id: string, token: string, raw: ProjectionDeliveryReceipt) { const receipt = receiptSchema.parse(raw); return transaction((jobs, time) => {
      const job = find(jobs, id); ownsLease(job, token);
      if (job.receipt && job.state !== 'uncertain') {
        if (JSON.stringify(job.receipt) !== JSON.stringify(receipt)) throw new RelayError('receipt_conflict', 'A different completion receipt is already recorded.');
        return view(job);
      }
      if (!['running', 'uncertain', 'leased'].includes(job.state) || (job.state === 'leased' && receipt.status !== 'uncertain')) throw new RelayError('not_running', 'Request has not started.');
      job.state = receipt.status; job.receipt = receipt; job.updatedAt = time; return view(job);
    }); },
    close: store.close,
  };
}
export type ProjectionInbox = ReturnType<typeof createProjectionInbox>;
