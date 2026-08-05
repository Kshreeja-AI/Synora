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

/**
 * Whether an agent may read the workspace's memory, write to it, both, or
 * neither. Absent means none — the server fails closed, and the client
 * must not present a friendlier default than the server enforces.
 */
export type MemoryAccess = 'none' | 'recall' | 'record' | 'both';

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
  memoryAccess?: MemoryAccess;
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
  /** Resolved by the backend read routes in one batched lookup — WHO asked, as a name, not an id. */
  requestedByName?: string | null;
  task: string;
  /** The project this run is filed into, if any. */
  projectId?: string;
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

export interface PlanPreviewStepCheck {
  stepId: string;
  kind: 'tool' | 'generate';
  description: string;
  toolId?: string;
  pausesForApproval: boolean;
  treatedAsMutating: boolean;
  unresolvedReferences: string[];
  problems: string[];
  unknowns: string[];
}

/**
 * "Plan first, run second": the same planner, validation and per-step
 * preflight a real run would use — then a full stop. `executed` is
 * literally false: no run record exists and nothing ran.
 */
export interface PlanPreviewReport {
  agentId: string;
  agentName: string;
  agentVersion: number;
  task: string;
  executed: false;
  planOrigin: 'model' | 'local-deterministic' | 'authored';
  wouldStart: boolean;
  blockers: string[];
  steps: PlanPreviewStepCheck[];
  projected: {
    steps: number;
    toolCalls: number;
    approvalPauses: number;
    maxSteps: number;
    maxToolCalls: number;
    maxDurationMs: number;
  };
  caveats: string[];
  runtime: RunRuntime;
}

export interface CreateAgentInput {
  name: string;
  description?: string;
  instructions: string;
  allowedTools?: string[];
  approvalPolicy?: ApprovalPolicy;
  memoryAccess?: MemoryAccess;
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
  options?: { enabled?: boolean; retry?: boolean },
): UseQueryResult<Agent> {
  return useQuery({
    queryKey: [AGENTS_KEY, workspaceId, 'agent', agentId],
    queryFn: () => api.get<Agent>(`/api/workspaces/${workspaceId}/agents/${agentId}`),
    enabled: !!workspaceId && !!agentId && options?.enabled !== false,
    retry: options?.retry ?? true,
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
    // Polls while any run in the list is still moving, so a run in
    // progress is not a state someone has to reopen the page to see
    // change. Stops the moment every run is terminal — a finished list
    // has nothing left to reveal by asking again.
    refetchInterval: (query) => {
      const runs = query.state.data;
      if (!runs) return false;
      return runs.some((r) => !isTerminalRun(r.state)) ? 1500 : false;
    },
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
    // Mirrors useAgentRuns: the permalink page for a single run must not
    // require a manual reload to see a run that is still in progress
    // move — the exact gap this closes.
    refetchInterval: (query) => {
      const run = query.state.data;
      return run === undefined || !isTerminalRun(run.state) ? 1500 : false;
    },
  });
}

export function useStartRun(
  workspaceId: string,
): UseMutationResult<
  RunWithRuntime,
  Error,
  { agentId: string; task: string; projectId?: string }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, task, projectId }) =>
      api.post<RunWithRuntime>(`/api/workspaces/${workspaceId}/agents/${agentId}/runs`, {
        task,
        projectId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [RUNS_KEY, workspaceId] });
    },
  });
}

/**
 * Preview without commitment. Deliberately NOT invalidating the runs
 * query: a preview creates no run, so there is nothing to refresh — an
 * invalidation here would imply otherwise.
 */
export function usePreviewPlan(
  workspaceId: string,
): UseMutationResult<PlanPreviewReport, Error, { agentId: string; task: string }> {
  return useMutation({
    mutationFn: ({ agentId, task }) =>
      api.post<PlanPreviewReport>(
        `/api/workspaces/${workspaceId}/agents/${agentId}/runs/preview`,
        { task },
      ),
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
