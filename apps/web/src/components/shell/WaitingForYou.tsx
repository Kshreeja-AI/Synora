'use client';

import Link from 'next/link';
import { PauseCircle } from 'lucide-react';
import { useAgentRuns } from '@/lib/api/agents';
import { useWorkspacePendingExecutions } from '@/lib/api/tools';
import { useCommandExecutions } from '@/lib/api/command';
import { useMyInvitations } from '@/lib/api/invitations';
import { useWaitingElsewhere } from '@/hooks/useWaitingElsewhere';
import { useWorkspaceStore } from '@/stores/workspace-store';

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
  // A command stopped at the approval gate is the same kind of fact as a
  // paused run: the work has halted and will not move until a person
  // decides. Same rule as the tool executions below — this says WHAT is
  // waiting and links to where the decision is made, because approving
  // from a summary card would be a yes given without the sentence, the
  // risk, or the deadline in front of you.
  const { data: pendingCommands } = useCommandExecutions(workspaceId, {
    pendingOnly: true,
    enabled: !!workspaceId,
  });
  const commands = pendingCommands?.items ?? [];
  // Invitations are addressed to the PERSON, not to a workspace, so this
  // one list is account-scoped while everything else here is
  // workspace-scoped. A decision waiting on you follows you.
  const { data: myInvitations } = useMyInvitations();
  const invitations = myInvitations?.invitations ?? [];
  // A paused run in a workspace you never open is just as stopped as
  // one in front of you. Counts only for other workspaces — the context
  // each decision needs lives there, so the row's job is to say WHERE.
  const { data: waitingElsewhere = [] } = useWaitingElsewhere();
  const setCurrentWorkspaceId = useWorkspaceStore((state) => state.setCurrentWorkspaceId);
  const elsewhere = waitingElsewhere.filter((entry) => entry.workspaceId !== workspaceId);

  if (isLoading) return null;

  const waiting = runs.filter((run) => run.state === 'awaiting_approval');
  const nothingWaiting =
    waiting.length === 0 &&
    pendingExecutions.length === 0 &&
    invitations.length === 0 &&
    commands.length === 0;

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
              {/* WHO asked is part of the decision's context: approving
                  unblocks a specific colleague, not an anonymous id. */}
              <p className="mt-1 text-xs text-muted-foreground">
                Requested by {run.requestedByName ?? 'someone'} ·{' '}
                {new Date(run.createdAt).toLocaleString()}
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
              <p className="mt-1 text-xs text-muted-foreground">
                Requested by {execution.user?.name ?? execution.user?.email ?? 'someone'} ·{' '}
                {new Date(execution.createdAt).toLocaleString()}
              </p>
            </li>
          ))}
          {commands.map((command) => (
            <li key={command.id} className="rounded-md border p-3 text-sm">
              <Link href="/command" className="font-medium hover:underline">
                {command.commandText}
              </Link>
              <p className="mt-1 text-xs text-muted-foreground">
                You asked for this and it stopped for your approval. Nothing has run. Decide it on
                the Ask Synora page, where what it would do is shown in full.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Asked on {new Date(command.createdAt).toLocaleString()}
                {command.approvalExpiresAt
                  ? ` · answerable until ${new Date(command.approvalExpiresAt).toLocaleString()}`
                  : ''}
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

      {elsewhere.length > 0 && (
        <ul className="space-y-1">
          {/* Switching workspace is exactly what WorkspaceSwitcher does —
              the same store setter, so there is one navigation behavior
              to reason about, not two. */}
          {elsewhere.map((entry) => {
            const total = entry.pausedRuns + entry.pendingExecutions;
            return (
              <li key={entry.workspaceId}>
                <button
                  type="button"
                  onClick={() => setCurrentWorkspaceId(entry.workspaceId)}
                  className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                >
                  {total} {total === 1 ? 'decision is' : 'decisions are'} waiting in{' '}
                  {entry.workspaceName} — switch to it
                </button>
              </li>
            );
          })}
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
