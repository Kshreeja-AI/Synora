'use client';

import { Eye, KeyRound, AlertTriangle, PauseCircle } from 'lucide-react';
import type { ToolExecutionPreview } from '@/lib/api/tools';

/**
 * What running this tool would do, stated before it is done.
 *
 * FACTS, NOT A VERDICT. This panel never grades a tool "safe" or
 * "risky" — Synora has no system that can judge that, and a made-up
 * rating is the same fabricated confidence the platform refuses
 * everywhere else. It reports where the request goes, how, which
 * declared secrets it would carry, what would stop it, and what cannot
 * be known without actually sending it. The reader draws the
 * conclusion, because the reader is the one who knows their business.
 */
export function ToolPreviewPanel({ preview }: { preview: ToolExecutionPreview }) {
  return (
    <section
      className="space-y-2 rounded-md border border-border bg-background p-3"
      aria-labelledby="tool-preview-heading"
    >
      <div className="flex items-center gap-2">
        <Eye className="h-4 w-4" aria-hidden />
        <h4 id="tool-preview-heading" className="text-sm font-semibold">
          Nothing has been sent
        </h4>
      </div>

      {preview.destination && (
        <p className="text-xs text-muted-foreground">
          {preview.destination.hostDependsOnSecret ? (
            <>
              Would send a {preview.destination.method} request to an address that comes from a
              stored secret, so the destination cannot be shown here.
            </>
          ) : (
            <>
              Would send a {preview.destination.method} request to{' '}
              <span className="font-medium text-foreground">{preview.destination.host}</span>.
            </>
          )}
        </p>
      )}

      {preview.wouldRequireApproval && (
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <PauseCircle className="h-3 w-3" aria-hidden />
          It would stop and wait for approval before running.
        </p>
      )}

      {preview.secretsUsed.length > 0 && (
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <KeyRound className="h-3 w-3" aria-hidden />
          Carries stored secret{preview.secretsUsed.length > 1 ? 's' : ''}:{' '}
          {preview.secretsUsed.join(', ')} (names only — values are never shown).
        </p>
      )}

      {preview.rateLimit && (
        <p className="text-xs text-muted-foreground">
          Rate limit: {preview.rateLimit.usedInLastMinute} of {preview.rateLimit.limitPerMinute}{' '}
          calls used in the last minute.
        </p>
      )}

      {preview.blockers.length > 0 && (
        <div className="space-y-1 rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          <p className="flex items-center gap-1 font-medium">
            <AlertTriangle className="h-3 w-3" aria-hidden />
            This would not run as-is
          </p>
          <ul className="list-inside list-disc">
            {preview.blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </div>
      )}

      {preview.unknowns.map((unknown) => (
        <p key={unknown} className="text-xs text-muted-foreground">
          Unknown until it runs: {unknown}
        </p>
      ))}
    </section>
  );
}
