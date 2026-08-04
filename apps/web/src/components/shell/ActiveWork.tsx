'use client';

import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@synora/design-system';
import { useAgentRuns, useAgents, useCancelRun } from '@/lib/api/agents';

/**
 * What is running right now, in this workspace.
 *
 * An agent or workflow run in `planning` or `running` is doing real work
 * this instant — the honest analogue of a spinner that spans the whole
 * workspace instead of one screen. It is shown so a run started five
 * minutes ago from `/agents` is not invisible everywhere else.
 *
 * The agent name is resolved from the CURRENT agent in the run's lineage
 * (the same approximation `RunDetail`'s "Run again" uses), not the exact
 * historical version — a summary list is the wrong place to load per-run
 * history just to get a name that has almost certainly not changed.
 */
export function ActiveWork({ workspaceId }: { workspaceId: string }) {
  const { data: runs = [], isLoading } = useAgentRuns(workspaceId, { enabled: !!workspaceId });
  const { data: agents = [] } = useAgents(workspaceId, { enabled: !!workspaceId });
  const cancel = useCancelRun(workspaceId);

  if (isLoading) return null;

  const active = runs
    .filter((run) => run.state === 'planning' || run.state === 'running')
    .sort((a, b) => b.createdAt - a.createdAt);

  if (active.length === 0) return null;

  return (
    <section className="space-y-3 rounded-md border p-4" aria-labelledby="active-work-heading">
      <div className="flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        <h2 id="active-work-heading" className="font-semibold">
          Working right now
        </h2>
      </div>

      <ul className="space-y-2">
        {active.map((run) => {
          const agent = agents.find((a) => a.lineageId === run.lineageId);
          return (
            <li
              key={run.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"
            >
              <div>
                <p className="font-medium">{run.task || 'Untitled run'}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {agent?.name ?? 'An agent'} · {run.state}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={cancel.isPending}
                onClick={() =>
                  cancel.mutate(run.id, {
                    onSuccess: () => toast.success('Run stopped'),
                    onError: (e) => toast.error(e.message),
                  })
                }
              >
                Stop
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
