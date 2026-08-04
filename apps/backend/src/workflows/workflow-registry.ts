import { randomUUID } from 'node:crypto';
import {
  DEFAULT_AGENT_LIMITS,
  type AgentLimits,
  type ApprovalPolicy,
  type PlannedStep,
} from '../agents/types.js';
import { validatePlan } from '../agents/run-engine.js';
import { FileKeyedStore, InMemoryKeyedStore, type KeyedStore } from '../agents/agent-stores.js';
import type { WorkflowDefinition } from './types.js';

/**
 * Workflow definitions: authored, versioned, workspace-scoped, immutable.
 *
 * SAME VERSIONING DISCIPLINE AS AGENTS, for the same reason. A run records
 * which version it executed; if editing mutated the definition, that record
 * would point at whatever the workflow says today. Editing therefore
 * creates version+1 linked to its predecessor.
 *
 * THE ONE THING WORKFLOWS DO THAT AGENTS DO NOT: validate at authoring
 * time. An agent's plan cannot be checked until a planner produces it, so
 * validation happens at run time. A workflow's steps exist the moment
 * someone saves them — so they are validated then, against the same rules
 * the engine will apply later. Letting someone save a workflow that can
 * never run would be building a trap: it looks saved, it looks ready, and
 * it fails the first time it matters. The engine still re-validates before
 * executing, because a definition loaded from disk is untrusted input.
 */

const definitions = new Map<string, WorkflowDefinition>();

let store: KeyedStore<WorkflowDefinition> = new InMemoryKeyedStore();

export function setWorkflowStore(next: KeyedStore<WorkflowDefinition>): void {
  store = next;
}
export function getWorkflowStore(): KeyedStore<WorkflowDefinition> {
  return store;
}
export function createFileWorkflowStore(filePath: string): KeyedStore<WorkflowDefinition> {
  return new FileKeyedStore<WorkflowDefinition>(filePath);
}

export interface CreateWorkflowInput {
  workspaceId: string;
  name: string;
  description?: string;
  instructions?: string;
  steps: PlannedStep[];
  allowedTools?: string[];
  approvalPolicy?: ApprovalPolicy;
  limits?: Partial<AgentLimits>;
  createdBy: string;
}

export interface UpdateWorkflowInput {
  name?: string;
  description?: string;
  instructions?: string;
  steps?: PlannedStep[];
  allowedTools?: string[];
  approvalPolicy?: ApprovalPolicy;
  limits?: Partial<AgentLimits>;
}

function validateShape(input: {
  name?: string;
  instructions?: string;
  limits?: Partial<AgentLimits>;
}): void {
  if (input.name !== undefined && input.name.trim().length === 0) {
    throw new Error('a workflow needs a name');
  }
  if (input.limits) {
    for (const [key, value] of Object.entries(input.limits)) {
      if (value === undefined) continue;
      // Zero retries is a legitimate policy; the other budgets at zero
      // would make every run unrunnable while looking configured.
      const floor = key === 'maxRetriesPerStep' ? 0 : 1;
      if (!Number.isFinite(value) || value < floor) {
        throw new Error(
          `limit ${key} must be ${floor === 0 ? 'zero or a positive number' : 'a positive number'} — a negative budget is a misconfiguration, not "unlimited"`,
        );
      }
    }
  }
}

/**
 * Runs the engine's own plan validation over the authored steps. Using the
 * engine's function rather than a parallel copy is deliberate: a second
 * implementation would drift, and the failure mode of drift here is a
 * workflow that saves cleanly and is refused at run time.
 */
function validateAuthoredSteps(
  steps: PlannedStep[],
  allowedTools: string[],
  limits: AgentLimits,
): void {
  const rejection = validatePlan({ steps, origin: 'authored' }, { allowedTools, limits });
  if (rejection) throw new Error(`this workflow cannot run as written: ${rejection}`);
}

export function createWorkflow(input: CreateWorkflowInput): WorkflowDefinition {
  validateShape(input);
  const limits = { ...DEFAULT_AGENT_LIMITS, ...input.limits };
  // Fail closed, exactly as agents do: unspecified means no tools.
  const allowedTools = [...(input.allowedTools ?? [])];
  validateAuthoredSteps(input.steps, allowedTools, limits);

  const workflow: WorkflowDefinition = {
    id: `wf_${randomUUID()}`,
    lineageId: `wflin_${randomUUID()}`,
    workspaceId: input.workspaceId,
    name: input.name.trim(),
    description: input.description,
    instructions: input.instructions ?? '',
    steps: input.steps,
    allowedTools,
    approvalPolicy: input.approvalPolicy ?? 'mutations',
    limits,
    version: 1,
    createdBy: input.createdBy,
    createdAt: Date.now(),
    archived: false,
  };
  definitions.set(workflow.id, workflow);
  return workflow;
}

/** Editing creates the next version; the old one stays resolvable. */
export function updateWorkflow(
  workflowId: string,
  workspaceId: string,
  changes: UpdateWorkflowInput,
  actor: string,
): WorkflowDefinition {
  const current = getWorkflow(workflowId, workspaceId);
  if (!current) throw new Error('workflow not found');
  if (current.archived) throw new Error('an archived workflow cannot be edited — create a new one');
  validateShape(changes);

  const limits = { ...current.limits, ...changes.limits };
  const allowedTools = changes.allowedTools ? [...changes.allowedTools] : current.allowedTools;
  const steps = changes.steps ?? current.steps;
  // Re-validated on every edit: narrowing allowedTools can invalidate steps
  // that were fine a moment ago, and that must be refused at save time
  // rather than discovered on the next run.
  validateAuthoredSteps(steps, allowedTools, limits);

  const next: WorkflowDefinition = {
    ...current,
    ...changes,
    steps,
    allowedTools,
    limits,
    id: `wf_${randomUUID()}`,
    version: current.version + 1,
    previousVersionId: current.id,
    createdBy: actor,
    createdAt: Date.now(),
  };
  definitions.set(next.id, next);
  return next;
}

/** Workspace scoping is part of the lookup, not a check callers may skip. */
export function getWorkflow(workflowId: string, workspaceId: string): WorkflowDefinition | null {
  const workflow = definitions.get(workflowId);
  if (!workflow || workflow.workspaceId !== workspaceId) return null;
  return workflow;
}

export function listWorkflows(
  workspaceId: string,
  opts: { includeArchived?: boolean } = {},
): WorkflowDefinition[] {
  const latestByLineage = new Map<string, WorkflowDefinition>();
  for (const workflow of definitions.values()) {
    if (workflow.workspaceId !== workspaceId) continue;
    if (workflow.archived && !opts.includeArchived) continue;
    const existing = latestByLineage.get(workflow.lineageId);
    if (!existing || workflow.version > existing.version) {
      latestByLineage.set(workflow.lineageId, workflow);
    }
  }
  return [...latestByLineage.values()].sort((a, b) => b.createdAt - a.createdAt);
}

export function getWorkflowHistory(lineageId: string, workspaceId: string): WorkflowDefinition[] {
  return [...definitions.values()]
    .filter((w) => w.lineageId === lineageId && w.workspaceId === workspaceId)
    .sort((a, b) => a.version - b.version);
}

export function archiveWorkflow(workflowId: string, workspaceId: string): WorkflowDefinition {
  const workflow = getWorkflow(workflowId, workspaceId);
  if (!workflow) throw new Error('workflow not found');
  const archived = { ...workflow, archived: true };
  definitions.set(workflow.id, archived);
  return archived;
}

export async function persistWorkflow(workflowId: string): Promise<boolean> {
  const workflow = definitions.get(workflowId);
  if (!workflow) return false;
  await store.save(workflow.id, workflow);
  return true;
}

/**
 * Loads workflows at startup, re-validating on the way in. A definition
 * written by an earlier version that no longer satisfies today's rules is
 * discarded rather than trusted because it is on disk — the same rule the
 * agent registry applies, for the same reason: guessing at what a malformed
 * definition meant would hand an executor a sequence nobody wrote.
 */
export async function hydrateWorkflows(): Promise<number> {
  const stored = await store.loadAll();
  let loaded = 0;
  for (const workflow of Object.values(stored)) {
    try {
      if (!workflow?.id || !workflow.workspaceId || !workflow.lineageId) continue;
      validateShape(workflow);
      validateAuthoredSteps(workflow.steps, workflow.allowedTools, workflow.limits);
      definitions.set(workflow.id, workflow);
      loaded += 1;
    } catch {
      // Discarded, not repaired.
    }
  }
  return loaded;
}

/** Whether a definition id is a known workflow. Used by run hydration. */
export function hasWorkflowDefinition(workflowId: string): boolean {
  return definitions.has(workflowId);
}

/** Test-only. */
export function resetWorkflows(): void {
  definitions.clear();
}
