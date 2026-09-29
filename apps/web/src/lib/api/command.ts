'use client';

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { api } from './client';

/**
 * The Universal Command Layer, from the browser.
 *
 * The layer's whole point is that it never blurs outcomes, so this client
 * never collapses them either: `state` is passed through verbatim and the
 * UI branches on it. A client that mapped nine server states onto "success
 * or error" would throw away exactly the distinctions the backend was built
 * to preserve — and the person would be back to guessing whether anything
 * happened.
 */

/**
 * Mirrors the server's ExecutionState. `executed` is a separate field on
 * purpose: it is true ONLY when a real capability ran, so no caller can
 * infer "something happened" from a 200.
 */
export type CommandState =
  | 'completed'
  | 'not-authorized'
  | 'unavailable'
  | 'not-implemented'
  | 'not-bound'
  | 'waiting-approval'
  | 'needs-input'
  | 'rejected'
  | 'expired'
  | 'failed';

export interface CommandOutcome {
  executionId: string;
  state: CommandState;
  understood: string;
  capabilityId: string | null;
  riskClass: string;
  message: string;
  result?: unknown;
  executed: boolean;
  /** Where the person can do this themselves, when Synora knows. */
  appPath?: string;
  /** On needs-input only: the concrete choices behind the question. */
  candidates?: { id: string; name: string }[];
  /**
   * Whether SYNORA can take this back — not whether a person could undo it
   * by hand somewhere. Absent unless the server recorded a real undo
   * target, so the UI can never offer a button on a promise nobody made.
   */
  undoable?: true;
}

/** The answer to an undo request: it happened, or it was refused and why. */
export type UndoOutcome =
  | { executionId: string; undone: true; kind: string; message: string; undoneAt: string }
  | {
      executionId: string;
      undone: false;
      reason: 'not-reversible' | 'already-undone' | 'not-completed';
      message: string;
    };

/** A decision that was not carried out, and why. */
export interface CommandRefusal {
  executed: false;
  decision: 'refused';
  state: string;
  message: string;
}

export interface CommandDecisionOutcome extends CommandOutcome {
  decidedBy: string;
  decision: 'approved' | 'rejected';
}

export interface CommandExecutionListItem {
  id: string;
  commandText: string;
  capabilityId: string | null;
  riskClass: string;
  state: CommandState;
  approvalState: string;
  approvalExpiresAt: string | null;
  requestedBy: string;
  createdAt: string;
  message: string | null;
}

export const COMMAND_EXECUTIONS_KEY = 'command-executions';

export function useCommandExecutions(
  workspaceId: string,
  options?: { pendingOnly?: boolean; enabled?: boolean },
): UseQueryResult<{ items: CommandExecutionListItem[]; total: number }> {
  const pendingOnly = options?.pendingOnly ?? false;
  return useQuery({
    queryKey: [COMMAND_EXECUTIONS_KEY, workspaceId, pendingOnly],
    queryFn: () =>
      api.get<{ items: CommandExecutionListItem[]; total: number }>(
        `/api/command/${workspaceId}/executions${pendingOnly ? '?pending=true' : ''}`,
      ),
    enabled: !!workspaceId && options?.enabled !== false,
  });
}

/**
 * Runs a command. Named `useRunCommand`, not `useCommand`, because the
 * distinction between asking and doing is the entire subject of this layer
 * and the function name should not be the one place it goes soft.
 */
export function useRunCommand(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (command: string) =>
      api.post<CommandOutcome>(`/api/command/${workspaceId}/execute`, { command }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [COMMAND_EXECUTIONS_KEY, workspaceId] });
    },
  });
}

/**
 * Approves or rejects a pending command.
 *
 * The body carries ONLY the decision and an optional reason. There is
 * deliberately no field naming what to run — the server re-derives the
 * action from its own record, so there is nothing here for a tampered
 * client to influence. Adding a convenience parameter to this call would
 * quietly undo the strongest guarantee the approval gate has.
 */
export function useDecideCommand(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { executionId: string; decision: 'approved' | 'rejected'; reason?: string }) =>
      api.post<CommandDecisionOutcome | CommandRefusal>(
        `/api/command/${workspaceId}/executions/${input.executionId}/decision`,
        { decision: input.decision, ...(input.reason ? { reason: input.reason } : {}) },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [COMMAND_EXECUTIONS_KEY, workspaceId] });
    },
  });
}

/**
 * Reverses something Synora did.
 *
 * NO BODY, deliberately — the same shape as the decision call above, for
 * the same reason. What gets reversed was declared by the executor that did
 * the original work and stored then; there is nothing here a tampered
 * client could point somewhere else.
 */
export function useUndoCommand(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (executionId: string) =>
      api.post<UndoOutcome>(`/api/command/${workspaceId}/executions/${executionId}/undo`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [COMMAND_EXECUTIONS_KEY, workspaceId] });
    },
  });
}

export function isRefusal(
  outcome: CommandDecisionOutcome | CommandRefusal,
): outcome is CommandRefusal {
  return outcome.decision === 'refused';
}

/* ------------------------------------------------------------------ *
 * Multi-action requests
 * ------------------------------------------------------------------ */

/** A step's readiness, or `skipped` for one execution never reached. */
export type PlanStepState = CommandState | 'skipped' | 'pending';

export interface PlannedStep {
  index: number;
  text: string;
  understood: string;
  capabilityId: string | null;
  riskClass: string;
  requiredPermission: string | null;
  permitted: boolean;
  needsApproval: boolean;
  bound: boolean;
  readiness: CommandState;
  message: string;
  dependsOn: number[];
  /** Set when this step's input will never exist because an earlier one won't run. */
  blockedBy?: number;
  appPath?: string;
}

export type CommandPlan =
  | {
      status: 'planned';
      originalText: string;
      steps: PlannedStep[];
      summary: string;
      observations: { kind: string; detail: string }[];
      executed: false;
    }
  | { status: 'cannot-plan'; originalText: string; question: string; executed: false };

export interface PlanRunStep {
  index: number;
  text: string;
  capabilityId: string | null;
  state: PlanStepState;
  message: string;
  dependsOn: number[];
  executionId?: string;
}

export interface PlanRunResult {
  planId: string;
  status:
    | 'completed'
    | 'waiting-approval'
    | 'needs-input'
    | 'partially-completed'
    | 'failed'
    | 'rejected'
    | 'cannot-plan';
  originalText: string;
  steps: PlanRunStep[];
  summary: string;
  stoppedAtStep?: number;
  stoppedReason?: string;
  completedCount: number;
  /**
   * Whether asking again would repeat something already done. Passed
   * through verbatim — the UI must never soften this into "try again",
   * because the whole point is that repeating can duplicate a side effect.
   */
  safeToRetry: boolean;
}

/**
 * Resolves a sentence into an ordered plan WITHOUT running any of it.
 *
 * Separate from running on purpose: a person deciding whether to set four
 * actions in motion should be able to read them first, and a preview that
 * quietly executed would make that reading meaningless.
 */
export function usePlanCommand(workspaceId: string) {
  return useMutation({
    mutationFn: (command: string) =>
      api.post<CommandPlan>(`/api/command/${workspaceId}/plan`, { command }),
  });
}

/** Runs a planned request, in order, stopping at the first step that cannot proceed. */
export function useRunPlan(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (command: string) =>
      api.post<PlanRunResult>(`/api/command/${workspaceId}/plan/execute`, { command }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [COMMAND_EXECUTIONS_KEY, workspaceId] });
    },
  });
}
