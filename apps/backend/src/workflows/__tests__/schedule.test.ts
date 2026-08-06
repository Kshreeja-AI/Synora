/**
 * Scheduler tests.
 *
 * The property that matters most here is what happens to occurrences that
 * were due while nothing was running. Replaying them turns an outage into
 * a burst of real actions against real tools; silently skipping them
 * leaves the owner believing a workflow ran when it did not. These tests
 * pin the third option: skip, and count.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryKeyedStore } from '../../agents/agent-stores';
import {
  MIN_INTERVAL_MS,
  collectDue,
  computeNextFire,
  isKnownTimeZone,
  createSchedule,
  deleteSchedule,
  getSchedule,
  hydrateSchedules,
  listSchedules,
  persistSchedule,
  resetSchedules,
  setScheduleEnabled,
  setScheduleStore,
  type WorkflowSchedule,
} from '../schedule';

const WS = 'ws_alpha';
const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
// A fixed instant on a day boundary, so daily-schedule arithmetic is exact.
const T0 = Date.UTC(2026, 7, 4, 0, 0, 0);

function makeInterval(intervalMs = HOUR, now = T0) {
  return createSchedule(
    { workspaceId: WS, workflowId: 'wf_1', kind: 'interval', intervalMs, createdBy: 'u1' },
    now,
  );
}

beforeEach(() => {
  resetSchedules();
  setScheduleStore(new InMemoryKeyedStore<WorkflowSchedule>());
});

describe('schedule validation', () => {
  it('refuses a shape it does not fully understand rather than guessing', () => {
    // A schedule the author did not mean is worse than no schedule.
    expect(() =>
      createSchedule({
        workspaceId: WS,
        workflowId: 'wf_1',
        kind: 'interval',
        intervalMs: HOUR,
        atMinuteUtc: 540,
        createdBy: 'u1',
      }),
    ).toThrow(/must not also specify a time of day/);

    expect(() =>
      createSchedule({
        workspaceId: WS,
        workflowId: 'wf_1',
        kind: 'daily',
        intervalMs: HOUR,
        atMinuteUtc: 540,
        createdBy: 'u1',
      }),
    ).toThrow(/must not also specify an interval/);

    expect(() =>
      createSchedule({
        workspaceId: WS,
        workflowId: 'wf_1',
        kind: 'weekly' as never,
        createdBy: 'u1',
      }),
    ).toThrow(/unknown schedule kind/);
  });

  it('refuses an interval short enough to be a busy loop', () => {
    expect(() =>
      createSchedule({
        workspaceId: WS,
        workflowId: 'wf_1',
        kind: 'interval',
        intervalMs: MIN_INTERVAL_MS - 1,
        createdBy: 'u1',
      }),
    ).toThrow(/at least/);
  });

  it('refuses a daily time outside the day', () => {
    for (const atMinuteUtc of [-1, 1440, 12.5]) {
      expect(() =>
        createSchedule({
          workspaceId: WS,
          workflowId: 'wf_1',
          kind: 'daily',
          atMinuteUtc,
          createdBy: 'u1',
        }),
      ).toThrow(/between 0 and 1439/);
    }
  });
});

describe('next fire computation', () => {
  it('schedules an interval one period ahead', () => {
    const s = makeInterval(HOUR);
    expect(s.nextFireAt).toBe(T0 + HOUR);
  });

  it('keeps its original phase rather than drifting when a tick is late', () => {
    const s = makeInterval(HOUR);
    // Two and a half hours late. The next fire is on the original hourly
    // boundary, not T0+2.5h+1h — otherwise every late tick permanently
    // shifts a "runs on the hour" schedule.
    const next = computeNextFire(s, T0 + 2.5 * HOUR);
    expect((next - T0) % HOUR).toBe(0);
    expect(next).toBe(T0 + 3 * HOUR);
  });

  it('schedules a daily time today when still ahead, tomorrow when past', () => {
    const morning = createSchedule(
      { workspaceId: WS, workflowId: 'wf_1', kind: 'daily', atMinuteUtc: 9 * 60, createdBy: 'u1' },
      T0,
    );
    expect(morning.nextFireAt).toBe(T0 + 9 * HOUR);

    const afterNine = createSchedule(
      { workspaceId: WS, workflowId: 'wf_1', kind: 'daily', atMinuteUtc: 9 * 60, createdBy: 'u1' },
      T0 + 10 * HOUR,
    );
    expect(afterNine.nextFireAt).toBe(T0 + DAY + 9 * HOUR);
  });
});

describe('collecting due schedules', () => {
  it('returns nothing before the first fire', () => {
    makeInterval(HOUR);
    expect(collectDue(T0 + 30 * 60_000)).toEqual([]);
  });

  it('fires once when due and advances', () => {
    const s = makeInterval(HOUR);
    const due = collectDue(T0 + HOUR);

    expect(due).toHaveLength(1);
    expect(due[0].missed).toBe(0);
    expect(getSchedule(s.id, WS)!.nextFireAt).toBe(T0 + 2 * HOUR);
    expect(getSchedule(s.id, WS)!.lastFiredAt).toBe(T0 + HOUR);
  });

  it('does not replay a backlog — it fires once and counts what it skipped', () => {
    const s = makeInterval(HOUR);

    // Two days down on an hourly schedule. Replaying would fire 48 times
    // against real tools in a burst; that is how a scheduler turns an
    // outage into an incident.
    const due = collectDue(T0 + 48 * HOUR);

    expect(due).toHaveLength(1);
    expect(due[0].missed).toBe(47);
    const after = getSchedule(s.id, WS)!;
    expect(after.missedOccurrences).toBe(47);
    // Recorded, not absorbed: the owner can see the gap.
    expect(after.lastMissedAt).toBe(T0 + 48 * HOUR);
    expect(after.nextFireAt).toBeGreaterThan(T0 + 48 * HOUR);
  });

  it('advances before the caller runs anything, so a failing workflow cannot wedge it', () => {
    const s = makeInterval(HOUR);
    collectDue(T0 + HOUR);

    // The caller may throw when starting the run. The schedule has already
    // moved on, so the same occurrence is never retried forever.
    expect(getSchedule(s.id, WS)!.nextFireAt).toBe(T0 + 2 * HOUR);
    expect(collectDue(T0 + HOUR)).toEqual([]);
  });

  it('skips a disabled schedule and does not treat the pause as missed', () => {
    const s = makeInterval(HOUR);
    setScheduleEnabled(s.id, WS, false);

    expect(collectDue(T0 + 10 * HOUR)).toEqual([]);
    expect(getSchedule(s.id, WS)!.missedOccurrences).toBe(0);

    // Re-enabling starts from now. Time spent deliberately paused was not
    // "missed" — nobody expected those runs to happen.
    setScheduleEnabled(s.id, WS, true, T0 + 10 * HOUR);
    expect(getSchedule(s.id, WS)!.nextFireAt).toBe(T0 + 11 * HOUR);
    expect(getSchedule(s.id, WS)!.missedOccurrences).toBe(0);
  });

  it('scopes lookups and listing to the workspace', async () => {
    const s = makeInterval(HOUR);
    expect(getSchedule(s.id, 'ws_other')).toBeNull();
    expect(listSchedules('ws_other')).toEqual([]);
    expect(listSchedules(WS, 'wf_other')).toEqual([]);
    expect(listSchedules(WS, 'wf_1')).toHaveLength(1);
    expect(await deleteSchedule(s.id, 'ws_other')).toBe(false);
    expect(await deleteSchedule(s.id, WS)).toBe(true);
  });
});

describe('schedule durability', () => {
  it('restores a schedule and records the outage as missed occurrences', async () => {
    const s = makeInterval(HOUR);
    await persistSchedule(s.id);

    resetSchedules();
    // The process was down for five hours past the next fire.
    const loaded = await hydrateSchedules(T0 + 6 * HOUR);

    expect(loaded).toBe(1);
    const restored = getSchedule(s.id, WS)!;
    // Five whole periods elapsed plus the one that was already due.
    expect(restored.missedOccurrences).toBe(6);
    expect(restored.nextFireAt).toBeGreaterThan(T0 + 6 * HOUR);
  });

  it('does not invent missed occurrences for a schedule that is not yet due', async () => {
    const s = makeInterval(HOUR);
    await persistSchedule(s.id);

    resetSchedules();
    await hydrateSchedules(T0 + 30 * 60_000);

    expect(getSchedule(s.id, WS)!.missedOccurrences).toBe(0);
    expect(getSchedule(s.id, WS)!.nextFireAt).toBe(T0 + HOUR);
  });

  it('discards a stored schedule that no longer validates', async () => {
    const store = new InMemoryKeyedStore<WorkflowSchedule>();
    await store.save('sched_bad', {
      id: 'sched_bad',
      workspaceId: WS,
      workflowId: 'wf_1',
      kind: 'interval',
      // Below the floor: an older version might have written it.
      intervalMs: 5,
      enabled: true,
      createdBy: 'u',
      createdAt: T0,
      nextFireAt: T0,
      missedOccurrences: 0,
    });
    setScheduleStore(store);

    // A schedule nobody wrote must not fire.
    expect(await hydrateSchedules(T0)).toBe(0);
    expect(getSchedule('sched_bad', WS)).toBeNull();
  });

  it('does not resurrect a deleted schedule on the next restart', async () => {
    // A REAL BUG this pins. `deleteSchedule` used to remove only the
    // in-memory entry while creation had written the schedule to the store,
    // so `hydrateSchedules` brought it back the next time the process
    // started — silently, because nobody watches for the return of
    // something they already deleted. A deletion that does not survive a
    // restart is not a deletion.
    const s = makeInterval(HOUR);
    await persistSchedule(s.id);

    expect(await deleteSchedule(s.id, WS)).toBe(true);

    resetSchedules();
    expect(await hydrateSchedules(T0 + HOUR)).toBe(0);
    expect(getSchedule(s.id, WS)).toBeNull();
  });

  it('leaves a disabled schedule alone across a restart', async () => {
    const s = makeInterval(HOUR);
    setScheduleEnabled(s.id, WS, false);
    await persistSchedule(s.id);

    resetSchedules();
    await hydrateSchedules(T0 + 100 * HOUR);

    expect(getSchedule(s.id, WS)!.enabled).toBe(false);
    expect(getSchedule(s.id, WS)!.missedOccurrences).toBe(0);
  });
});

describe('daily schedules in a real time zone', () => {
  function daily(atMinuteUtc: number, timeZone: string | undefined, now: number) {
    return createSchedule(
      { workspaceId: WS, workflowId: 'wf_1', kind: 'daily', atMinuteUtc, timeZone, createdBy: 'u1' },
      now,
    );
  }

  function localTimeOf(instant: number, timeZone: string): string {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(instant));
  }

  it('refuses a zone the runtime does not know, rather than falling back to UTC', () => {
    // A typo that silently became UTC would fire at the wrong hour every
    // day, forever, with nothing anywhere to see.
    expect(isKnownTimeZone('Europe/Atlantis')).toBe(false);
    expect(() => daily(540, 'Europe/Atlantis', T0)).toThrow(/unknown time zone/);
  });

  it('refuses a time zone on an interval schedule, which has no time of day', () => {
    expect(() =>
      createSchedule({
        workspaceId: WS,
        workflowId: 'wf_1',
        kind: 'interval',
        intervalMs: HOUR,
        timeZone: 'Europe/London',
        createdBy: 'u1',
      }),
    ).toThrow(/must not specify a time zone/);
  });

  it('fires at the chosen local hour, not the same UTC hour', () => {
    // 09:00 in New York in January is 14:00 UTC — five hours off what the
    // old UTC-only behaviour would have produced.
    const schedule = daily(9 * 60, 'America/New_York', Date.UTC(2026, 0, 15, 0, 0));
    expect(localTimeOf(schedule.nextFireAt, 'America/New_York')).toBe('09:00');
    expect(new Date(schedule.nextFireAt).getUTCHours()).toBe(14);
  });

  it('keeps the same local time across a spring-forward boundary', () => {
    // The US moves to DST on 8 March 2026. A schedule set for 09:00 local
    // must still be 09:00 local afterwards, even though the UTC hour
    // changed — adding a flat 24 hours would have drifted it.
    // 05:00 in New York on 7 March — BEFORE that day's 09:00, so the
    // first fire is on EST and the second lands after the switch. Placing
    // it after 09:00 would put both fires on EDT and prove nothing.
    const before = Date.UTC(2026, 2, 7, 10, 0);
    const schedule = daily(9 * 60, 'America/New_York', before);
    expect(localTimeOf(schedule.nextFireAt, 'America/New_York')).toBe('09:00');
    expect(new Date(schedule.nextFireAt).getUTCHours()).toBe(14);

    const next = computeNextFire(schedule, schedule.nextFireAt);
    expect(localTimeOf(next, 'America/New_York')).toBe('09:00');
    // Same wall clock, different UTC hour: that IS the point.
    expect(new Date(next).getUTCHours()).toBe(13);
    // And the gap between them is 23 hours, because that local day was.
    expect(next - schedule.nextFireAt).toBe(23 * HOUR);
  });

  it('keeps the same local time across an autumn-back boundary', () => {
    // 1 November 2026, the other direction: a 25-hour local day. Again
    // placed before the 31st's 09:00 so the pair straddles the switch.
    const before = Date.UTC(2026, 9, 31, 10, 0);
    const schedule = daily(9 * 60, 'America/New_York', before);
    const next = computeNextFire(schedule, schedule.nextFireAt);
    expect(localTimeOf(next, 'America/New_York')).toBe('09:00');
    expect(next - schedule.nextFireAt).toBe(25 * HOUR);
  });

  it('advances to tomorrow when today\'s local time has passed', () => {
    const morning = Date.UTC(2026, 5, 15, 18, 0); // 14:00 in New York
    const schedule = daily(9 * 60, 'America/New_York', morning);
    // 09:00 today is behind us, so the next one is tomorrow — still 09:00.
    expect(localTimeOf(schedule.nextFireAt, 'America/New_York')).toBe('09:00');
    expect(schedule.nextFireAt).toBeGreaterThan(morning);
    expect(schedule.nextFireAt - morning).toBeLessThan(DAY);
  });

  it('leaves a zone-less schedule on exactly its old UTC behaviour', () => {
    // Every schedule created before zones existed meant UTC, and must
    // keep meaning UTC after this change.
    const schedule = daily(9 * 60, undefined, T0);
    expect(schedule.nextFireAt).toBe(T0 + 9 * HOUR);
    expect(schedule.timeZone).toBeUndefined();
  });

  it('survives a restart with its zone intact', async () => {
    const schedule = daily(9 * 60, 'Asia/Kolkata', Date.UTC(2026, 5, 15, 0, 0));
    await persistSchedule(schedule.id);

    resetSchedules();
    await hydrateSchedules(Date.UTC(2026, 5, 15, 0, 0));

    const loaded = getSchedule(schedule.id, WS)!;
    expect(loaded.timeZone).toBe('Asia/Kolkata');
    expect(localTimeOf(loaded.nextFireAt, 'Asia/Kolkata')).toBe('09:00');
  });
});

