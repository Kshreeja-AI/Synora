'use client';

import { useState } from 'react';
import { AlertTriangle, Clock, Loader2, Pause, Play, Trash2 } from 'lucide-react';
import { Button } from '@synora/design-system';
import { toast } from 'sonner';
import {
  useCreateSchedule,
  useDeleteSchedule,
  useSetScheduleEnabled,
  useWorkflowSchedules,
  type ScheduleKind,
  type WorkflowSchedule,
} from '@/lib/api/workflows';

/**
 * Schedules for one workflow.
 *
 * THE PART THAT MATTERS MOST is the missed-occurrence display. When the
 * server is down, occurrences that came due are skipped rather than
 * replayed — the right behaviour, because replaying an hourly workflow
 * after a two-day outage means 48 real runs in a burst. But skipping is
 * only honest if the user can SEE it. A schedule silently not running
 * looks identical to a schedule running fine, and the difference is
 * exactly what the owner needs to know. So a missed count is rendered as
 * a warning, not tucked into a tooltip.
 *
 * The tick resolution is stated too. "Daily at 09:00" really means "at or
 * shortly after", and a user who reads a time field is entitled to know
 * the system is not claiming to the second.
 */

/**
 * The browser's own zone, which is very probably the one the person
 * means. Offered as the default rather than assumed: the field is
 * visible, so a schedule shared with a colleague elsewhere is not
 * silently in someone else's morning.
 */
function localZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function describe(schedule: WorkflowSchedule): string {
  if (schedule.kind === 'interval') {
    const minutes = Math.round((schedule.intervalMs ?? 0) / 60_000);
    if (minutes % 60 === 0) {
      const hours = minutes / 60;
      return `every ${hours} hour${hours === 1 ? '' : 's'}`;
    }
    return `every ${minutes} minute${minutes === 1 ? '' : 's'}`;
  }
  const at = schedule.atMinuteUtc ?? 0;
  const hh = String(Math.floor(at / 60)).padStart(2, '0');
  const mm = String(at % 60).padStart(2, '0');
  // The zone is always named, never left to be assumed — "09:00" without
  // one is the ambiguity this feature exists to remove.
  return `daily at ${hh}:${mm} ${schedule.timeZone ?? 'UTC'}`;
}

export function SchedulePanel({
  workspaceId,
  workflowId,
}: {
  workspaceId: string;
  workflowId: string;
}) {
  const [kind, setKind] = useState<ScheduleKind>('daily');
  const [hours, setHours] = useState(9);
  const [timeZone, setTimeZone] = useState(localZone());
  const [intervalMinutes, setIntervalMinutes] = useState(60);

  const { data: schedules = [], isLoading } = useWorkflowSchedules(workspaceId, workflowId);
  const create = useCreateSchedule(workspaceId);
  const setEnabled = useSetScheduleEnabled(workspaceId);
  const remove = useDeleteSchedule(workspaceId);

  function add() {
    create.mutate(
      {
        workflowId,
        input:
          kind === 'daily'
            ? { kind, atMinuteUtc: hours * 60, timeZone }
            : { kind, intervalMs: intervalMinutes * 60_000 },
      },
      {
        onSuccess: () => toast.success('Schedule added'),
        onError: (e) => toast.error(e.message),
      },
    );
  }

  return (
    <section className="space-y-3 rounded-md border p-4">
      <div className="flex items-center gap-2">
        <Clock className="h-4 w-4" aria-hidden />
        <h3 className="font-semibold">Schedules</h3>
      </div>

      {isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : schedules.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Not scheduled. It runs only when someone starts it.
        </p>
      ) : (
        <ul className="space-y-2">
          {schedules.map((s) => (
            <li key={s.id} className="space-y-2 rounded-md border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{describe(s)}</span>
                <span
                  className={
                    s.enabled
                      ? 'rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200'
                      : 'rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground'
                  }
                >
                  {s.enabled ? 'active' : 'paused'}
                </span>
                <span className="flex-1 text-xs text-muted-foreground">
                  next {new Date(s.nextFireAt).toLocaleString()}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={s.enabled ? 'Pause schedule' : 'Resume schedule'}
                  onClick={() =>
                    setEnabled.mutate(
                      { scheduleId: s.id, enabled: !s.enabled },
                      { onError: (e) => toast.error(e.message) },
                    )
                  }
                >
                  {s.enabled ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label="Delete schedule"
                  onClick={() =>
                    remove.mutate(s.id, {
                      onSuccess: () => toast.success('Schedule removed'),
                      onError: (e) => toast.error(e.message),
                    })
                  }
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>

              {s.missedOccurrences > 0 && (
                <div
                  role="alert"
                  className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
                >
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                  <span>
                    {s.missedOccurrences} scheduled run
                    {s.missedOccurrences === 1 ? '' : 's'} did not happen, because nothing was
                    running when {s.missedOccurrences === 1 ? 'it was' : 'they were'} due. They
                    were <strong>not</strong> run later — catching up would have fired them all
                    at once.
                  </span>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-end gap-2 border-t pt-3">
        <div className="space-y-1">
          <label htmlFor="sched-kind" className="text-xs font-medium">
            Repeat
          </label>
          <select
            id="sched-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as ScheduleKind)}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="daily">Daily at a time</option>
            <option value="interval">Every so often</option>
          </select>
        </div>

        {kind === 'daily' ? (
          <>
            <div className="space-y-1">
              <label htmlFor="sched-hour" className="text-xs font-medium">
                Hour
              </label>
              <input
                id="sched-hour"
                type="number"
                min={0}
                max={23}
                value={hours}
                onChange={(e) => setHours(Number(e.target.value))}
                className="h-9 w-20 rounded-md border border-input bg-background px-2 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="sched-zone" className="text-xs font-medium">
                Time zone
              </label>
              <input
                id="sched-zone"
                value={timeZone}
                onChange={(e) => setTimeZone(e.target.value)}
                className="h-9 w-56 rounded-md border border-input bg-background px-2 text-sm"
              />
            </div>
          </>
        ) : (
          <div className="space-y-1">
            <label htmlFor="sched-interval" className="text-xs font-medium">
              Minutes
            </label>
            <input
              id="sched-interval"
              type="number"
              min={1}
              value={intervalMinutes}
              onChange={(e) => setIntervalMinutes(Number(e.target.value))}
              className="h-9 w-24 rounded-md border border-input bg-background px-2 text-sm"
            />
          </div>
        )}

        <Button onClick={add} disabled={create.isPending}>
          {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Add schedule
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        A daily run happens at that time in the zone you name, and keeps happening at that
        local time when the clocks change. A run starts at or shortly after its scheduled
        moment — the clock is checked every 30 seconds. A scheduled run uses your permissions,
        so it can only do what you can do.
      </p>
    </section>
  );
}
