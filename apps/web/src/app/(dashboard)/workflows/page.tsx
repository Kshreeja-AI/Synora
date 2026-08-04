'use client';

import { useState } from 'react';
import {
  Archive,
  FlaskConical,
  Loader2,
  Pencil,
  Play,
  Plus,
  Workflow as WorkflowIcon,
} from 'lucide-react';
import { Button, EmptyState, Spinner } from '@synora/design-system';
import { toast } from 'sonner';
import { useCurrentWorkspace } from '@/hooks/useCurrentWorkspace';
import { useAgentRuns, type PlannedStep } from '@/lib/api/agents';
import {
  useArchiveWorkflow,
  useCreateWorkflow,
  useDryRunWorkflow,
  useStartWorkflowRun,
  useUpdateWorkflow,
  useWorkflows,
  type DryRunReport,
  type WorkflowDefinition,
} from '@/lib/api/workflows';
import { StepBuilder } from '@/components/workflows/StepBuilder';
import { RunDetail } from '@/components/agents/RunDetail';
import { SchedulePanel } from '@/components/workflows/SchedulePanel';
import { TriggerPanel } from '@/components/workflows/TriggerPanel';

/**
 * The workflow workspace: author a sequence, run it, inspect what happened.
 *
 * Run inspection reuses `RunDetail` unchanged, because a workflow run is
 * an engine run — same states, same steps, same approval affordances. A
 * separate viewer would be a second thing to keep correct for no gain.
 */
export default function WorkflowsPage() {
  const { currentWorkspace } = useCurrentWorkspace();
  const workspaceId = currentWorkspace?.id || '';

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [allowedTools, setAllowedTools] = useState('');
  const [steps, setSteps] = useState<PlannedStep[]>([]);
  const [selected, setSelected] = useState<WorkflowDefinition | null>(null);
  const [task, setTask] = useState('');
  const [openRunId, setOpenRunId] = useState<string | null>(null);
  const [lastNotice, setLastNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<PlannedStep[] | null>(null);
  const [dryRunReport, setDryRunReport] = useState<DryRunReport | null>(null);

  const { data: workflows = [], isLoading, error } = useWorkflows(workspaceId);
  const { data: runs = [] } = useAgentRuns(workspaceId, {
    lineageId: selected?.lineageId,
    enabled: !!selected,
  });
  const create = useCreateWorkflow(workspaceId);
  const archive = useArchiveWorkflow(workspaceId);
  const startRun = useStartWorkflowRun(workspaceId);
  const update = useUpdateWorkflow(workspaceId);
  const dryRun = useDryRunWorkflow(workspaceId);

  function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    create.mutate(
      {
        name: name.trim(),
        steps,
        allowedTools: allowedTools
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      },
      {
        onSuccess: () => {
          toast.success('Workflow saved');
          setCreating(false);
          setName('');
          setAllowedTools('');
          setSteps([]);
        },
        // The server refuses a sequence that could never run, and its
        // message names the offending step. Surfacing it verbatim is more
        // useful than "invalid workflow".
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
          <h1 className="text-2xl font-semibold">Workflows</h1>
          <p className="text-sm text-muted-foreground">
            Steps you write down, run exactly as written, every time. Unlike an agent, nothing
            here improvises.
          </p>
        </div>
        <Button onClick={() => setCreating((v) => !v)}>
          <Plus className="mr-2 h-4 w-4" />
          New workflow
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          {error.message}
        </div>
      )}

      {creating && (
        <form onSubmit={submitCreate} className="space-y-4 rounded-md border p-4">
          <div className="space-y-1">
            <label htmlFor="wf-name" className="text-sm font-medium">
              Name
            </label>
            <input
              id="wf-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="wf-tools" className="text-sm font-medium">
              Allowed tools
            </label>
            <input
              id="wf-tools"
              value={allowedTools}
              onChange={(e) => setAllowedTools(e.target.value)}
              placeholder="comma-separated tool ids — leave empty for none"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
            <p className="text-xs text-muted-foreground">
              A step naming a tool outside this list is refused when you save, not when you
              run — so a saved workflow is a workflow that can actually run.
            </p>
          </div>

          <StepBuilder steps={steps} onChange={setSteps} />

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending || steps.length === 0}>
              {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save workflow
            </Button>
          </div>
        </form>
      )}

      {isLoading ? (
        <Spinner />
      ) : workflows.length === 0 && !creating ? (
        <EmptyState
          icon={<WorkflowIcon className="h-8 w-8" />}
          title="No workflows yet"
          description="A workflow runs the steps you write, in order, every time. Choose one when you want the same result rather than a fresh decision."
          action={<Button onClick={() => setCreating(true)}>Create your first workflow</Button>}
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
          <ul className="space-y-2">
            {workflows.map((wf) => (
              <li key={wf.id}>
                <button
                  type="button"
                  onClick={() => {
                    setSelected(wf);
                    setOpenRunId(null);
                    setLastNotice(null);
                    setEditing(null);
                    setDryRunReport(null);
                  }}
                  aria-current={selected?.id === wf.id}
                  className={`w-full rounded-md border p-3 text-left text-sm transition ${
                    selected?.id === wf.id ? 'border-primary bg-muted' : 'hover:bg-muted'
                  }`}
                >
                  <span className="font-medium">{wf.name}</span>
                  <span className="ml-2 text-xs text-muted-foreground">v{wf.version}</span>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {wf.steps.length} step{wf.steps.length === 1 ? '' : 's'}
                    {' · asks '}
                    {wf.approvalPolicy === 'nothing'
                      ? 'never'
                      : wf.approvalPolicy === 'everything'
                        ? 'every tool'
                        : 'before changes'}
                  </p>
                </button>
              </li>
            ))}
          </ul>

          <div className="space-y-6">
            {!selected ? (
              <p className="text-sm text-muted-foreground">
                Select a workflow to run it and see its history.
              </p>
            ) : (
              <>
                <section className="space-y-3 rounded-md border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h2 className="font-semibold">{selected.name}</h2>
                    <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEditing(editing ? null : selected.steps)}
                    >
                      <Pencil className="mr-1 h-4 w-4" />
                      {editing ? 'Cancel edit' : 'Edit steps'}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        archive.mutate(selected.id, {
                          onSuccess: () => {
                            toast.success('Workflow archived — its history is kept');
                            setSelected(null);
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
                  </div>

                  {editing ? (
                    <div className="space-y-3 rounded-md border p-3">
                      {/* Same version warning as agents, for the same
                          reason: a run history pointing at "old" step
                          lists is confusing to someone who believed they
                          edited in place. */}
                      <p className="text-sm text-muted-foreground">
                        Saving creates version {selected.version + 1}. Version {selected.version}{' '}
                        is kept, because every past run refers to the exact version it ran under.
                      </p>
                      <StepBuilder steps={editing} onChange={setEditing} />
                      <Button
                        onClick={() =>
                          update.mutate(
                            { workflowId: selected.id, changes: { steps: editing } },
                            {
                              onSuccess: (next) => {
                                toast.success(`Saved as version ${next.version}`);
                                // Switch to the NEW version: the id held a
                                // moment ago is now superseded.
                                setSelected(next);
                                setEditing(null);
                              },
                              // The server refuses a sequence that could
                              // never run and names the offending step.
                              onError: (e) => toast.error(e.message),
                            },
                          )
                        }
                        disabled={update.isPending || editing.length === 0}
                      >
                        {update.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Save as version {selected.version + 1}
                      </Button>
                    </div>
                  ) : null}

                  <ol className="space-y-1 text-sm text-muted-foreground">
                    {selected.steps.map((s) => (
                      <li key={s.id}>
                        <span className="font-mono text-xs">{s.id}</span> · {s.description}
                        {s.kind === 'tool' && (
                          <span className="text-xs">
                            {' '}
                            ({s.toolId}
                            {s.mutating === false ? ', read-only' : ', treated as mutating'})
                          </span>
                        )}
                      </li>
                    ))}
                  </ol>

                  <div className="space-y-2">
                    <label htmlFor="wf-task" className="text-sm font-medium">
                      Note for this run <span className="text-muted-foreground">(optional)</span>
                    </label>
                    <input
                      id="wf-task"
                      value={task}
                      onChange={(e) => setTask(e.target.value)}
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    />
                    {/* Said plainly because it is the opposite of how the
                        agent page works, and the difference matters. */}
                    <p className="text-xs text-muted-foreground">
                      This is recorded with the run for your own reference. It does not change
                      what runs — the steps above do, every time.
                    </p>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        onClick={() =>
                          dryRun.mutate(selected.id, {
                            onSuccess: setDryRunReport,
                            onError: (e) => toast.error(e.message),
                          })
                        }
                        disabled={dryRun.isPending}
                      >
                        {dryRun.isPending ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <FlaskConical className="mr-2 h-4 w-4" />
                        )}
                        Dry run
                      </Button>
                      <Button
                        onClick={() =>
                          startRun.mutate(
                            { workflowId: selected.id, task },
                            {
                              onSuccess: (result) => {
                                setLastNotice(result.runtime.notice);
                                setOpenRunId(result.run.id);
                                setDryRunReport(null);
                                setTask('');
                              },
                              onError: (e) => toast.error(e.message),
                            },
                          )
                        }
                        disabled={startRun.isPending}
                      >
                        {startRun.isPending ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Play className="mr-2 h-4 w-4" />
                        )}
                        Run
                      </Button>
                    </div>
                  </div>

                  {dryRunReport && (
                    <div
                      role="note"
                      className={`space-y-2 rounded-md border p-3 text-sm ${
                        dryRunReport.wouldStart
                          ? 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200'
                          : 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200'
                      }`}
                    >
                      <p className="font-semibold">
                        {dryRunReport.wouldStart
                          ? 'Would start — nothing was executed'
                          : 'Would not start — nothing was executed'}
                      </p>
                      {dryRunReport.blockers.length > 0 && (
                        <ul className="list-inside list-disc">
                          {dryRunReport.blockers.map((b, i) => (
                            <li key={i}>{b}</li>
                          ))}
                        </ul>
                      )}
                      <p className="text-xs">
                        {dryRunReport.projected.toolCalls} tool call
                        {dryRunReport.projected.toolCalls === 1 ? '' : 's'} projected of{' '}
                        {dryRunReport.projected.maxToolCalls} allowed ·{' '}
                        {dryRunReport.projected.approvalPauses} step
                        {dryRunReport.projected.approvalPauses === 1 ? '' : 's'} would pause for
                        approval
                      </p>
                      {dryRunReport.steps.some((s) => s.problems.length > 0) && (
                        <ul className="space-y-1 text-xs">
                          {dryRunReport.steps
                            .filter((s) => s.problems.length > 0)
                            .map((s) => (
                              <li key={s.stepId}>
                                <span className="font-mono">{s.stepId}</span>:{' '}
                                {s.problems.join('; ')}
                              </li>
                            ))}
                        </ul>
                      )}
                      <p className="text-xs italic opacity-80">{dryRunReport.caveats[0]}</p>
                    </div>
                  )}

                  {lastNotice && (
                    <div
                      role="note"
                      className="rounded-md border border-sky-300 bg-sky-50 p-3 text-sm text-sky-900 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-200"
                    >
                      <p className="font-semibold">AUTHORED — repeatable, not improvised</p>
                      <p>{lastNotice}</p>
                    </div>
                  )}
                </section>

                <SchedulePanel workspaceId={workspaceId} workflowId={selected.id} />
                <TriggerPanel workspaceId={workspaceId} workflowId={selected.id} />

                <section className="space-y-3">
                  <h3 className="font-semibold">
                    Run history{runs.length > 0 ? ` (${runs.length})` : ''}
                  </h3>
                  {runs.length === 0 ? (
                    <p className="text-sm text-muted-foreground">This workflow has not run yet.</p>
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
                            <span className="flex-1 truncate text-muted-foreground">
                              {r.task || '(no note)'}
                            </span>
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
    </div>
  );
}
