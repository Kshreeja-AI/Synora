import { randomUUID } from 'node:crypto';
import { FileKeyedStore, InMemoryKeyedStore, type KeyedStore } from '../agents/agent-stores.js';

/**
 * Event triggers: a workflow starting because something happened INSIDE
 * Synora, rather than because a person pressed a button, a clock struck,
 * or an outside system called a webhook.
 *
 * THE EVENT CATALOGUE IS CLOSED, AND SHORT ON PURPOSE. Every name below
 * is emitted from a real call site where the thing genuinely happens. A
 * catalogue listing events nobody emits would be the worst kind of
 * dishonesty here: someone would wire an automation to `document.changed`,
 * see a trigger sitting there "enabled", and wait forever for a run that
 * was never possible. Adding a name means adding the emit alongside it.
 *
 * WHAT IS DELIBERATELY ABSENT IS `workflow.completed`. It is the obvious
 * next event and it is the one that makes loops possible: a workflow whose
 * completion starts a workflow whose completion starts the first. Bounding
 * that safely needs causation tracking through the run engine — knowing
 * that THIS run was started by THAT event, several hops back — which does
 * not exist. The burst budget below would keep such a loop from running
 * away, but "bounded by a rate limit" is not the same as "cannot happen",
 * and shipping the event while calling it safe would be claiming the
 * second.
 *
 * FIRING NEVER FAILS THE ACTION THAT CAUSED IT. Someone uploading a file
 * is not asking to run a workflow; the upload must succeed whether or not
 * an automation someone else wired up works. Dispatch happens off the
 * request path and every failure is logged rather than raised.
 */

/** Every event a trigger may listen for. Each has a real emit site. */
export const WORKFLOW_EVENTS = ['asset.uploaded', 'project.created'] as const;
export type WorkflowEventName = (typeof WORKFLOW_EVENTS)[number];

export function isWorkflowEventName(value: unknown): value is WorkflowEventName {
  return typeof value === 'string' && (WORKFLOW_EVENTS as readonly string[]).includes(value);
}

/**
 * What happened, described in facts a filter can match and a task line can
 * quote. Deliberately small: an event carries identifiers and plain
 * metadata, never file contents or anything else that would end up in a
 * task string and from there in a provider request.
 */
export interface WorkflowEvent {
  name: WorkflowEventName;
  workspaceId: string;
  /** Who caused it. Recorded, but never the authority a run executes with. */
  actorId: string;
  /** The row it happened to. */
  subjectId: string;
  /** Human-readable name of the subject, for the run's task line. */
  subjectName: string;
  projectId?: string;
  mimeType?: string;
}

export interface EventTriggerFilter {
  /** Only fire for subjects in this project. */
  projectId?: string;
  /** Only fire when the subject's mime type starts with this, e.g. "image/". */
  mimeTypePrefix?: string;
}

export interface EventTrigger {
  id: string;
  workspaceId: string;
  workflowId: string;
  event: WorkflowEventName;
  /** Every present condition must match. Absent means "every event of this name". */
  filter?: EventTriggerFilter;
  enabled: boolean;
  createdBy: string;
  createdAt: number;
  lastFiredAt?: number;
  firedCount: number;
  /**
   * Fires refused because the burst budget was spent. Kept separate from
   * `firedCount` because "nothing happened" and "something happened and
   * was declined" are different things to debug.
   */
  suppressedCount: number;
}

/**
 * How many times one trigger may fire in a window before it stops.
 *
 * This is not a performance tuning knob; it is the blast radius of a
 * mistake. A workflow wired to `asset.uploaded` on a workspace where
 * somebody drags in four hundred files would otherwise start four hundred
 * runs against real budget before anyone noticed. Suppression is counted
 * and visible, so the limit is discoverable rather than a silent ceiling.
 */
export const BURST_LIMIT = 20;
export const BURST_WINDOW_MS = 60_000;

const triggers = new Map<string, EventTrigger>();
/**
 * Fire timestamps per trigger, for the sliding window. NOT persisted and
 * NOT part of the record: a restart forgetting that a trigger was recently
 * busy is the right behaviour, and writing a moving window to disk would
 * be noise on every fire.
 */
const recentFires = new Map<string, number[]>();

let store: KeyedStore<EventTrigger> = new InMemoryKeyedStore();

export function setEventTriggerStore(next: KeyedStore<EventTrigger>): void {
  store = next;
}
export function createFileEventTriggerStore(filePath: string): KeyedStore<EventTrigger> {
  return new FileKeyedStore<EventTrigger>(filePath);
}

export interface CreateEventTriggerInput {
  workspaceId: string;
  workflowId: string;
  event: WorkflowEventName;
  filter?: EventTriggerFilter;
  createdBy: string;
}

const MAX_PER_WORKSPACE = 50;

export function createEventTrigger(
  input: CreateEventTriggerInput,
  now = Date.now(),
): EventTrigger {
  if (!isWorkflowEventName(input.event)) {
    // Refused by name rather than accepted and never fired. A trigger
    // listening for an event nobody emits looks enabled forever.
    throw new Error(
      `unknown event ${JSON.stringify(String(input.event))}; Synora emits ${WORKFLOW_EVENTS.join(', ')}`,
    );
  }
  const count = [...triggers.values()].filter((t) => t.workspaceId === input.workspaceId).length;
  if (count >= MAX_PER_WORKSPACE) {
    throw new Error(`a workspace holds at most ${MAX_PER_WORKSPACE} event triggers`);
  }

  const trigger: EventTrigger = {
    id: `evt_${randomUUID()}`,
    workspaceId: input.workspaceId,
    workflowId: input.workflowId,
    event: input.event,
    ...(input.filter && Object.keys(input.filter).length > 0 ? { filter: input.filter } : {}),
    enabled: true,
    createdBy: input.createdBy,
    createdAt: now,
    firedCount: 0,
    suppressedCount: 0,
  };
  triggers.set(trigger.id, trigger);
  return trigger;
}

/** Workspace scoping is part of the lookup, as everywhere else. */
export function getEventTrigger(triggerId: string, workspaceId: string): EventTrigger | null {
  const trigger = triggers.get(triggerId);
  if (!trigger || trigger.workspaceId !== workspaceId) return null;
  return trigger;
}

export function listEventTriggers(workspaceId: string, workflowId?: string): EventTrigger[] {
  return [...triggers.values()]
    .filter((t) => t.workspaceId === workspaceId)
    .filter((t) => !workflowId || t.workflowId === workflowId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function setEventTriggerEnabled(
  triggerId: string,
  workspaceId: string,
  enabled: boolean,
): EventTrigger {
  const trigger = getEventTrigger(triggerId, workspaceId);
  if (!trigger) throw new Error('trigger not found');
  trigger.enabled = enabled;
  return trigger;
}

export function deleteEventTrigger(triggerId: string, workspaceId: string): boolean {
  if (!getEventTrigger(triggerId, workspaceId)) return false;
  triggers.delete(triggerId);
  recentFires.delete(triggerId);
  return true;
}

/** Whether a trigger's conditions all hold for this event. */
export function matchesFilter(trigger: EventTrigger, event: WorkflowEvent): boolean {
  const filter = trigger.filter;
  if (!filter) return true;
  if (filter.projectId && event.projectId !== filter.projectId) return false;
  if (filter.mimeTypePrefix && !(event.mimeType ?? '').startsWith(filter.mimeTypePrefix)) {
    return false;
  }
  return true;
}

/**
 * The triggers that should fire for an event: same workspace, same event
 * name, enabled, and matching every condition. Workspace scoping is
 * checked here and not assumed from the caller, because an event carries
 * its workspace and a cross-workspace fire would be the worst possible
 * bug in this file.
 */
export function triggersFor(event: WorkflowEvent): EventTrigger[] {
  return [...triggers.values()].filter(
    (t) =>
      t.enabled &&
      t.workspaceId === event.workspaceId &&
      t.event === event.name &&
      matchesFilter(t, event),
  );
}

/**
 * Takes a slot in the burst window if one is free.
 *
 * Returns false rather than throwing, because a spent budget is a normal
 * outcome of a busy workspace and not an error anybody needs a stack trace
 * for.
 */
export function claimBurstSlot(triggerId: string, now = Date.now()): boolean {
  const fires = (recentFires.get(triggerId) ?? []).filter((at) => now - at < BURST_WINDOW_MS);
  if (fires.length >= BURST_LIMIT) {
    recentFires.set(triggerId, fires);
    const trigger = triggers.get(triggerId);
    if (trigger) trigger.suppressedCount += 1;
    return false;
  }
  fires.push(now);
  recentFires.set(triggerId, fires);
  return true;
}

/** Records a successful fire. Never throws — a stats write must not turn a
 *  real trigger firing into a failure. */
export function recordEventFired(triggerId: string, now = Date.now()): void {
  const trigger = triggers.get(triggerId);
  if (!trigger) return;
  trigger.firedCount += 1;
  trigger.lastFiredAt = now;
}

export async function persistEventTrigger(triggerId: string): Promise<boolean> {
  const trigger = triggers.get(triggerId);
  if (!trigger) return false;
  await store.save(trigger.id, trigger);
  return true;
}

export async function forgetEventTrigger(triggerId: string): Promise<void> {
  await store.delete(triggerId);
}

export async function hydrateEventTriggers(): Promise<number> {
  const stored = await store.loadAll();
  let loaded = 0;
  for (const trigger of Object.values(stored)) {
    // Discarded, not repaired: a trigger nobody wrote must not start runs,
    // and one listening for an event this version no longer emits would
    // sit enabled and silent.
    if (!trigger?.id || !trigger.workspaceId || !trigger.workflowId) continue;
    if (!isWorkflowEventName(trigger.event)) continue;
    triggers.set(trigger.id, trigger);
    loaded += 1;
  }
  return loaded;
}

/** Test-only. */
export function resetEventTriggers(): void {
  triggers.clear();
  recentFires.clear();
}
