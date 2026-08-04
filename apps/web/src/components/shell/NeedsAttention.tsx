'use client';

import { AlertTriangle } from 'lucide-react';
import { useAgentRuns, useAgents } from '@/lib/api/agents';

const ATTENTION_LIMIT = 10;

/** Relative where it helps, absolute where precision matters more. */
function when(ms: number): string {
  const minutes = Math.round((Date.now() - ms) / 60_000);
  if (!Number.isFinite(minutes) || minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days}d ago`;
  return new Date(ms).toLocaleDateString();
}

/**
 * Runs that stopped on their own, without being asked to — the "went
 * wrong" half of the decision center, distinct from "waiting for you"
 * (which stopped ON PURPOSE, pending a choice only a person can make).
 *
 * NO FABRICATED RECOMMENDATION. Synora has no system that judges why a
 * run failed or what to do about it — showing one here would be exactly
 * the kind of invented AI confidence this platform refuses to fake
 * everywhere else. What is shown is only what is actually recorded: the
 * task, which agent, when, and the error text the run itself produced.
 *
 * "Run again" is deliberately not offered here. That decision — replay
 * on the CURRENT agent version, never the pinned one that failed — is
 * already solved correctly in `RunDetail`; re-solving it in a second,
 * smaller place risks the two quietly disagreeing later. This links to
 * where the real answer lives instead of guessing a shortcut here.
 */
export function NeedsAttention({ workspaceId }: { workspaceId: string }) {
  const { data: runs = [], isLoading } = useAgentRuns(workspaceId, { enabled: !!workspaceId });
  const { data: agents = [] } = useAgents(workspaceId, { enabled: !!workspaceId });

  if (isLoading) return null;

  const failed = runs
    .filter((run) => run.state === 'failed' || run.state === 'timed_out')
    .sort((a, b) => (b.finishedAt ?? b.createdAt) - (a.finishedAt ?? a.createdAt))
    .slice(0, ATTENTION_LIMIT);

  // No section at all when there is nothing to look at — an empty
  // "Needs attention" heading would be a warning sign about nothing.
  if (failed.length === 0) return null;

  return (
    <section className="space-y-3 rounded-md border p-4" aria-labelledby="attention-heading">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-destructive" aria-hidden />
        <h2 id="attention-heading" className="font-semibold">
          Needs attention
        </h2>
      </div>

      <ul className="space-y-2">
        {failed.map((run) => {
          const agent = agents.find((a) => a.lineageId === run.lineageId);
          return (
            <li key={run.id} className="rounded-md border p-3 text-sm">
              <p className="font-medium">{run.task || 'Untitled run'}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {agent?.name ?? 'An agent'} ·{' '}
                {run.state === 'timed_out' ? 'ran out of time' : 'failed'} ·{' '}
                {when(run.finishedAt ?? run.createdAt)}
              </p>
              {run.error && (
                <p className="mt-1 text-xs text-destructive">{run.error}</p>
              )}
            </li>
          );
        })}
      </ul>

      <p className="text-xs text-muted-foreground">
        Open an agent on the Agents page to see the full run and start it again if you want to.
      </p>
    </section>
  );
}
