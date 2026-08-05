'use client';

import Link from 'next/link';
import { PauseCircle } from 'lucide-react';
import { useAgentRuns } from '@/lib/api/agents';
import { useWorkspacePendingExecutions } from '@/lib/api/tools';
import { useMyInvitations } from '@/lib/api/invitations';

/**
 * What is actually blocked on this person.
 *
 * WHY THIS IS THE ONLY THING ON THE HOME PAGE THAT CLAIMS ATTENTION. A
 * run in `awaiting_approval` is not a guess about what might matter — it
 * is a fact: the work has stopped and cannot continue until a human says
 * yes or no. Everything else a dashboard might promote ("suggested for
 * you", "you haven't touched this in a while", "3 items need review") is
 * the platform inventing urgency about someone's own work, which is both
 * presumptuous and, when wrong, actively misleading.
 *
 * So this panel has exactly one rule: show what is stopped and waiting.
 * Nothing is ranked, scored, or nudged.
 *
 * WHEN NOTHING IS WAITING IT SAYS SO PLAINLY, and does not congratulate
 * anybody. "You're all caught up! 🎉" treats an empty queue as an
 * achievement, which quietly implies an inbox is the thing to be emptied.
 * A person whose runs are simply all finished has not accomplished
 * something by looking at this page.
 */
export function WaitingForYou({ workspaceId }: { workspaceId: string }) {
  const { data: runs = [], isLoading } = useAgentRuns(workspaceId, {
    enabled: !!workspaceId,
  });
  const { data: pendingExecutions = [] } = useWorkspacePendingExecutions(workspaceId, {
    enabled: !!workspaceId,
  });
  // Invitations are addressed to the PERSON, not to a workspace, so this
  // one list is account-scoped while everything else here is
  // workspace-scoped. A decision waiting on you follows you.
  const { data: myInvitations } = useMyInvitations();
  const invitations = myInvitations?.invitations ?? [];

  if (isLoading) return null;

  const waiting = runs.filter((run) => run.state === 'awaiting_approval');
  const nothingWaiting =
    waiting.length === 0 && pendingExecutions.length === 0 && invitations.length === 0;

  return (
    <section className="space-y-3 rounded-md border p-4" aria-labelledby="waiting-heading">
      <div className="flex items-center gap-2">
        <PauseCircle className="h-4 w-4" aria-hidden />
        <h2 id="waiting-heading" className="font-semibold">
          Waiting for you
        </h2>
      </div>

      {nothingWaiting ? (
        <p className="text-sm text-muted-foreground">
          Nothing is paused for a decision right now.
        </p>
      ) : (
        <ul className="space-y-2">
          {waiting.map((run) => (
            <li key={run.id} className="rounded-md border p-3 text-sm">
              <Link href="/agents" className="font-medium hover:underline">
                {run.task || 'Untitled run'}
              </Link>
              <p className="mt-1 text-xs text-muted-foreground">
                {/* The reason comes from the run itself — the step that
                    asked. Paraphrasing it here would put a second wording
                    of the same rule in front of the person. */}
                Paused before a step that needs approval
                {run.pendingApproval?.reason ? `: ${run.pendingApproval.reason}` : '.'}
              </p>
            </li>
          ))}
          {/* Tool executions stopped on requiresApproval are the same
              kind of fact a paused run is: work that will not proceed
              until a person decides. Approval itself stays on the tools
              page, where the execution's full input is visible — a
              yes/no here would be a decision made without the context
              the decision needs. */}
          {pendingExecutions.map((execution) => (
            <li key={execution.id} className="rounded-md border p-3 text-sm">
              <Link href="/dashboard/tools" className="font-medium hover:underline">
                {execution.tool?.name ?? 'A tool'} is waiting to run
              </Link>
              <p className="mt-1 text-xs text-muted-foreground">
                This tool requires approval before it executes. Review it on the tools page.
              </p>
            </li>
          ))}
          {/* An invitation is a decision only its recipient can make.
              Accepting happens on the invite page — the same surface an
              emailed link lands on, so there is exactly one accept flow
              to reason about. Declining is deliberately not offered:
              leaving an invitation alone changes nothing, and it expires
              on its own. */}
          {invitations.map((invitation) => (
            <li key={invitation.id} className="rounded-md border p-3 text-sm">
              <Link href={`/invite/${invitation.token}`} className="font-medium hover:underline">
                {invitation.invitedBy || 'Someone'} invited you to join {invitation.workspaceName}
              </Link>
              <p className="mt-1 text-xs text-muted-foreground">
                You would join as a {invitation.role.toLowerCase()}. Nothing changes until you
                accept, and the invitation expires on{' '}
                {new Date(invitation.expiresAt).toLocaleDateString()}.
              </p>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-muted-foreground">
        Everything here stays exactly as it is until you decide — a paused step or tool waits for
        your approval, and an invitation changes nothing until you accept it. Nothing runs in the
        meantime.
      </p>
    </section>
  );
}
