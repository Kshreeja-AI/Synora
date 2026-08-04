import { randomUUID } from 'node:crypto';
import { FileKeyedStore, InMemoryKeyedStore, type KeyedStore } from '../agents/agent-stores.js';

/**
 * Scheduled workflows: a clock starting runs instead of a person.
 *
 * THE HARD QUESTION THIS FILE ANSWERS is what happens to occurrences that
 * were due while the server was down. There are three possible answers and
 * only one of them is safe:
 *
 *   1. Replay them all. A workflow scheduled hourly, after a two-day
 *      outage, fires 48 times in a burst — against real tools, spending
 *      real budget, possibly sending 48 emails. This is how a scheduler
 *      turns an outage into an incident.
 *   2. Silently skip to the next future occurrence. Safe, but the user
 *      believes their workflow ran every hour and it did not. Nothing
 *      anywhere records the gap.
 *   3. Skip to the next future occurrence AND record how many were missed.
 *
 * This implements (3). Missed occurrences are counted on the schedule and
 * reported, because "it did not run" is information the owner needs and
 * absence is not something a system should quietly absorb. It is the same
 * rule as a run interrupted by a restart: preserve the truth about what
 * did not happen rather than papering over it.
 *
 * WHY NOT FULL CRON. A cron parser that handles most expressions and
 * silently misinterprets the rest is worse than no cron at all, because
 * the failure is invisible until the wrong thing runs at the wrong time.
 * Two shapes are supported and strictly validated; anything else is
 * refused rather than guessed at — the same discipline the judge and the
 * model planner apply to parsing.
 */

export type ScheduleKind = 'interval' | 'daily';

export interface WorkflowSchedule {
  id: string;
  workspaceId: string;
  /** The exact workflow version this schedule starts. */
  workflowId: string;
  kind: ScheduleKind;
  /** kind=interval: milliseconds between runs. */
  intervalMs?: number;
  /** kind=daily: minutes past midnight UTC, 0–1439. */
  atMinuteUtc?: number;
  enabled: boolean;
  createdBy: string;
  createdAt: number;
  nextFireAt: number;
  lastFiredAt?: number;
  /**
   * Occurrences that were due while nothing was running. Never replayed,
   * always counted — a schedule reporting 48 missed runs is telling the
   * owner something they need to know.
   */
  missedOccurrences: number;
  lastMissedAt?: number;
}

/** The shortest interval accepted. Below this, a schedule is a busy loop. */
export const MIN_INTERVAL_MS = 60_000;

let store: KeyedStore<WorkflowSchedule> = new InMemoryKeyedStore();
const schedules = new Map<string, WorkflowSchedule>();

export function setScheduleStore(next: KeyedStore<WorkflowSchedule>): void {
  store = next;
}
export function createFileScheduleStore(filePath: string): KeyedStore<WorkflowSchedule> {
  return new FileKeyedStore<WorkflowSchedule>(filePath);
}

export interface CreateScheduleInput {
  workspaceId: string;
  workflowId: string;
  kind: ScheduleKind;
  intervalMs?: number;
  atMinuteUtc?: number;
  createdBy: string;
}

/**
 * Refuses anything it does not fully understand, rather than filling in a
 * default. A schedule the author did not mean is worse than no schedule.
 */
function validate(input: {
  kind: ScheduleKind;
  intervalMs?: number;
  atMinuteUtc?: number;
}): void {
  if (input.kind === 'interval') {
    if (input.atMinuteUtc !== undefined) {
      throw new Error('an interval schedule must not also specify a time of day');
    }
    if (!Number.isFinite(input.intervalMs) || (input.intervalMs as number) < MIN_INTERVAL_MS) {
      throw new Error(`an interval schedule needs intervalMs of at least ${MIN_INTERVAL_MS}`);
    }
    return;
  }
  if (input.kind === 'daily') {
    if (input.intervalMs !== undefined) {
      throw new Error('a daily schedule must not also specify an interval');
    }
    if (
      !Number.isInteger(input.atMinuteUtc) ||
      (input.atMinuteUtc as number) < 0 ||
      (input.atMinuteUtc as number) > 1439
    ) {
      throw new Error('a daily schedule needs atMinuteUtc between 0 and 1439');
    }
    return;
  }
  throw new Error(`unknown schedule kind ${JSON.stringify(String(input.kind))}`);
}

const DAY_MS = 24 * 60 * 60_000;

/** The first fire strictly after `after`. */
export function computeNextFire(schedule: WorkflowSchedule, after: number): number {
  if (schedule.kind === 'interval') {
    const interval = schedule.intervalMs!;
    const base = schedule.nextFireAt || after;
    if (base > after) return base;
    // Advance in whole intervals so the schedule keeps its original phase
    // rather than drifting by however late the tick happened to be.
    const elapsed = after - base;
    return base + (Math.floor(elapsed / interval) + 1) * interval;
  }

  const midnight = Math.floor(after / DAY_MS) * DAY_MS;
  const todayFire = midnight + schedule.atMinuteUtc! * 60_000;
  return todayFire > after ? todayFire : todayFire + DAY_MS;
}

/**
 * How many occurrences were skipped between `from` and `now`, exclusive of
 * the one about to fire. Used to record the gap, never to replay it.
 */
function countMissed(schedule: WorkflowSchedule, now: number): number {
  if (schedule.nextFireAt > now) return 0;
  const period = schedule.kind === 'interval' ? schedule.intervalMs! : DAY_MS;
  return Math.floor((now - schedule.nextFireAt) / period);
}

export function createSchedule(input: CreateScheduleInput, now = Date.now()): WorkflowSchedule {
  validate(input);
  const schedule: WorkflowSchedule = {
    id: `sched_${randomUUID()}`,
    workspaceId: input.workspaceId,
    workflowId: input.workflowId,
    kind: input.kind,
    intervalMs: input.intervalMs,
    atMinuteUtc: input.atMinuteUtc,
    enabled: true,
    createdBy: input.createdBy,
    createdAt: now,
    nextFireAt: 0,
    missedOccurrences: 0,
  };
  schedule.nextFireAt = computeNextFire(schedule, now);
  schedules.set(schedule.id, schedule);
  return schedule;
}

/** Workspace scoping is part of the lookup, as everywhere else. */
export function getSchedule(scheduleId: string, workspaceId: string): WorkflowSchedule | null {
  const schedule = schedules.get(scheduleId);
  if (!schedule || schedule.workspaceId !== workspaceId) return null;
  return schedule;
}

export function listSchedules(workspaceId: string, workflowId?: string): WorkflowSchedule[] {
  return [...schedules.values()]
    .filter((s) => s.workspaceId === workspaceId)
    .filter((s) => !workflowId || s.workflowId === workflowId)
    .sort((a, b) => a.nextFireAt - b.nextFireAt);
}

export function setScheduleEnabled(
  scheduleId: string,
  workspaceId: string,
  enabled: boolean,
  now = Date.now(),
): WorkflowSchedule {
  const schedule = getSchedule(scheduleId, workspaceId);
  if (!schedule) throw new Error('schedule not found');
  schedule.enabled = enabled;
  if (enabled) {
    // Re-enabling does not replay the paused period. Missed occurrences
    // while disabled are not "missed" — they were deliberately not run.
    schedule.nextFireAt = computeNextFire({ ...schedule, nextFireAt: 0 }, now);
  }
  return schedule;
}

export function deleteSchedule(scheduleId: string, workspaceId: string): boolean {
  const schedule = getSchedule(scheduleId, workspaceId);
  if (!schedule) return false;
  schedules.delete(schedule.id);
  return true;
}

export interface DueSchedule {
  schedule: WorkflowSchedule;
  /** Occurrences skipped rather than replayed, for the caller to report. */
  missed: number;
}

/**
 * Advances every enabled schedule to its next future fire and returns the
 * ones that were due. Advancing BEFORE the caller runs anything is
 * deliberate: if starting a run throws, the schedule has still moved on,
 * so a persistently failing workflow cannot wedge the scheduler into
 * retrying the same occurrence forever.
 */
export function collectDue(now = Date.now()): DueSchedule[] {
  const due: DueSchedule[] = [];
  for (const schedule of schedules.values()) {
    if (!schedule.enabled || schedule.nextFireAt > now) continue;

    const missed = countMissed(schedule, now);
    if (missed > 0) {
      schedule.missedOccurrences += missed;
      schedule.lastMissedAt = now;
    }
    schedule.lastFiredAt = now;
    schedule.nextFireAt = computeNextFire(schedule, now);
    due.push({ schedule, missed });
  }
  return due;
}

export async function persistSchedule(scheduleId: string): Promise<boolean> {
  const schedule = schedules.get(scheduleId);
  if (!schedule) return false;
  await store.save(schedule.id, schedule);
  return true;
}

/**
 * Loads schedules at startup. A schedule whose next fire is in the past —
 * because the process was down — is moved forward and its missed
 * occurrences counted here, so the gap is recorded at the moment it is
 * discovered rather than on the next tick.
 */
export async function hydrateSchedules(now = Date.now()): Promise<number> {
  const stored = await store.loadAll();
  let loaded = 0;
  for (const schedule of Object.values(stored)) {
    try {
      if (!schedule?.id || !schedule.workspaceId || !schedule.workflowId) continue;
      validate(schedule);
      if (schedule.enabled && schedule.nextFireAt <= now) {
        const missed = countMissed(schedule, now) + 1;
        schedule.missedOccurrences += missed;
        schedule.lastMissedAt = now;
        schedule.nextFireAt = computeNextFire(schedule, now);
      }
      schedules.set(schedule.id, schedule);
      loaded += 1;
    } catch {
      // Discarded, not repaired: a schedule nobody wrote must not fire.
    }
  }
  return loaded;
}

/** Test-only. */
export function resetSchedules(): void {
  schedules.clear();
}
