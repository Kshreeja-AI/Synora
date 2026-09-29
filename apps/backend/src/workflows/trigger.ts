import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { FileKeyedStore, InMemoryKeyedStore, type KeyedStore } from '../agents/agent-stores.js';

/**
 * Webhook triggers: something outside Synora starting a workflow, instead
 * of a person or a clock.
 *
 * THE CREDENTIAL IS THE URL. This mirrors `/api/shared/:shareToken`, the
 * platform's existing pattern for a resource authorized purely by an
 * unguessable path segment rather than a session — because that is
 * exactly what a webhook receiver is. There is no separate trigger id
 * plus signature scheme to implement or explain: the secret a caller
 * presents both identifies which trigger fired and proves they were
 * allowed to fire it. What IS taken from the more sensitive `ApiKey`
 * pattern rather than the share-token one is storage: only the SHA-256
 * hash of the secret is ever persisted, never the raw value, because a
 * trigger secret can start real work against real tools and budget, the
 * same risk class as an API key.
 *
 * A DISABLED TRIGGER RESOLVES TO NOTHING. Pausing an automation must
 * behave, from the caller's side, exactly like the trigger never having
 * existed — not a diagnostic "410 disabled" that would leak state to
 * whoever is holding an old secret.
 */

export interface WorkflowTrigger {
  id: string;
  workspaceId: string;
  /** The exact workflow this trigger starts. */
  workflowId: string;
  /** SHA-256 hex digest of the raw secret. The raw value is never stored. */
  secretHash: string;
  /** Non-secret display prefix, e.g. "whk_a1b2c3d4" — shown in the UI so a
   *  trigger can be told apart from others after the secret is gone. */
  secretPreview: string;
  enabled: boolean;
  createdBy: string;
  createdAt: number;
  lastFiredAt?: number;
  /** Total successful fires. Never decremented — a durable usage count. */
  firedCount: number;
}

const SECRET_PREFIX = 'whk_';
const RAW_SECRET_BYTES = 32; // 256 bits of entropy in the secret itself.
const PREVIEW_ID_LENGTH = 8;

/** Public so route handlers and tests share the exact algorithm. */
export function hashTriggerSecret(rawSecret: string): string {
  return createHash('sha256').update(rawSecret, 'utf8').digest('hex');
}

function previewOf(rawSecret: string): string {
  return rawSecret.slice(0, SECRET_PREFIX.length + PREVIEW_ID_LENGTH);
}

let store: KeyedStore<WorkflowTrigger> = new InMemoryKeyedStore();
const triggers = new Map<string, WorkflowTrigger>();
/** Secondary index so firing is a hash lookup, not a scan of every trigger
 *  on every request — the one path here that must stay O(1). */
const byHash = new Map<string, string>();

export function setTriggerStore(next: KeyedStore<WorkflowTrigger>): void {
  store = next;
}
export function createFileTriggerStore(filePath: string): KeyedStore<WorkflowTrigger> {
  return new FileKeyedStore<WorkflowTrigger>(filePath);
}

export interface CreateTriggerInput {
  workspaceId: string;
  workflowId: string;
  createdBy: string;
}

export interface CreatedTrigger {
  trigger: WorkflowTrigger;
  /** The raw secret — return once at creation, never persist or show again. */
  rawSecret: string;
}

export function createTrigger(input: CreateTriggerInput, now = Date.now()): CreatedTrigger {
  const rawSecret = SECRET_PREFIX + randomBytes(RAW_SECRET_BYTES).toString('hex');
  const trigger: WorkflowTrigger = {
    id: `trg_${randomUUID()}`,
    workspaceId: input.workspaceId,
    workflowId: input.workflowId,
    secretHash: hashTriggerSecret(rawSecret),
    secretPreview: previewOf(rawSecret),
    enabled: true,
    createdBy: input.createdBy,
    createdAt: now,
    firedCount: 0,
  };
  triggers.set(trigger.id, trigger);
  byHash.set(trigger.secretHash, trigger.id);
  return { trigger, rawSecret };
}

/** Workspace scoping is part of the lookup, as everywhere else. */
export function getTrigger(triggerId: string, workspaceId: string): WorkflowTrigger | null {
  const trigger = triggers.get(triggerId);
  if (!trigger || trigger.workspaceId !== workspaceId) return null;
  return trigger;
}

export function listTriggers(workspaceId: string, workflowId?: string): WorkflowTrigger[] {
  return [...triggers.values()]
    .filter((t) => t.workspaceId === workspaceId)
    .filter((t) => !workflowId || t.workflowId === workflowId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function setTriggerEnabled(
  triggerId: string,
  workspaceId: string,
  enabled: boolean,
): WorkflowTrigger {
  const trigger = getTrigger(triggerId, workspaceId);
  if (!trigger) throw new Error('trigger not found');
  trigger.enabled = enabled;
  return trigger;
}

export function deleteTrigger(triggerId: string, workspaceId: string): boolean {
  const trigger = getTrigger(triggerId, workspaceId);
  if (!trigger) return false;
  triggers.delete(trigger.id);
  byHash.delete(trigger.secretHash);
  return true;
}

/**
 * Resolves a presented raw secret to its trigger, or null if it does not
 * exist, matches nothing, or is disabled. This is the entire authorization
 * check for the public firing endpoint — there is no session behind it.
 */
export function resolveTriggerBySecret(rawSecret: string): WorkflowTrigger | null {
  if (!rawSecret.startsWith(SECRET_PREFIX)) return null;
  const id = byHash.get(hashTriggerSecret(rawSecret));
  if (!id) return null;
  const trigger = triggers.get(id);
  if (!trigger || !trigger.enabled) return null;
  return trigger;
}

/** Records a successful fire. Never throws — a stats write must not turn a
 *  real trigger firing into a failed request. */
export function recordFired(triggerId: string, now = Date.now()): void {
  const trigger = triggers.get(triggerId);
  if (!trigger) return;
  trigger.firedCount += 1;
  trigger.lastFiredAt = now;
}

export async function persistTrigger(triggerId: string): Promise<boolean> {
  const trigger = triggers.get(triggerId);
  if (!trigger) return false;
  await store.save(trigger.id, trigger);
  return true;
}

export async function hydrateTriggers(): Promise<number> {
  const stored = await store.loadAll();
  let loaded = 0;
  for (const trigger of Object.values(stored)) {
    if (!trigger?.id || !trigger.workspaceId || !trigger.workflowId || !trigger.secretHash) {
      continue; // Discarded, not repaired: a trigger nobody wrote must not fire.
    }
    triggers.set(trigger.id, trigger);
    byHash.set(trigger.secretHash, trigger.id);
    loaded += 1;
  }
  return loaded;
}

/** Test-only. */
export function resetTriggers(): void {
  triggers.clear();
  byHash.clear();
}
