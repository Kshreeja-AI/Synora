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

/**
 * A dry run's report: what the system can determine WITHOUT executing the
 * workflow. `executed` is always `false` here — it exists on the type so a
 * dry-run report and a real run result can never be mistaken for each
 * other by shape alone.
 */
export interface DryRunStepCheck {
  stepId: string;
  kind: 'generate' | 'tool';
  description: string;
  toolId?: string;
  pausesForApproval: boolean;
  treatedAsMutating: boolean;
  unresolvedReferences: string[];
  problems: string[];
  unknowns: string[];
}

export interface DryRunReport {
  workflowId: string;
  workflowName: string;
  workflowVersion: number;
  executed: false;
  wouldStart: boolean;
  blockers: string[];
  steps: DryRunStepCheck[];
  projected: {
    steps: number;
    toolCalls: number;
    approvalPauses: number;
    maxSteps: number;
    maxToolCalls: number;
    maxDurationMs: number;
  };
  caveats: string[];
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

export type ScheduleKind = 'interval' | 'daily';

export interface WorkflowSchedule {
  id: string;
  workspaceId: string;
  workflowId: string;
  kind: ScheduleKind;
  intervalMs?: number;
  atMinuteUtc?: number;
  enabled: boolean;
  createdBy: string;
  createdAt: number;
  nextFireAt: number;
  lastFiredAt?: number;
  /**
   * Occurrences that came due while nothing was running. Never replayed,
   * always counted — surfaced in the UI because "it did not run" is
   * information the owner needs, and absence is not something to absorb.
   */
  missedOccurrences: number;
  lastMissedAt?: number;
}

export interface CreateScheduleInput {
  kind: ScheduleKind;
  intervalMs?: number;
  atMinuteUtc?: number;
}

/**
 * A trigger starts a workflow from OUTSIDE Synora. The object here never
 * carries the raw secret — only `secretPreview`, a non-secret display
 * prefix. The raw secret exists exactly once, in `CreatedTrigger` below,
 * returned only by the create call.
 */
export interface WorkflowTrigger {
  id: string;
  workspaceId: string;
  workflowId: string;
  secretPreview: string;
  enabled: boolean;
  createdBy: string;
  createdAt: number;
  lastFiredAt?: number;
  firedCount: number;
}

export interface CreatedTrigger {
  trigger: WorkflowTrigger;
  /** Shown once. There is no endpoint that will ever return this again. */
  secret: string;
}

const WORKFLOWS_KEY = 'workflows';
const SCHEDULES_KEY = 'workflow-schedules';
const TRIGGERS_KEY = 'workflow-triggers';
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

export function useWorkflowSchedules(
  workspaceId: string,
  workflowId: string,
  options?: { enabled?: boolean },
): UseQueryResult<WorkflowSchedule[]> {
  return useQuery({
    queryKey: [SCHEDULES_KEY, workspaceId, workflowId],
    queryFn: () =>
      api.get<WorkflowSchedule[]>(
        `/api/workspaces/${workspaceId}/workflows/${workflowId}/schedules`,
      ),
    enabled: !!workspaceId && !!workflowId && options?.enabled !== false,
  });
}

export function useCreateSchedule(
  workspaceId: string,
): UseMutationResult<WorkflowSchedule, Error, { workflowId: string; input: CreateScheduleInput }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ workflowId, input }) =>
      api.post<WorkflowSchedule>(
        `/api/workspaces/${workspaceId}/workflows/${workflowId}/schedules`,
        input,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [SCHEDULES_KEY, workspaceId] });
    },
  });
}

export function useSetScheduleEnabled(
  workspaceId: string,
): UseMutationResult<WorkflowSchedule, Error, { scheduleId: string; enabled: boolean }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ scheduleId, enabled }) =>
      api.patch<WorkflowSchedule>(`/api/workspaces/${workspaceId}/schedules/${scheduleId}`, {
        enabled,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [SCHEDULES_KEY, workspaceId] });
    },
  });
}

export function useDeleteSchedule(
  workspaceId: string,
): UseMutationResult<{ deleted: boolean }, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (scheduleId) =>
      api.delete<{ deleted: boolean }>(`/api/workspaces/${workspaceId}/schedules/${scheduleId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [SCHEDULES_KEY, workspaceId] });
    },
  });
}

export function useWorkflowTriggers(
  workspaceId: string,
  workflowId: string,
  options?: { enabled?: boolean },
): UseQueryResult<WorkflowTrigger[]> {
  return useQuery({
    queryKey: [TRIGGERS_KEY, workspaceId, workflowId],
    queryFn: () =>
      api.get<WorkflowTrigger[]>(`/api/workspaces/${workspaceId}/workflows/${workflowId}/triggers`),
    enabled: !!workspaceId && !!workflowId && options?.enabled !== false,
  });
}

export function useCreateTrigger(
  workspaceId: string,
): UseMutationResult<CreatedTrigger, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (workflowId) =>
      api.post<CreatedTrigger>(`/api/workspaces/${workspaceId}/workflows/${workflowId}/triggers`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [TRIGGERS_KEY, workspaceId] });
    },
  });
}

export function useSetTriggerEnabled(
  workspaceId: string,
): UseMutationResult<WorkflowTrigger, Error, { triggerId: string; enabled: boolean }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ triggerId, enabled }) =>
      api.patch<WorkflowTrigger>(`/api/workspaces/${workspaceId}/triggers/${triggerId}`, { enabled }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [TRIGGERS_KEY, workspaceId] });
    },
  });
}

export function useDeleteTrigger(
  workspaceId: string,
): UseMutationResult<{ deleted: boolean }, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (triggerId) =>
      api.delete<{ deleted: boolean }>(`/api/workspaces/${workspaceId}/triggers/${triggerId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [TRIGGERS_KEY, workspaceId] });
    },
  });
}

/**
 * Runs nothing. Reports what a real run would do: which steps would pause
 * for approval, whether the workspace's tools and budget would let it
 * start, and every problem discoverable in advance — without spending
 * anything or touching a tool. See `DryRunReport` for what "discoverable
 * in advance" excludes (a generate step's output, a remote call's result).
 */
export function useDryRunWorkflow(
  workspaceId: string,
): UseMutationResult<DryRunReport, Error, string> {
  return useMutation({
    mutationFn: (workflowId) =>
      api.post<DryRunReport>(`/api/workspaces/${workspaceId}/workflows/${workflowId}/dry-run`, {}),
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
