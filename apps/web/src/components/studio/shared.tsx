'use client';

import { AlertTriangle, Loader2 } from 'lucide-react';
import { Badge, cn } from '@synora/design-system';
import { isProviderUnavailable } from '@/hooks/useMedia';
import type { ContentStatus } from '@/lib/api/media';

/** Shared styling for the native selects the studio uses. */
export const selectClassName =
  'h-10 w-full rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

export function MediaStatusBadge({ status }: { status: ContentStatus }): React.JSX.Element {
  if (status === 'PROCESSING') {
    return (
      <Badge variant="secondary" className="gap-1">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
        Processing
      </Badge>
    );
  }
  if (status === 'FAILED') {
    return <Badge variant="destructive">Failed</Badge>;
  }
  if (status === 'DRAFT') {
    return <Badge variant="outline">Draft</Badge>;
  }
  return <Badge variant="secondary">Ready</Badge>;
}

/**
 * Renders a generation error. A 503 means this deployment simply has no
 * provider configured for the medium — an operator task, not something the
 * user can retry their way out of — so it reads differently from a genuine
 * failure. Saying "try again" for an unconfigured provider would be a lie.
 */
export function GenerationError({ error }: { error: unknown }): React.JSX.Element | null {
  if (!error) return null;

  const unavailable = isProviderUnavailable(error);
  const message = error instanceof Error ? error.message : 'Generation failed.';

  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-3 rounded-md border p-3 text-sm',
        unavailable
          ? 'border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200'
          : 'border-destructive/40 bg-destructive/10 text-destructive'
      )}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div>
        <p className="font-medium">
          {unavailable ? 'Not available on this deployment' : 'Generation failed'}
        </p>
        <p className="mt-0.5 opacity-90">{message}</p>
        {unavailable && (
          <p className="mt-1 opacity-75">
            An administrator needs to configure a provider before this can be used.
          </p>
        )}
      </div>
    </div>
  );
}

export function formatCreatedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
