'use client';

import { History } from 'lucide-react';
import { useWorkspaceActivity } from '@/lib/api/activity';

/**
 * What happened here recently, as sentences.
 *
 * This panel and "Waiting for you" divide the home page between them by a
 * clean rule: that one shows what is blocked on you, this one shows what
 * merely happened. Nothing here claims attention — history is for
 * reading when you want it, and a feed that demands to be caught up on
 * stops being read at all.
 *
 * THE SENTENCE COMES FROM THE SERVER VERBATIM. It was composed from what
 * the audit log actually recorded; a second wording composed here could
 * drift from the first, and two descriptions of one event is one too
 * many.
 */

function when(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (!Number.isFinite(minutes) || minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function RecentActivity({ workspaceId }: { workspaceId: string }) {
  const { data: entries = [], isLoading } = useWorkspaceActivity(workspaceId, { limit: 15 });

  if (isLoading) return null;

  return (
    <section className="space-y-3 rounded-md border p-4" aria-labelledby="activity-heading">
      <div className="flex items-center gap-2">
        <History className="h-4 w-4" aria-hidden />
        <h2 id="activity-heading" className="font-semibold">
          Recent activity
        </h2>
      </div>

      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing recorded yet. Work done in this workspace — projects created, files uploaded,
          tools run — will appear here as it happens.
        </p>
      ) : (
        <ol className="space-y-1">
          {entries.map((entry) => (
            <li key={entry.id} className="flex gap-2 p-1 text-sm">
              <span className="flex-1">{entry.sentence}</span>
              <time dateTime={entry.at} className="shrink-0 text-xs text-muted-foreground">
                {when(entry.at)}
              </time>
            </li>
          ))}
        </ol>
      )}

      <p className="text-xs text-muted-foreground">
        Work events only. Membership, roles and billing history live in the audit log, which
        workspace admins can see under Admin.
      </p>
    </section>
  );
}
