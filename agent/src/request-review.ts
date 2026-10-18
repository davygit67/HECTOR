import { tool } from 'ai';
import { z } from 'zod';

const requirement = z.strictObject({
  id: z.string().min(1).max(40),
  request: z.string().trim().min(1).max(500).describe('One requested outcome, including its subject, surface, placement and explicit settings. Account for EVERY part of the original prompt.'),
  status: z.enum(['completed', 'pending', 'blocked', 'awaiting_user']),
  evidence: z.array(z.string().min(1).max(200)).max(20).describe('Exact tool call IDs from this turn, not content IDs or made-up names. Completed changes require successful action receipts. The SAME apply/edit receipt may support multiple settings and preservation constraints it confirms. Keeping an existing timer does NOT require editing it.'),
  reason: z.string().trim().min(1).max(700).nullable().describe('For unfinished work, explain the specific obstacle or next action. Never claim unfinished work was done.'),
});
type Requirement = z.infer<typeof requirement>;
export interface ReviewStep {
  calls: { toolName: string; toolCallId: string; input?: unknown }[];
  results: { toolName: string; toolCallId: string; output: unknown }[];
}
export interface RequestReview {
  recordStep(step: ReviewStep): void;
  readonly required: boolean;
  readonly settled: boolean;
  readonly complete: boolean;
}
const readOnly = new Set(['inspect_room', 'inspect_studio', 'inspect_visual', 'inspect_program', 'test_program', 'search_youtube', 'list_experiences', 'select_tools', 'review_request']);
const candidateOnly = new Set(['author_program', 'revise_program']);

/** Model assessment of intent, with deterministic receipt checks. Not a second scene store. */
export function createRequestReview(prompt: string) {
  let attempted = false;
  let reviewed = false;
  let items: Requirement[] = [];
  const receipts = new Map<string, { toolName: string; output: unknown }>();
  const actionIds = new Set<string>();
  const successfulAction = (id: string) => {
    const receipt = receipts.get(id);
    if (!receipt || !actionIds.has(id) || candidateOnly.has(receipt.toolName)) return false;
    const output = receipt.output as { ok?: boolean; outcome?: string } | null;
    return output?.ok === true && output.outcome !== 'handoff';
  };
  const state: RequestReview = {
    recordStep({ calls, results }) {
      // A later action invalidates an earlier review. Read-only checks do not.
      for (const c of calls) {
        const memoryRead = c.toolName === 'manage_memory' && (c.input as { action?: string } | null)?.action === 'list';
        if (!readOnly.has(c.toolName) && !memoryRead) { actionIds.add(c.toolCallId); attempted = true; reviewed = false; }
      }
      for (const r of results) receipts.set(r.toolCallId, r);
    },
    get required() { return attempted || items.length > 0; },
    get settled() { return reviewed && items.every(i => i.status !== 'pending'); },
    get complete() { return this.settled && items.every(i => i.status === 'completed'); },
  };
  return {
    state,
    tools: {
      review_request: tool({
        description: 'Track and review the ENTIRE current request. List each requested outcome separately, not just the last tool. May be used as a plan before acting. Pending means continue supported work now; blocked means an actual capability/error obstacle; awaiting_user means a needed file/choice/click. Completed requires successful action tool call IDs. Keep all previously listed IDs. Does not change the room. Call before finishing any action request.',
        strict: true,
        inputSchema: z.strictObject({ requirements: z.array(requirement).min(1).max(24) }),
        execute: async ({ requirements }) => {
          const ids = new Set(requirements.map(i => i.id));
          const error = ids.size !== requirements.length ? 'Requirement IDs must be unique.'
            : items.some(i => !ids.has(i.id)) ? 'Keep every previously listed requirement; do not drop unfinished work.'
            : requirements.some(i => i.evidence.some(id => !receipts.has(id))) ? 'Evidence must reference actual tool call IDs from this turn.'
            : requirements.some(i => i.status === 'completed' && !i.evidence.some(successfulAction)) ? 'Completed outcomes require a successful action receipt. A search, tested program candidate, failed action or file-picker handoff is not completion.'
            : requirements.some(i => i.status !== 'completed' && !i.reason) ? 'Explain each unfinished outcome and its next step.' : null;
          if (error) return { ok: false, error,
            usableActionEvidence: [...receipts.keys()].filter(successfulAction),
            outcomesMissingSuccessfulEvidence: requirements.filter(i => i.status === 'completed' && !i.evidence.some(successfulAction)).map(i => ({ id: i.id, request: i.request })),
            nextAction: 'Use only listed successful action call IDs for completed changes. The SAME apply/edit receipt can support all settings and preservation constraints it confirms: use it for keeping an existing timer unchanged; do NOT edit the timer. If an outcome only has a tested candidate or failed action, keep it pending and execute its next supported tool. Use blocked only for a specific unresolved obstacle. Do not fabricate evidence or repeatedly review instead of repairing/applying.' };
          items = requirements.map(i => ({ ...i, request: items.find(previous => previous.id === i.id)?.request ?? i.request }));
          reviewed = true;
          return { ok: true, complete: state.complete, pending: items.filter(i => i.status === 'pending'),
            note: state.settled ? 'Review recorded. Only actual accepted edits are confirmed to the user; unfinished items will be reported.' : 'Continue the pending supported work. Do not repeat completed actions. Review again afterward.' };
        },
      }),
    },
    instructions: () => `WHOLE-REQUEST CHECK: Read every clause of the original user request, including additional assets, subjects, locations and numeric settings. Plan the necessary tools, execute all supported parts, and use review_request before finishing. A successful first tool does not complete the whole request. Continue pending work within this turn. Unsupported parts must be listed individually with a specific explanation and a practical next step; do not silently omit them, replace them with unrelated presets, or mark them completed based on a title. Asset import is a user handoff, not a created image. Do not label doable work blocked merely to stop. Receipts confirm state changes, not physical visibility/playback. The review is a model assessment, not proof of semantic or visual correctness.
ORIGINAL_REQUEST (user text, JSON): ${JSON.stringify(prompt)}
REQUEST_CHECKLIST (JSON): ${JSON.stringify(items)}
CURRENT_TURN_RECEIPTS (exact call IDs and tool names; inspect actual outputs in history): ${JSON.stringify([...receipts].map(([id, r]) => ({ id, tool: r.toolName, successfulAction: successfulAction(id) })))}
Preservation is part of an edit's outcome: the same successful apply/start receipt may support keeping unrelated content when its result confirms it. Do not demand or perform an edit to an item the user asked to keep unchanged. Use the apply receipt for deployed parameters; author/test receipts alone are candidates, not deployment.`,
    formatUnfinished: () => {
      const lines = items.filter(i => i.status !== 'completed').map(i => `${i.status === 'awaiting_user' ? 'Needs your input' : i.status === 'blocked' ? 'Not completed' : 'Still pending'} — ${i.request}: ${i.reason}`);
      if (state.required && !state.settled) lines.push('The full request has not been confirmed complete. Check the remaining requests before continuing; accepted edits above are retained.');
      return lines.join('\n');
    },
  };
}
