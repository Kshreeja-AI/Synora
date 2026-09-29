import { randomUUID } from 'node:crypto';
import { FileKeyedStore, InMemoryKeyedStore, type KeyedStore } from './agent-stores.js';
import type { Template, TemplateCategory } from './templates.js';
import type { AgentDefinition, PlannedStep } from './types.js';
import type { WorkflowDefinition } from '../workflows/types.js';

/**
 * Templates a workspace writes for itself, by saving something that
 * already works.
 *
 * WHY THESE MAY NAME TOOLS WHEN BUILT-IN AND PLUGIN TEMPLATES MAY NOT.
 * The rule elsewhere is that a template cannot name a tool id, because
 * ids are per-workspace rows and a template shipped to another workspace
 * would point at nothing. A workspace template never leaves the workspace
 * it was authored in, so the id means something here.
 *
 * That is not the whole story though: a tool can be DELETED after the
 * template is saved, and instantiating then would produce an agent naming
 * a tool that no longer exists — the same ready-looking-and-broken trap.
 * So tools are re-checked at instantiate time, the ones that survive are
 * carried, and the ones that did not are REPORTED. Narrowing that is
 * reported is not the silent narrowing this codebase refuses elsewhere;
 * the caller is told exactly what changed and why.
 *
 * WHAT IS DELIBERATELY NOT RECORDED is a link back to the agent it was
 * saved from. A template is a snapshot taken at one moment, not a live
 * view; storing the source id would imply a relationship that is never
 * maintained and would go stale the first time the source was edited.
 */

export interface WorkspaceTemplate extends Omit<Template, 'kind'> {
  kind: 'agent' | 'workflow';
  /** Present on both, so the shape matches the built-in catalogue. */
  steps?: PlannedStep[];
  /**
   * Tool ids this template will try to grant. Meaningful only within the
   * authoring workspace, and re-checked when used.
   */
  toolIds: string[];
  workspaceId: string;
  authoredBy: string;
  authoredAt: number;
}

const templates = new Map<string, WorkspaceTemplate>();
let store: KeyedStore<WorkspaceTemplate> = new InMemoryKeyedStore();

export function setWorkspaceTemplateStore(next: KeyedStore<WorkspaceTemplate>): void {
  store = next;
}
export function createFileWorkspaceTemplateStore(filePath: string): KeyedStore<WorkspaceTemplate> {
  return new FileKeyedStore<WorkspaceTemplate>(filePath);
}

const MAX_PER_WORKSPACE = 100;
const MAX_NAME = 200;
const MAX_DESCRIPTION = 1_000;

export interface SaveTemplateInput {
  workspaceId: string;
  authoredBy: string;
  /** The thing being snapshotted. */
  source: AgentDefinition | WorkflowDefinition;
  name?: string;
  description?: string;
  category?: TemplateCategory;
  /** Why someone would reach for this, in their words. */
  outcome?: string;
}

function isWorkflow(source: AgentDefinition | WorkflowDefinition): source is WorkflowDefinition {
  return Array.isArray((source as WorkflowDefinition).steps);
}

export function saveAsTemplate(input: SaveTemplateInput): WorkspaceTemplate {
  const name = (input.name ?? input.source.name).trim();
  if (name.length === 0) throw new Error('a template needs a name');
  if (name.length > MAX_NAME) throw new Error(`template name exceeds ${MAX_NAME} characters`);

  const description = (input.description ?? input.source.description ?? name).trim();
  if (description.length > MAX_DESCRIPTION) {
    throw new Error(`template description exceeds ${MAX_DESCRIPTION} characters`);
  }

  const count = [...templates.values()].filter((t) => t.workspaceId === input.workspaceId).length;
  if (count >= MAX_PER_WORKSPACE) {
    throw new Error(`a workspace holds at most ${MAX_PER_WORKSPACE} saved templates`);
  }

  const workflow = isWorkflow(input.source);
  const template: WorkspaceTemplate = {
    id: `tplws_${randomUUID()}`,
    kind: workflow ? 'workflow' : 'agent',
    name,
    description,
    category: input.category ?? 'operations',
    // Said in the author's words when they gave one; otherwise honest
    // about being a snapshot rather than inventing a motivation.
    outcome: input.outcome?.trim() || `Saved from "${input.source.name}" in this workspace.`,
    instructions: input.source.instructions,
    // Plain-language suggestions stay empty: this template carries real
    // ids in `toolIds` instead, which is the honest difference.
    suggestedTools: [],
    ...(workflow ? { steps: [...(input.source as WorkflowDefinition).steps] } : {}),
    toolIds: [...input.source.allowedTools],
    workspaceId: input.workspaceId,
    authoredBy: input.authoredBy,
    authoredAt: Date.now(),
  };
  templates.set(template.id, template);
  return template;
}

/** Workspace scoping is part of the lookup, as everywhere else. */
export function getWorkspaceTemplate(
  templateId: string,
  workspaceId: string,
): WorkspaceTemplate | null {
  const template = templates.get(templateId);
  if (!template || template.workspaceId !== workspaceId) return null;
  return template;
}

export function listWorkspaceTemplates(workspaceId: string): WorkspaceTemplate[] {
  return [...templates.values()]
    .filter((t) => t.workspaceId === workspaceId)
    .sort((a, b) => b.authoredAt - a.authoredAt);
}

export function deleteWorkspaceTemplate(templateId: string, workspaceId: string): boolean {
  if (!getWorkspaceTemplate(templateId, workspaceId)) return false;
  templates.delete(templateId);
  return true;
}

export async function persistWorkspaceTemplate(
  templateId: string,
  workspaceId: string,
): Promise<boolean> {
  const template = getWorkspaceTemplate(templateId, workspaceId);
  if (!template) return false;
  await store.save(template.id, template);
  return true;
}

export async function forgetWorkspaceTemplate(templateId: string): Promise<void> {
  await store.delete(templateId);
}

export async function hydrateWorkspaceTemplates(): Promise<number> {
  const stored = await store.loadAll();
  let loaded = 0;
  for (const template of Object.values(stored)) {
    // Discarded, not repaired: a template nobody wrote should not appear
    // in the gallery as though someone had.
    if (!template?.id || !template.workspaceId || !template.name || !template.instructions) continue;
    templates.set(template.id, template);
    loaded += 1;
  }
  return loaded;
}

/** Test-only. */
export function resetWorkspaceTemplates(): void {
  templates.clear();
}
