'use client';

import { useState } from 'react';
import { Bell, Copy, Loader2, Pause, Play, Trash2, Webhook } from 'lucide-react';
import { Button } from '@synora/design-system';
import { toast } from 'sonner';
import { getApiBaseUrl } from '@/lib/api/client';
import {
  useCreateEventTrigger,
  useCreateTrigger,
  useDeleteEventTrigger,
  useDeleteTrigger,
  useEventTriggers,
  useSetEventTriggerEnabled,
  useSetTriggerEnabled,
  useWorkflowTriggers,
} from '@/lib/api/workflows';

/** Said in the words of the thing that happens, not the event's wire name. */
const EVENT_LABELS: Record<string, string> = {
  'asset.uploaded': 'a file is uploaded to this workspace',
  'project.created': 'a project is created in this workspace',
};

/**
 * Webhook triggers for one workflow — the "reacts to something outside
 * Synora" half of automation, next to schedules (which react to a clock).
 *
 * THE SECRET IS SHOWN EXACTLY ONCE. The create call is the only response
 * that will ever carry the raw value; every read after that shows only a
 * display prefix. This mirrors how the platform already treats API keys,
 * because a trigger secret carries the same risk — it can start a real
 * run against real tools and real budget.
 */
export function TriggerPanel({
  workspaceId,
  workflowId,
}: {
  workspaceId: string;
  workflowId: string;
}) {
  const [revealedUrl, setRevealedUrl] = useState<string | null>(null);
  const [chosenEvent, setChosenEvent] = useState('');

  const { data: triggers = [], isLoading } = useWorkflowTriggers(workspaceId, workflowId);
  const create = useCreateTrigger(workspaceId);
  const setEnabled = useSetTriggerEnabled(workspaceId);
  const remove = useDeleteTrigger(workspaceId);

  const { data: eventData } = useEventTriggers(workspaceId);
  const createEvent = useCreateEventTrigger(workspaceId);
  const setEventEnabled = useSetEventTriggerEnabled(workspaceId);
  const removeEvent = useDeleteEventTrigger(workspaceId);

  // The catalogue comes from the server. Hardcoding it here would let the
  // UI offer an event nobody emits, and the trigger would sit enabled and
  // silent forever.
  const availableEvents = eventData?.availableEvents ?? [];
  const eventTriggers = (eventData?.triggers ?? []).filter((t) => t.workflowId === workflowId);

  function add() {
    create.mutate(workflowId, {
      onSuccess: (created) => {
        setRevealedUrl(`${getApiBaseUrl()}/api/hooks/workflows/${created.secret}`);
        toast.success('Trigger created');
      },
      onError: (e) => toast.error(e.message),
    });
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Copied');
    } catch {
      toast.error('Could not copy — select and copy the URL manually');
    }
  }

  return (
    <section className="space-y-3 rounded-md border p-4">
      <div className="flex items-center gap-2">
        <Webhook className="h-4 w-4" aria-hidden />
        <h3 className="font-semibold">Webhook triggers</h3>
      </div>
      <p className="text-sm text-muted-foreground">
        Let something outside Synora start this workflow — a POST to a private URL runs it,
        using your permissions, exactly like clicking Run yourself.
      </p>

      {revealedUrl && (
        <div
          role="note"
          className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
        >
          <p className="font-semibold">This URL is shown once — copy it now</p>
          <p>
            It will not be shown again. Anyone with this URL can run this workflow, so treat it
            like a password.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded bg-black/5 px-2 py-1 text-xs dark:bg-white/10">
              {revealedUrl}
            </code>
            <Button variant="outline" size="sm" onClick={() => copy(revealedUrl)}>
              <Copy className="mr-1 h-3 w-3" />
              Copy
            </Button>
          </div>
          <Button variant="outline" size="sm" onClick={() => setRevealedUrl(null)}>
            Done — I've saved it
          </Button>
        </div>
      )}

      {isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : triggers.length === 0 ? (
        <p className="text-sm text-muted-foreground">No triggers yet.</p>
      ) : (
        <ul className="space-y-2">
          {triggers.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-2 rounded-md border p-3 text-sm">
              <code className="text-xs">{t.secretPreview}…</code>
              <span
                className={
                  t.enabled
                    ? 'rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200'
                    : 'rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground'
                }
              >
                {t.enabled ? 'active' : 'paused'}
              </span>
              <span className="flex-1 text-xs text-muted-foreground">
                {t.firedCount} fire{t.firedCount === 1 ? '' : 's'}
                {t.lastFiredAt ? ` · last ${new Date(t.lastFiredAt).toLocaleString()}` : ''}
              </span>
              <Button
                variant="outline"
                size="sm"
                aria-label={t.enabled ? 'Pause trigger' : 'Resume trigger'}
                onClick={() =>
                  setEnabled.mutate(
                    { triggerId: t.id, enabled: !t.enabled },
                    { onError: (e) => toast.error(e.message) },
                  )
                }
              >
                {t.enabled ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
              </Button>
              <Button
                variant="outline"
                size="sm"
                aria-label="Delete trigger"
                onClick={() =>
                  remove.mutate(t.id, {
                    onSuccess: () => toast.success('Trigger deleted'),
                    onError: (e) => toast.error(e.message),
                  })
                }
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Button onClick={add} disabled={create.isPending}>
        {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        New trigger
      </Button>

      <p className="text-xs text-muted-foreground">
        A paused trigger behaves as if it did not exist — the URL is refused, not merely queued.
        Deleting one is permanent; a new trigger gets a new URL.
      </p>

      <div className="space-y-3 border-t pt-4">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4" aria-hidden />
          <h3 className="font-semibold">When something happens in Synora</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Run this workflow when something happens here, without anything outside having to call
          in. It runs using <strong>your</strong> permissions, not those of whoever&rsquo;s action
          set it off.
        </p>

        {eventTriggers.length === 0 ? (
          <p className="text-sm text-muted-foreground">No event triggers yet.</p>
        ) : (
          <ul className="space-y-2">
            {eventTriggers.map((t) => (
              <li
                key={t.id}
                className="flex flex-wrap items-center gap-2 rounded-md border p-3 text-sm"
              >
                <span className="flex-1">
                  When {EVENT_LABELS[t.event] ?? t.event}
                  {t.filter?.mimeTypePrefix ? ` (only ${t.filter.mimeTypePrefix}…)` : ''}
                  <span className="block text-xs text-muted-foreground">
                    {t.firedCount} run{t.firedCount === 1 ? '' : 's'} started
                    {t.lastFiredAt ? ` · last ${new Date(t.lastFiredAt).toLocaleString()}` : ''}
                    {/* Surfaced rather than hidden: a trigger that keeps
                        hitting the limit is a wiring problem somebody
                        should see, not a quiet ceiling. */}
                    {t.suppressedCount > 0
                      ? ` · ${t.suppressedCount} declined for firing too fast`
                      : ''}
                  </span>
                </span>
                <span
                  className={
                    t.enabled
                      ? 'rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200'
                      : 'rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground'
                  }
                >
                  {t.enabled ? 'active' : 'paused'}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={t.enabled ? 'Pause event trigger' : 'Resume event trigger'}
                  onClick={() =>
                    setEventEnabled.mutate(
                      { triggerId: t.id, enabled: !t.enabled },
                      { onError: (e) => toast.error(e.message) },
                    )
                  }
                >
                  {t.enabled ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label="Delete event trigger"
                  onClick={() =>
                    removeEvent.mutate(t.id, {
                      onSuccess: () => toast.success('Event trigger deleted'),
                      onError: (e) => toast.error(e.message),
                    })
                  }
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <label htmlFor="event-trigger-event" className="block text-xs font-medium">
              Run when
            </label>
            <select
              id="event-trigger-event"
              value={chosenEvent}
              onChange={(e) => setChosenEvent(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="">Choose something that happens…</option>
              {availableEvents.map((name) => (
                <option key={name} value={name}>
                  {EVENT_LABELS[name] ?? name}
                </option>
              ))}
            </select>
          </div>
          <Button
            onClick={() =>
              createEvent.mutate(
                { workflowId, event: chosenEvent },
                {
                  onSuccess: () => {
                    toast.success('Event trigger created');
                    setChosenEvent('');
                  },
                  onError: (e) => toast.error(e.message),
                },
              )
            }
            disabled={createEvent.isPending || chosenEvent === ''}
          >
            {createEvent.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Add event trigger
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          Only the things listed above can start a workflow — the list comes from what Synora
          actually announces, so nothing here can be wired to an event that never arrives. A
          trigger will start at most {eventData?.burst.limit ?? 20} runs a minute; beyond that it
          declines and says so, which keeps one careless setup from spending a workspace&rsquo;s
          budget on a bulk upload. Events that happen while Synora is restarting are missed
          rather than replayed.
        </p>
      </div>
    </section>
  );
}
