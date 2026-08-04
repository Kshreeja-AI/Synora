'use client';

import { useState } from 'react';
import { Archive, Bot, Loader2, Play, Plus } from 'lucide-react';
import { Button, EmptyState, Spinner } from '@synora/design-system';
import { toast } from 'sonner';
import { useCurrentWorkspace } from '@/hooks/useCurrentWorkspace';
import {
  useAgentRuns,
  useAgents,
  useArchiveAgent,
  useStartRun,
  type Agent,
  type RunRuntime,
} from '@/lib/api/agents';
import { CreateAgentDialog } from '@/components/agents/CreateAgentDialog';
import { RunDetail } from '@/components/agents/RunDetail';
import { RuntimeNotice } from '@/components/agents/RuntimeNotice';

/**
 * The agent workspace: define agents, run them, watch what they did, and
 * approve or refuse the steps they pause on.
 *
 * Workspace-scoped but not workspace-routed — the path is /agents, so the
 * active workspace is the scope, matching how the knowledge pages work.
 */
export default function AgentsPage() {
  const { currentWorkspace } = useCurrentWorkspace();
  const workspaceId = currentWorkspace?.id || '';

  const [createOpen, setCreateOpen] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [task, setTask] = useState('');
  const [lastRuntime, setLastRuntime] = useState<RunRuntime | null>(null);
  const [openRunId, setOpenRunId] = useState<string | null>(null);

  const { data: agents = [], isLoading, error } = useAgents(workspaceId);
  const { data: runs = [] } = useAgentRuns(workspaceId, {
    lineageId: selectedAgent?.lineageId,
    enabled: !!selectedAgent,
  });
  const startRun = useStartRun(workspaceId);
  const archive = useArchiveAgent(workspaceId);

  function run() {
    if (!selectedAgent || !task.trim()) return;
    startRun.mutate(
      { agentId: selectedAgent.id, task: task.trim() },
      {
        onSuccess: (result) => {
          // The provenance label is kept and shown, never discarded — the
          // user must be able to tell a deterministic run from a real one.
          setLastRuntime(result.runtime);
          setOpenRunId(result.run.id);
          setTask('');
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  if (!workspaceId) {
    return (
      <div className="p-6">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Agents</h1>
          <p className="text-sm text-muted-foreground">
            Bounded executors: each one runs a finite plan inside limits you set, and every
            step it takes is recorded.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New agent
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          {error.message}
        </div>
      )}

      {isLoading ? (
        <Spinner />
      ) : agents.length === 0 ? (
        <EmptyState
          icon={<Bot className="h-8 w-8" />}
          title="No agents yet"
          description="An agent turns a task into a plan and runs it under limits you choose — which tools it may use, and when it must stop and ask you."
          action={<Button onClick={() => setCreateOpen(true)}>Create your first agent</Button>}
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
          <ul className="space-y-2">
            {agents.map((agent) => (
              <li key={agent.id}>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedAgent(agent);
                    setOpenRunId(null);
                    setLastRuntime(null);
                  }}
                  aria-current={selectedAgent?.id === agent.id}
                  className={`w-full rounded-md border p-3 text-left text-sm transition ${
                    selectedAgent?.id === agent.id ? 'border-primary bg-muted' : 'hover:bg-muted'
                  }`}
                >
                  <span className="font-medium">{agent.name}</span>
                  <span className="ml-2 text-xs text-muted-foreground">v{agent.version}</span>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {agent.allowedTools.length === 0
                      ? 'no tools'
                      : `${agent.allowedTools.length} tool${agent.allowedTools.length === 1 ? '' : 's'}`}
                    {' · asks '}
                    {agent.approvalPolicy === 'nothing'
                      ? 'never'
                      : agent.approvalPolicy === 'everything'
                        ? 'every tool'
                        : 'before changes'}
                  </p>
                </button>
              </li>
            ))}
          </ul>

          <div className="space-y-6">
            {!selectedAgent ? (
              <p className="text-sm text-muted-foreground">
                Select an agent to run it and see its history.
              </p>
            ) : (
              <>
                <section className="space-y-3 rounded-md border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h2 className="font-semibold">{selectedAgent.name}</h2>
                      <p className="text-sm text-muted-foreground">
                        {selectedAgent.description || selectedAgent.instructions}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        archive.mutate(selectedAgent.id, {
                          onSuccess: () => {
                            toast.success('Agent archived — its history is kept');
                            setSelectedAgent(null);
                          },
                          onError: (e) => toast.error(e.message),
                        })
                      }
                      disabled={archive.isPending}
                    >
                      <Archive className="mr-1 h-4 w-4" />
                      Archive
                    </Button>
                  </div>

                  <p className="text-xs text-muted-foreground">
                    Limits: at most {selectedAgent.limits.maxSteps} steps,{' '}
                    {selectedAgent.limits.maxToolCalls} tool calls,{' '}
                    {Math.round(selectedAgent.limits.maxDurationMs / 1000)}s wall clock,{' '}
                    {selectedAgent.limits.maxRetriesPerStep} retries per step.
                  </p>

                  <div className="space-y-2">
                    <label htmlFor="agent-task" className="text-sm font-medium">
                      Give it a task
                    </label>
                    <textarea
                      id="agent-task"
                      value={task}
                      onChange={(e) => setTask(e.target.value)}
                      rows={3}
                      placeholder="Describe what you want done"
                      className="w-full rounded-md border border-input bg-background p-3 text-sm"
                    />
                    <Button onClick={run} disabled={startRun.isPending || !task.trim()}>
                      {startRun.isPending ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Play className="mr-2 h-4 w-4" />
                      )}
                      Run
                    </Button>
                  </div>

                  {lastRuntime && <RuntimeNotice runtime={lastRuntime} />}
                </section>

                <section className="space-y-3">
                  <h3 className="font-semibold">
                    Run history{runs.length > 0 ? ` (${runs.length})` : ''}
                  </h3>
                  {runs.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      This agent has not run yet.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {runs.map((r) => (
                        <li key={r.id} className="rounded-md border">
                          <button
                            type="button"
                            onClick={() => setOpenRunId(openRunId === r.id ? null : r.id)}
                            aria-expanded={openRunId === r.id}
                            className="flex w-full flex-wrap items-center gap-3 p-3 text-left text-sm hover:bg-muted"
                          >
                            <span className="font-medium">{r.state.replace('_', ' ')}</span>
                            <span className="flex-1 truncate text-muted-foreground">{r.task}</span>
                            <span className="text-xs text-muted-foreground">
                              v{r.agentVersion} · {new Date(r.createdAt).toLocaleString()}
                            </span>
                          </button>
                          {openRunId === r.id && (
                            <div className="border-t p-4">
                              <RunDetail workspaceId={workspaceId} run={r} />
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </>
            )}
          </div>
        </div>
      )}

      <CreateAgentDialog
        workspaceId={workspaceId}
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />
    </div>
  );
}
