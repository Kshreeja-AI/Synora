'use client';

import { Sparkles } from 'lucide-react';
import { useWorkspaceWhatsNew } from '../../lib/api/activity';

/**
 * What happened in this workspace since you were last here.
 *
 * Absent on a first-ever visit (everything would be trivially "new",
 * which states nothing) and absent when nothing changed (a banner
 * announcing zero is noise dressed as information) — the same discipline
 * as the project-level digest. When it does render, the count is over
 * the exact same allowlisted work events the Recent activity feed shows,
 * so the number and the list below it can never disagree.
 */
export function WhatsNew({ workspaceId }: { workspaceId: string }) {
  const { data } = useWorkspaceWhatsNew(workspaceId);

  if (!data || data.count === 0) return null;

  return (
    <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
      <p className="flex items-center gap-2 text-sm font-medium">
        <Sparkles className="h-4 w-4 text-primary" aria-hidden />
        {data.count} thing{data.count === 1 ? '' : 's'} happened while you were away
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        The details are in Recent activity below.
      </p>
    </div>
  );
}
