'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Bot, FolderKanban } from 'lucide-react';
import { Spinner } from '@synora/design-system/components/Spinner';
import { useCurrentWorkspace } from '@/hooks/useCurrentWorkspace';
import { useAgent, useAgentRun } from '@/lib/api/agents';
import { useWorkflow } from '@/lib/api/workflows';
import { getProject } from '@/lib/api/projects';
import { RunDetail } from '@/components/agents/RunDetail';

/**
 * One run, reachable on its own.
 *
 * Everywhere else a run appears inline — an agent's own run history, a
 * project's timeline — it borrows its surroundings for context. Nothing
 * gave it an address of its own, so a project's timeline could name a run
 * but not link to it: the exact gap this page closes.
 *
 * `run.agentId` names whichever definition actually ran, agent or
 * workflow, and only one of the two lookups below will ever resolve — the
 * id spaces (`agent_...` / `wf_...`) never collide. Both are fired at once
 * rather than tried in sequence: the "wrong" one's 404 is an expected
 * outcome here, not a failure to recover from.
 */
export default function RunDetailPage() {
  const params = useParams();
  const runId = params.runId as string;
  const { currentWorkspace, isLoading: workspaceLoading } = useCurrentWorkspace();
  const workspaceId = currentWorkspace?.id || '';

  const { data: run, isLoading: runLoading, error } = useAgentRun(workspaceId, runId);
  const { data: agent } = useAgent(workspaceId, run?.agentId ?? '', {
    enabled: !!run,
    retry: false,
  });
  const { data: workflow } = useWorkflow(workspaceId, run?.agentId ?? '', {
    enabled: !!run,
  });
  const { data: project } = useQuery({
    queryKey: ['project', run?.projectId],
    queryFn: () => getProject(run!.projectId!),
    enabled: !!run?.projectId,
    // A run's filing can outlive the project being reachable to this
    // viewer (e.g. it moved workspaces); degrade to showing the run
    // without the label rather than retrying a call that keeps failing.
    retry: false,
  });

  if (workspaceLoading || runLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (error || !run) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-6">
        <p role="alert" className="text-sm text-destructive">
          {error instanceof Error ? error.message : 'This run could not be found.'}
        </p>
        <Link href="/agents" className="inline-flex items-center gap-1 text-sm underline">
          <ArrowLeft className="h-3 w-3" aria-hidden />
          Back to agents
        </Link>
      </div>
    );
  }

  const originLabel = agent?.name ?? workflow?.name ?? 'Agent run';
  const backHref = workflow ? '/workflows' : '/agents';
  const backLabel = workflow ? 'Workflows' : 'Agents';

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <Link
          href={backHref}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" aria-hidden />
          {backLabel}
        </Link>

        <div className="mt-2 flex items-center gap-2">
          <Bot className="h-5 w-5 text-muted-foreground" aria-hidden />
          <h1 className="text-2xl font-semibold">{originLabel}</h1>
        </div>

        {project && (
          <p className="mt-1">
            <Link
              href={`/dashboard/projects/${project.id}`}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
            >
              <FolderKanban className="h-3 w-3" aria-hidden />
              Filed in {project.name}
            </Link>
          </p>
        )}
      </div>

      <RunDetail workspaceId={workspaceId} run={run} />
    </div>
  );
}
