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
}

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

export function isRefusal(
  outcome: CommandDecisionOutcome | CommandRefusal,
): outcome is CommandRefusal {
  return outcome.decision === 'refused';
}
