'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { api } from './client';

/**
 * Agent platform client.
 *
 * These types mirror the backend's `agents/types.ts` deliberately closely,
 * including the parts that are uncomfortable — `runtime.mode`, the notice
 * text, and `planOrigin`. A client that dropped those fields would let the
 * UI render a deterministic local plan as though a model produced it, which
 * is the one thing this subsystem is built not to do.
 */

export type ApprovalPolicy = 'nothing' | 'mutations' | 'everything';

export type RunState =
  | 'pending'
  | 'planning'
  | 'awaiting_approval'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timed_out';

export type StepState =
  | 'pending'
  | 'awaiting_approval'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'skipped';

/** States a run can never leave. Every run reaches exactly one. */
const TERMINAL_RUN_STATES: ReadonlySet<RunState> = new Set([
  'completed',
  'failed',
  'cancelled',
  'timed_out',
]);

export function isTerminalRun(state: RunState): boolean {
  return TERMINAL_RUN_STATES.has(state);
}

export interface AgentLimits {
  maxSteps: number;
  maxToolCalls: number;
  maxDurationMs: number;
  maxRetriesPerStep: number;
}

export interface Agent {
  id: string;
  workspaceId: string;
  lineageId: string;
  name: string;
  description?: string;
  instructions: string;
  allowedTools: string[];
  approvalPolicy: ApprovalPolicy;
  limits: AgentLimits;
  version: number;
  previousVersionId?: string;
  createdBy: string;
  createdAt: number;
  archived: boolean;
}

export interface PlannedStep {
  id: string;
  kind: 'generate' | 'tool';
  description: string;
  toolId?: string;
  input: string;
  mutating?: boolean;
  dependsOn?: string[];
}

export interface StepRecord {
  step: PlannedStep;
  state: StepState;
  attempts: number;
  output?: string;
  error?: string;
  approvedBy?: string;
  startedAt?: number;
  finishedAt?: number;
}

export interface RunLogEntry {
  at: number;
  event: string;
  detail?: string;
}

export interface AgentRun {
  id: string;
  agentId: string;
  agentVersion: number;
  lineageId: string;
  workspaceId: string;
  requestedBy: string;
  task: string;
  state: RunState;
  plan?: { steps: PlannedStep[]; origin: 'model' | 'local-deterministic' | 'authored' };
  steps: StepRecord[];
  pendingApproval?: { stepId: string; reason: string };
  toolCallsUsed: number;
  result?: string;
  error?: string;
  log: RunLogEntry[];
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
}

/**
 * What produced this run. Never optional on the wire, and never dropped
 * here: the UI is required to be able to say LOCAL or REAL.
 */
export interface RunRuntime {
  mode: 'local' | 'model';
  provider?: string;
  notice: string;
  planOrigin?: 'model' | 'local-deterministic' | 'authored';
}

export interface RunWithRuntime {
  run: AgentRun;
  runtime: RunRuntime;
}

export interface CreateAgentInput {
  name: string;
  description?: string;
  instructions: string;
  allowedTools?: string[];
  approvalPolicy?: ApprovalPolicy;
  limits?: Partial<AgentLimits>;
}

export type UpdateAgentInput = Partial<CreateAgentInput>;

const AGENTS_KEY = 'agents';
const RUNS_KEY = 'agent-runs';

export function useAgents(
  workspaceId: string,
  options?: { includeArchived?: boolean; enabled?: boolean },
): UseQueryResult<Agent[]> {
  const includeArchived = options?.includeArchived ?? false;
  return useQuery({
    queryKey: [AGENTS_KEY, workspaceId, includeArchived],
    queryFn: () =>
      api.get<Agent[]>(
        `/api/workspaces/${workspaceId}/agents?includeArchived=${includeArchived}`,
      ),
    enabled: !!workspaceId && options?.enabled !== false,
  });
}

export function useAgent(
  workspaceId: string,
  agentId: string,
  options?: { enabled?: boolean },
): UseQueryResult<Agent> {
  return useQuery({
    queryKey: [AGENTS_KEY, workspaceId, 'agent', agentId],
    queryFn: () => api.get<Agent>(`/api/workspaces/${workspaceId}/agents/${agentId}`),
    enabled: !!workspaceId && !!agentId && options?.enabled !== false,
  });
}

/** Every version of the lineage, oldest first — the audit history. */
export function useAgentHistory(
  workspaceId: string,
  agentId: string,
  options?: { enabled?: boolean },
): UseQueryResult<Agent[]> {
  return useQuery({
    queryKey: [AGENTS_KEY, workspaceId, 'history', agentId],
    queryFn: () => api.get<Agent[]>(`/api/workspaces/${workspaceId}/agents/${agentId}/history`),
    enabled: !!workspaceId && !!agentId && options?.enabled !== false,
  });
}

export function useCreateAgent(
  workspaceId: string,
): UseMutationResult<Agent, Error, CreateAgentInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input) => api.post<Agent>(`/api/workspaces/${workspaceId}/agents`, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [AGENTS_KEY, workspaceId] });
    },
  });
}

/**
 * Editing returns a NEW agent with a new id, because versions are
 * immutable. Callers must use the returned id rather than the one they
 * sent — the old version stays resolvable for the runs that reference it.
 */
export function useUpdateAgent(
  workspaceId: string,
): UseMutationResult<Agent, Error, { agentId: string; changes: UpdateAgentInput }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, changes }) =>
      api.patch<Agent>(`/api/workspaces/${workspaceId}/agents/${agentId}`, changes),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [AGENTS_KEY, workspaceId] });
    },
  });
}

/** Archive, not delete: history keeps referencing the definition. */
export function useArchiveAgent(
  workspaceId: string,
): UseMutationResult<Agent, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (agentId) => api.delete<Agent>(`/api/workspaces/${workspaceId}/agents/${agentId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [AGENTS_KEY, workspaceId] });
    },
  });
}

export function useAgentRuns(
  workspaceId: string,
  options?: { lineageId?: string; enabled?: boolean },
): UseQueryResult<AgentRun[]> {
  const lineageId = options?.lineageId;
  return useQuery({
    queryKey: [RUNS_KEY, workspaceId, lineageId ?? 'all'],
    queryFn: () => {
      const qs = lineageId ? `?lineageId=${encodeURIComponent(lineageId)}` : '';
      return api.get<AgentRun[]>(`/api/workspaces/${workspaceId}/agents/runs${qs}`);
    },
    enabled: !!workspaceId && options?.enabled !== false,
  });
}

export function useAgentRun(
  workspaceId: string,
  runId: string,
  options?: { enabled?: boolean },
): UseQueryResult<AgentRun> {
  return useQuery({
    queryKey: [RUNS_KEY, workspaceId, 'run', runId],
    queryFn: () => api.get<AgentRun>(`/api/workspaces/${workspaceId}/agents/runs/${runId}`),
    enabled: !!workspaceId && !!runId && options?.enabled !== false,
  });
}

export function useStartRun(
  workspaceId: string,
): UseMutationResult<RunWithRuntime, Error, { agentId: string; task: string }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, task }) =>
      api.post<RunWithRuntime>(`/api/workspaces/${workspaceId}/agents/${agentId}/runs`, { task }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [RUNS_KEY, workspaceId] });
    },
  });
}

export function useApproveStep(
  workspaceId: string,
): UseMutationResult<RunWithRuntime, Error, { runId: string; stepId: string }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ runId, stepId }) =>
      api.post<RunWithRuntime>(
        `/api/workspaces/${workspaceId}/agents/runs/${runId}/steps/${stepId}/approve`,
        {},
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [RUNS_KEY, workspaceId] });
    },
  });
}

export function useRejectStep(
  workspaceId: string,
): UseMutationResult<AgentRun, Error, { runId: string; stepId: string; reason?: string }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ runId, stepId, reason }) =>
      api.post<AgentRun>(
        `/api/workspaces/${workspaceId}/agents/runs/${runId}/steps/${stepId}/reject`,
        { reason },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [RUNS_KEY, workspaceId] });
    },
  });
}

export function useCancelRun(
  workspaceId: string,
): UseMutationResult<AgentRun, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (runId) =>
      api.post<AgentRun>(`/api/workspaces/${workspaceId}/agents/runs/${runId}/cancel`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [RUNS_KEY, workspaceId] });
    },
  });
}
