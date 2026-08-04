'use client';

import Link from 'next/link';
import { PauseCircle } from 'lucide-react';
import { useAgentRuns } from '@/lib/api/agents';

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

  if (isLoading) return null;

  const waiting = runs.filter((run) => run.state === 'awaiting_approval');

  return (
    <section className="space-y-3 rounded-md border p-4" aria-labelledby="waiting-heading">
      <div className="flex items-center gap-2">
        <PauseCircle className="h-4 w-4" aria-hidden />
        <h2 id="waiting-heading" className="font-semibold">
          Waiting for you
        </h2>
      </div>

      {waiting.length === 0 ? (
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
        </ul>
      )}

      <p className="text-xs text-muted-foreground">
        A run pauses here because a step was marked as needing a person, and stays paused until
        you approve or decline it. Nothing runs in the meantime.
      </p>
    </section>
  );
}
