'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { api } from './client';
import type { AgentLimits, AgentRun, ApprovalPolicy, PlannedStep } from './agents';

/**
 * Workflow client.
 *
 * Workflow runs are the same shape as agent runs — deliberately, because
 * they execute through the same engine — so this module reuses `AgentRun`
 * and the existing run hooks rather than declaring a parallel type that
 * would drift. What differs is only how the steps are decided.
 */

export interface WorkflowDefinition {
  id: string;
  workspaceId: string;
  lineageId: string;
  name: string;
  description?: string;
  instructions: string;
  steps: PlannedStep[];
  allowedTools: string[];
  approvalPolicy: ApprovalPolicy;
  limits: AgentLimits;
  version: number;
  previousVersionId?: string;
  createdBy: string;
  createdAt: number;
  archived: boolean;
}

/**
 * A workflow run's provenance. `authored` is a third value beside the
 * agent runtime's `local` and `model`: nothing was improvised, so neither
 * of those labels would be true.
 */
export interface WorkflowRunRuntime {
  mode: 'authored';
  notice: string;
  planOrigin?: 'model' | 'local-deterministic' | 'authored';
}

export interface WorkflowRunResult {
  run: AgentRun;
  runtime: WorkflowRunRuntime;
}

export interface CreateWorkflowInput {
  name: string;
  description?: string;
  instructions?: string;
  steps: PlannedStep[];
  allowedTools?: string[];
  approvalPolicy?: ApprovalPolicy;
  limits?: Partial<AgentLimits>;
}

export type UpdateWorkflowInput = Partial<CreateWorkflowInput>;

const WORKFLOWS_KEY = 'workflows';
const RUNS_KEY = 'agent-runs';

export function useWorkflows(
  workspaceId: string,
  options?: { includeArchived?: boolean; enabled?: boolean },
): UseQueryResult<WorkflowDefinition[]> {
  const includeArchived = options?.includeArchived ?? false;
  return useQuery({
    queryKey: [WORKFLOWS_KEY, workspaceId, includeArchived],
    queryFn: () =>
      api.get<WorkflowDefinition[]>(
        `/api/workspaces/${workspaceId}/workflows?includeArchived=${includeArchived}`,
      ),
    enabled: !!workspaceId && options?.enabled !== false,
  });
}

export function useWorkflowHistory(
  workspaceId: string,
  workflowId: string,
  options?: { enabled?: boolean },
): UseQueryResult<WorkflowDefinition[]> {
  return useQuery({
    queryKey: [WORKFLOWS_KEY, workspaceId, 'history', workflowId],
    queryFn: () =>
      api.get<WorkflowDefinition[]>(
        `/api/workspaces/${workspaceId}/workflows/${workflowId}/history`,
      ),
    enabled: !!workspaceId && !!workflowId && options?.enabled !== false,
  });
}

export function useCreateWorkflow(
  workspaceId: string,
): UseMutationResult<WorkflowDefinition, Error, CreateWorkflowInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input) =>
      api.post<WorkflowDefinition>(`/api/workspaces/${workspaceId}/workflows`, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [WORKFLOWS_KEY, workspaceId] });
    },
  });
}

/** Editing returns a NEW workflow with a new id — versions are immutable. */
export function useUpdateWorkflow(
  workspaceId: string,
): UseMutationResult<
  WorkflowDefinition,
  Error,
  { workflowId: string; changes: UpdateWorkflowInput }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ workflowId, changes }) =>
      api.patch<WorkflowDefinition>(
        `/api/workspaces/${workspaceId}/workflows/${workflowId}`,
        changes,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [WORKFLOWS_KEY, workspaceId] });
    },
  });
}

export function useArchiveWorkflow(
  workspaceId: string,
): UseMutationResult<WorkflowDefinition, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (workflowId) =>
      api.delete<WorkflowDefinition>(`/api/workspaces/${workspaceId}/workflows/${workflowId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [WORKFLOWS_KEY, workspaceId] });
    },
  });
}

export function useStartWorkflowRun(
  workspaceId: string,
): UseMutationResult<WorkflowRunResult, Error, { workflowId: string; task: string }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ workflowId, task }) =>
      api.post<WorkflowRunResult>(
        `/api/workspaces/${workspaceId}/workflows/${workflowId}/runs`,
        { task },
      ),
    onSuccess: () => {
      // Workflow runs live in the same run store as agent runs, so the
      // agent run queries are the ones that go stale.
      queryClient.invalidateQueries({ queryKey: [RUNS_KEY, workspaceId] });
    },
  });
}
