import { randomUUID } from 'node:crypto';
import {
  DEFAULT_AGENT_LIMITS,
  type AgentDefinition,
  type AgentLimits,
  type ApprovalPolicy,
} from './types.js';
import { getAgentDefinitionStore } from './agent-stores.js';

/**
 * Agent definitions: versioned, workspace-scoped, never edited in place.
 *
 * WHY IMMUTABLE VERSIONS. A run records which definition version it
 * executed under. If definitions mutated, that record would point at
 * whatever the definition says today — an audit trail into a moving
 * target. Editing therefore creates version+1 with `previousVersionId`
 * linking back, exactly the discipline the benchmark importer applies to
 * datasets: the thing a historical record references must never change
 * underneath it.
 *
 * STORAGE HONESTY. Definitions live in memory behind this module's
 * functions. That is the same stage the evaluation datasets are at, and
 * it is stated rather than hidden: persistence is a named production
 * blocker, not something a Map quietly pretends to solve. The functions
 * here are the seam a store lands behind.
 */

const definitions = new Map<string, AgentDefinition>();

export interface CreateAgentInput {
  workspaceId: string;
  name: string;
  description?: string;
  instructions: string;
  allowedTools?: string[];
  approvalPolicy?: ApprovalPolicy;
  memoryAccess?: AgentDefinition['memoryAccess'];
  limits?: Partial<AgentLimits>;
  createdBy: string;
}

function validate(input: { name?: string; instructions?: string; limits?: Partial<AgentLimits> }): void {
  if (input.name !== undefined && input.name.trim().length === 0) {
    throw new Error('an agent needs a name');
  }
  if (input.instructions !== undefined && input.instructions.trim().length === 0) {
    // An agent with no instructions has no defined behaviour, and an
    // undefined executor with tool access is not a thing to create quietly.
    throw new Error('an agent needs instructions — its behaviour must be stated, not implied');
  }
  if (input.limits) {
    for (const [key, value] of Object.entries(input.limits)) {
      if (value === undefined) continue;
      // maxRetriesPerStep: 0 is a legitimate policy — "never retry" — and
      // must not be lumped in with zero budgets. The others at zero would
      // make every run unrunnable while looking configured.
      const floor = key === 'maxRetriesPerStep' ? 0 : 1;
      if (!Number.isFinite(value) || value < floor) {
        throw new Error(
          `limit ${key} must be ${floor === 0 ? 'zero or a positive number' : 'a positive number'} — a negative budget is a misconfiguration, not "unlimited"`,
        );
      }
    }
  }
}

export function createAgent(input: CreateAgentInput): AgentDefinition {
  validate(input);

  const now = Date.now();
  const agent: AgentDefinition = {
    id: `agent_${randomUUID()}`,
    lineageId: `lin_${randomUUID()}`,
    workspaceId: input.workspaceId,
    name: input.name.trim(),
    description: input.description,
    instructions: input.instructions,
    // Fail closed: unspecified means no tools, not all tools.
    allowedTools: [...(input.allowedTools ?? [])],
    // Fail closed here too: unless the creator explicitly loosens it,
    // anything that mutates state pauses for a human.
    approvalPolicy: input.approvalPolicy ?? 'mutations',
    // Fail closed again: unspecified means no memory access at all.
    memoryAccess: input.memoryAccess ?? 'none',
    limits: { ...DEFAULT_AGENT_LIMITS, ...input.limits },
    version: 1,
    createdBy: input.createdBy,
    createdAt: now,
    archived: false,
  };
  definitions.set(agent.id, agent);
  return agent;
}

export interface UpdateAgentInput {
  name?: string;
  description?: string;
  instructions?: string;
  allowedTools?: string[];
  approvalPolicy?: ApprovalPolicy;
  memoryAccess?: AgentDefinition['memoryAccess'];
  limits?: Partial<AgentLimits>;
}

/**
 * "Updating" an agent creates the next version and archives nothing:
 * the old version remains resolvable because runs reference it.
 */
export function updateAgent(
  agentId: string,
  workspaceId: string,
  changes: UpdateAgentInput,
  actor: string,
): AgentDefinition {
  const current = getAgent(agentId, workspaceId);
  if (!current) throw new Error('agent not found');
  if (current.archived) throw new Error('an archived agent cannot be edited — create a new one');
  validate(changes);

  const next: AgentDefinition = {
    ...current,
    ...changes,
    allowedTools: changes.allowedTools ? [...changes.allowedTools] : current.allowedTools,
    limits: { ...current.limits, ...changes.limits },
    id: `agent_${randomUUID()}`,
    version: current.version + 1,
    previousVersionId: current.id,
    createdBy: actor,
    createdAt: Date.now(),
  };
  definitions.set(next.id, next);
  return next;
}

/**
 * Workspace scoping is part of the lookup, not a separate check callers
 * may forget. An agent in another workspace is indistinguishable from one
 * that does not exist — the same 404-not-403 discipline as the API layer.
 */
export function getAgent(agentId: string, workspaceId: string): AgentDefinition | null {
  const agent = definitions.get(agentId);
  if (!agent || agent.workspaceId !== workspaceId) return null;
  return agent;
}

export function listAgents(workspaceId: string, opts: { includeArchived?: boolean } = {}): AgentDefinition[] {
  const latestByLineage = new Map<string, AgentDefinition>();
  for (const agent of definitions.values()) {
    if (agent.workspaceId !== workspaceId) continue;
    if (agent.archived && !opts.includeArchived) continue;
    const existing = latestByLineage.get(agent.lineageId);
    if (!existing || agent.version > existing.version) {
      latestByLineage.set(agent.lineageId, agent);
    }
  }
  return [...latestByLineage.values()].sort((a, b) => b.createdAt - a.createdAt);
}

/** Every version in a lineage, oldest first — the audit history. */
export function getAgentHistory(lineageId: string, workspaceId: string): AgentDefinition[] {
  return [...definitions.values()]
    .filter((a) => a.lineageId === lineageId && a.workspaceId === workspaceId)
    .sort((a, b) => a.version - b.version);
}

export function archiveAgent(agentId: string, workspaceId: string): AgentDefinition {
  const agent = getAgent(agentId, workspaceId);
  if (!agent) throw new Error('agent not found');
  const archived = { ...agent, archived: true };
  definitions.set(agent.id, archived);
  return archived;
}

/**
 * Writes a definition through to the durable store. In-memory stays the
 * working set so lookups remain synchronous; the store is the durable
 * copy, not the hot path — the same split `launch-gates` uses.
 */
export async function persistAgent(agentId: string): Promise<boolean> {
  const agent = definitions.get(agentId);
  if (!agent) return false;
  await getAgentDefinitionStore().save(agent.id, agent);
  return true;
}

/**
 * Loads definitions at startup. Re-validated on the way in: a record
 * written by an earlier version that no longer satisfies today's rules is
 * discarded rather than trusted because it is on disk.
 */
export async function hydrateAgents(): Promise<number> {
  const stored = await getAgentDefinitionStore().loadAll();
  let loaded = 0;
  for (const agent of Object.values(stored)) {
    try {
      validate(agent);
      if (!agent.id || !agent.workspaceId || !agent.lineageId) continue;
      definitions.set(agent.id, agent);
      loaded += 1;
    } catch {
      // Discarded, not repaired: guessing at what a malformed definition
      // meant would hand an executor a configuration nobody wrote.
    }
  }
  return loaded;
}

/** Whether a definition id is currently resolvable. Used by run hydration. */
export function hasAgentDefinition(agentId: string): boolean {
  return definitions.has(agentId);
}

/** Test-only. */
export function resetAgents(): void {
  definitions.clear();
}
