'use client';

import { useState } from 'react';
import { Button } from '@synora/design-system';
import { toast } from 'sonner';
import {
  isRefusal,
  useCommandExecutions,
  useDecideCommand,
  type CommandExecutionListItem,
} from '@/lib/api/command';

/**
 * Commands that stopped for a decision, with the decision attached.
 *
 * WHY THE BUTTONS ARE HERE AND NOT ON THE HOME PAGE. The same rule the
 * tool-approval flow already follows: a decision is made where its full
 * context lives. The home page says something is waiting and links here;
 * approving from a summary card would be a yes given without the sentence,
 * the risk, or the deadline in front of you.
 *
 * CONSEQUENCES BEFORE THE CLICK. Each row states what would happen, what
 * class of risk it is, and when the chance to answer runs out — before
 * either button is reachable, not in a confirmation dialog afterwards.
 */

/** Plain-language risk, since "sensitive" is our word and not the person's. */
const RISK_MEANING: Record<string, string> = {
  'read-only': 'Only reads information. Changes nothing.',
  reversible: 'Changes something inside Synora that can be undone.',
  sensitive: 'Leaves Synora, spends money, or changes who can do what.',
  'high-risk': 'Hard to undo. Treated as the most serious class.',
};

function deadlineSentence(item: CommandExecutionListItem): string {
  if (!item.approvalExpiresAt) return 'No deadline recorded for this one.';
  const at = new Date(item.approvalExpiresAt);
  if (at.getTime() <= Date.now()) {
    return 'The time to answer this has passed.';
  }
  return `You can answer this until ${at.toLocaleString()}.`;
}

function PendingRow({ item, workspaceId }: { item: CommandExecutionListItem; workspaceId: string }) {
  const decide = useDecideCommand(workspaceId);
  const [reason, setReason] = useState('');

  // An expired row is shown, not hidden — a person who is looking for
  // something they asked for should find it, and learn why it can no
  // longer be answered, rather than watch it silently disappear.
  const overdue =
    item.state === 'expired' ||
    item.approvalState === 'expired' ||
    (!!item.approvalExpiresAt && new Date(item.approvalExpiresAt).getTime() <= Date.now());

  function submit(decision: 'approved' | 'rejected') {
    decide.mutate(
      { executionId: item.id, decision, ...(decision === 'rejected' && reason ? { reason } : {}) },
      {
        onSuccess: (outcome) => {
          // A refusal is not an error and is not a success. The server
          // handled the request correctly and the answer was no — so it is
          // reported as the sentence the server wrote, not as a red toast
          // implying something broke.
          toast(isRefusal(outcome) ? outcome.message : outcome.message);
        },
        onError: () => {
          toast.error('That decision could not be sent. Nothing was decided.');
        },
      },
    );
  }

  return (
    <li className="space-y-3 rounded-md border p-4" data-testid="pending-approval">
      <p className="text-sm font-medium">{item.commandText}</p>

      <div className="space-y-1 text-xs text-muted-foreground">
        <p>{RISK_MEANING[item.riskClass] ?? `Risk class: ${item.riskClass}.`}</p>
        {item.capabilityId && <p>Would use: {item.capabilityId}</p>}
        <p>{deadlineSentence(item)}</p>
        <p>Asked for on {new Date(item.createdAt).toLocaleString()}.</p>
      </div>

      {overdue ? (
        <p className="text-xs text-muted-foreground">
          This can no longer be approved. Nothing was done. Ask for it again if you still want it.
        </p>
      ) : (
        <div className="space-y-2">
          <label className="block text-xs text-muted-foreground" htmlFor={`reason-${item.id}`}>
            Reason (optional, recorded if you refuse)
          </label>
          <input
            id={`reason-${item.id}`}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="w-full rounded-md border px-2 py-1 text-sm"
            placeholder="Why you are refusing, if you are"
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => submit('approved')} disabled={decide.isPending}>
              Approve and run it
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => submit('rejected')}
              disabled={decide.isPending}
            >
              Refuse
            </Button>
          </div>
          {/* Said before the click, not after: approving is not a
              scheduling action, it performs the thing. */}
          <p className="text-xs text-muted-foreground">
            Approving runs this immediately. Refusing runs nothing and records why.
          </p>
        </div>
      )}
    </li>
  );
}

export function PendingApprovals({ workspaceId }: { workspaceId: string }) {
  const { data, isLoading } = useCommandExecutions(workspaceId, { pendingOnly: true });
  const items = data?.items ?? [];

  if (isLoading) return null;

  return (
    <section className="space-y-3" aria-labelledby="pending-approvals-heading">
      <h2 id="pending-approvals-heading" className="font-semibold">
        Waiting for a decision
      </h2>
      {items.length === 0 ? (
        // Plainly, with no congratulation. An empty queue is not an
        // achievement, and treating it as one implies it is a thing to be
        // emptied.
        <p className="text-sm text-muted-foreground">
          No command is waiting for a decision right now.
        </p>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <PendingRow key={item.id} item={item} workspaceId={workspaceId} />
          ))}
        </ul>
      )}
    </section>
  );
}
