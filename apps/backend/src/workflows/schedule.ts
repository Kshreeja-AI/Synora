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
  /** kind=daily: minutes past midnight, 0–1439, in `timeZone`. */
  atMinuteUtc?: number;
  /**
   * kind=daily: an IANA zone such as `Europe/London`. Absent means UTC,
   * which is what every schedule created before this existed meant.
   */
  timeZone?: string;
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
  timeZone?: string;
  createdBy: string;
}

/**
 * Whether the runtime actually knows this zone.
 *
 * Checked rather than pattern-matched: `Europe/Atlantis` looks exactly
 * like a real zone and would silently fall back to UTC, producing a
 * schedule that fires at the wrong time forever with nothing to see. The
 * runtime is the only authority on which zones exist.
 */
export function isKnownTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Refuses anything it does not fully understand, rather than filling in a
 * default. A schedule the author did not mean is worse than no schedule.
 */
function validate(input: {
  kind: ScheduleKind;
  intervalMs?: number;
  atMinuteUtc?: number;
  timeZone?: string;
}): void {
  if (input.timeZone !== undefined && !isKnownTimeZone(input.timeZone)) {
    // Refused, never quietly treated as UTC: a schedule that fires at the
    // wrong hour forever, because of a typo nobody was told about, is
    // exactly the invisible failure this file exists to avoid.
    throw new Error(`unknown time zone ${JSON.stringify(String(input.timeZone))}`);
  }
  if (input.kind === 'interval') {
    if (input.atMinuteUtc !== undefined) {
      throw new Error('an interval schedule must not also specify a time of day');
    }
    if (input.timeZone !== undefined) {
      // An interval has no time of day, so a zone would mean nothing —
      // and accepting a meaningless field implies it does something.
      throw new Error('an interval schedule must not specify a time zone');
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

/**
 * What `timeZone` was offset from UTC at a given instant, in ms.
 *
 * Derived by asking the runtime to render the instant in that zone and
 * measuring how far the rendered wall clock sits from the real one. That
 * is the only way to get this right across DST without shipping a
 * timezone database of our own, and the runtime's database is the same
 * one everything else on the machine trusts.
 */
function zoneOffsetAt(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs));

  const at = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? '0');
  // `hour` renders as 24 at midnight under hour12:false in some runtimes.
  const hour = at('hour') % 24;
  const asIfUtc = Date.UTC(at('year'), at('month') - 1, at('day'), hour, at('minute'), at('second'));
  return asIfUtc - utcMs;
}

/**
 * The UTC instant at which a given local wall-clock time occurs in a zone.
 *
 * TWO PASSES, BECAUSE THE OFFSET DEPENDS ON THE ANSWER. Guessing the
 * offset at the naive instant and subtracting it can land on the other
 * side of a DST boundary, where the offset is different; measuring again
 * at the corrected instant and re-deriving fixes that. On a spring-forward
 * gap — where the requested local time does not exist at all — this
 * settles on the instant immediately after the jump rather than throwing,
 * because a schedule silently not firing one day a year is worse than one
 * firing an hour late.
 */
function utcForLocalTime(
  year: number,
  monthIndex: number,
  day: number,
  minutes: number,
  timeZone: string,
): number {
  const naive = Date.UTC(year, monthIndex, day, Math.floor(minutes / 60), minutes % 60);
  const firstGuess = naive - zoneOffsetAt(naive, timeZone);
  const corrected = naive - zoneOffsetAt(firstGuess, timeZone);
  return corrected;
}

/** The calendar date `instant` falls on, as seen in `timeZone`. */
function localDateParts(instant: number, timeZone: string): {
  year: number;
  monthIndex: number;
  day: number;
} {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(instant));
  const at = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? '0');
  return { year: at('year'), monthIndex: at('month') - 1, day: at('day') };
}

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

  if (!schedule.timeZone) {
    // The original behaviour, unchanged: no zone means UTC, which is what
    // every schedule created before zones existed meant.
    const midnight = Math.floor(after / DAY_MS) * DAY_MS;
    const todayFire = midnight + schedule.atMinuteUtc! * 60_000;
    return todayFire > after ? todayFire : todayFire + DAY_MS;
  }

  // Walk forward by CALENDAR days in the zone, not by adding 24 hours: on
  // a DST boundary the local day is 23 or 25 hours long, and adding a
  // fixed day would drift the wall-clock time the user actually chose.
  const today = localDateParts(after, schedule.timeZone);
  const todayFire = utcForLocalTime(
    today.year,
    today.monthIndex,
    today.day,
    schedule.atMinuteUtc!,
    schedule.timeZone,
  );
  if (todayFire > after) return todayFire;

  const tomorrow = localDateParts(after + DAY_MS, schedule.timeZone);
  return utcForLocalTime(
    tomorrow.year,
    tomorrow.monthIndex,
    tomorrow.day,
    schedule.atMinuteUtc!,
    schedule.timeZone,
  );
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
    timeZone: input.timeZone,
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

/**
 * Removes a schedule from memory AND from the durable record.
 *
 * ASYNC FOR A REASON, and the reason is a bug this used to have: it only
 * ever removed the in-memory entry, while `persistSchedule` had written the
 * schedule to the store at creation. `hydrateSchedules` loads everything in
 * that store at startup, so a deleted schedule came back the next time the
 * process restarted — and came back silently, because nobody watches for
 * the return of something they already deleted. A deletion that does not
 * survive a restart is not a deletion.
 */
export async function deleteSchedule(
  scheduleId: string,
  workspaceId: string
): Promise<boolean> {
  const schedule = getSchedule(scheduleId, workspaceId);
  if (!schedule) return false;
  schedules.delete(schedule.id);
  // Store first-and-only-if the in-memory removal was legitimate: the
  // workspace scoping above is what decides whether this caller may touch
  // this id at all, and the store has no idea about workspaces.
  await store.delete(schedule.id);
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
