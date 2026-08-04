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

  it('scopes lookups and listing to the workspace', () => {
    const s = makeInterval(HOUR);
    expect(getSchedule(s.id, 'ws_other')).toBeNull();
    expect(listSchedules('ws_other')).toEqual([]);
    expect(listSchedules(WS, 'wf_other')).toEqual([]);
    expect(listSchedules(WS, 'wf_1')).toHaveLength(1);
    expect(deleteSchedule(s.id, 'ws_other')).toBe(false);
    expect(deleteSchedule(s.id, WS)).toBe(true);
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
