'use client';

import { useState } from 'react';
import { Check, Loader2, ShieldAlert, X } from 'lucide-react';
import { Button } from '@synora/design-system';
import { toast } from 'sonner';
import {
  isTerminalRun,
  useApproveStep,
  useCancelRun,
  useRejectStep,
  type AgentRun,
  type RunState,
  type StepState,
} from '@/lib/api/agents';

/**
 * One run, in full: its plan, every step's outcome, and the append-only
 * log.
 *
 * The design question this answers is the one a person actually asks about
 * an autonomous system — "what did it do?" — so nothing is summarised away.
 * Failed steps show their error, retries show their attempt count, and the
 * log is rendered verbatim rather than being filtered into a happy path.
 */

const RUN_STATE_STYLES: Record<RunState, string> = {
  pending: 'bg-muted text-muted-foreground',
  planning: 'bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200',
  awaiting_approval: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  running: 'bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200',
  completed: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
  failed: 'bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200',
  cancelled: 'bg-muted text-muted-foreground',
  timed_out: 'bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200',
};

const STEP_STATE_LABEL: Record<StepState, string> = {
  pending: 'pending',
  awaiting_approval: 'waiting for you',
  running: 'running',
  succeeded: 'succeeded',
  failed: 'failed',
  skipped: 'skipped',
};

function formatTime(ms: number): string {
  return new Date(ms).toLocaleString();
}

export function RunDetail({ workspaceId, run }: { workspaceId: string; run: AgentRun }) {
  const [rejectReason, setRejectReason] = useState('');
  const approve = useApproveStep(workspaceId);
  const reject = useRejectStep(workspaceId);
  const cancel = useCancelRun(workspaceId);

  const pending = run.pendingApproval;
  const terminal = isTerminalRun(run.state);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${RUN_STATE_STYLES[run.state]}`}
        >
          {run.state.replace('_', ' ')}
        </span>
        <span className="text-sm text-muted-foreground">
          started {formatTime(run.createdAt)}
          {run.finishedAt ? ` · finished ${formatTime(run.finishedAt)}` : ''}
        </span>
        <span className="text-sm text-muted-foreground">
          {run.toolCallsUsed} tool call{run.toolCallsUsed === 1 ? '' : 's'}
        </span>
        {!terminal && (
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              cancel.mutate(run.id, {
                onSuccess: () => toast.success('Run cancelled'),
                onError: (e) => toast.error(e.message),
              })
            }
            disabled={cancel.isPending}
          >
            {cancel.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Stop this run'}
          </Button>
        )}
      </div>

      <div>
        <h4 className="text-sm font-semibold">Task</h4>
        <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{run.task}</p>
      </div>

      {run.error && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          {run.error}
        </div>
      )}

      {pending && (
        <div className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/40">
          <div className="flex items-start gap-2">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden />
            <div>
              <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                Waiting for your decision on step {pending.stepId}
              </p>
              {/* Nothing has run yet. There is no execute-first path, so a
                  rejection here means the step never happens at all. */}
              <p className="mt-1 text-sm text-amber-900 dark:text-amber-200">{pending.reason}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={() =>
                approve.mutate(
                  { runId: run.id, stepId: pending.stepId },
                  {
                    onSuccess: () => toast.success('Step approved'),
                    onError: (e) => toast.error(e.message),
                  },
                )
              }
              disabled={approve.isPending || reject.isPending}
            >
              {approve.isPending ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Check className="mr-1 h-4 w-4" />
              )}
              Approve and continue
            </Button>
            <input
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Reason (optional)"
              aria-label="Rejection reason"
              className="h-9 flex-1 min-w-[12rem] rounded-md border border-input bg-background px-3 text-sm"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                reject.mutate(
                  { runId: run.id, stepId: pending.stepId, reason: rejectReason || undefined },
                  {
                    onSuccess: () => toast.success('Step rejected — the run has ended'),
                    onError: (e) => toast.error(e.message),
                  },
                )
              }
              disabled={approve.isPending || reject.isPending}
            >
              <X className="mr-1 h-4 w-4" />
              Reject
            </Button>
          </div>
          {/* Said out loud because it surprises people: rejecting does not
              skip the step and carry on. */}
          <p className="text-xs text-amber-800 dark:text-amber-300">
            Rejecting ends the whole run. A refused step is never skipped past.
          </p>
        </div>
      )}

      <div>
        <h4 className="text-sm font-semibold">
          Steps{run.plan ? ` (${run.plan.origin === 'model' ? 'planned by a model' : 'deterministic plan'})` : ''}
        </h4>
        {run.steps.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">
            No steps ran. If the run failed, the reason is above — a plan the agent was not
            permitted to execute is refused whole rather than run in part.
          </p>
        ) : (
          <ol className="mt-2 space-y-2">
            {run.steps.map((record) => (
              <li key={record.step.id} className="rounded-md border p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground">{record.step.id}</span>
                  <span className="font-medium">{record.step.description}</span>
                  <span className="text-xs text-muted-foreground">
                    {STEP_STATE_LABEL[record.state]}
                  </span>
                  {record.attempts > 1 && (
                    <span className="text-xs text-muted-foreground">
                      · {record.attempts} attempts
                    </span>
                  )}
                  {record.approvedBy && (
                    <span className="text-xs text-muted-foreground">
                      · approved by {record.approvedBy}
                    </span>
                  )}
                </div>
                {record.step.kind === 'tool' && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    tool: {record.step.toolId}
                    {record.step.mutating === false ? ' (declared read-only)' : ' (treated as mutating)'}
                  </p>
                )}
                {record.output && (
                  <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-xs">
                    {record.output}
                  </pre>
                )}
                {record.error && (
                  <p className="mt-2 text-xs text-red-700 dark:text-red-300">{record.error}</p>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>

      {run.result && (
        <div>
          <h4 className="text-sm font-semibold">Result</h4>
          <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-muted p-3 text-sm">
            {run.result}
          </pre>
        </div>
      )}

      <details>
        <summary className="cursor-pointer text-sm font-semibold">
          Full log ({run.log.length} entries)
        </summary>
        <ul className="mt-2 space-y-1">
          {run.log.map((entry, i) => (
            <li key={i} className="font-mono text-xs text-muted-foreground">
              {formatTime(entry.at)} · {entry.event}
              {entry.detail ? ` · ${entry.detail}` : ''}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
