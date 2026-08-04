'use client';

import { useState } from 'react';
import { Copy, Loader2, Pause, Play, Trash2, Webhook } from 'lucide-react';
import { Button } from '@synora/design-system';
import { toast } from 'sonner';
import { getApiBaseUrl } from '@/lib/api/client';
import {
  useCreateTrigger,
  useDeleteTrigger,
  useSetTriggerEnabled,
  useWorkflowTriggers,
} from '@/lib/api/workflows';

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

  const { data: triggers = [], isLoading } = useWorkflowTriggers(workspaceId, workflowId);
  const create = useCreateTrigger(workspaceId);
  const setEnabled = useSetTriggerEnabled(workspaceId);
  const remove = useDeleteTrigger(workspaceId);

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
    </section>
  );
}
