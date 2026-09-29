/**
 * Per-message fork indicator.
 *
 * When a message is one of N siblings (an alternative response at a
 * given fork), this renders `< 2 / 3 >` prev/next arrows so the user
 * can page through alternatives. Clicking an arrow POSTs `set-main`
 * for the neighbor sibling — that flips the canonical path and the
 * linearized message list re-fetches to reflect it.
 *
 * Deliberately silent when a message has no siblings, so it can be
 * mounted unconditionally under every assistant message.
 */

'use client';

import { useCallback, useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  useSiblingBranches,
  useSetMainBranch,
} from '@/lib/api/branches';

interface ForkNavigatorProps {
  workspaceId: string;
  conversationId: string;
  /** The currently-visible message at this fork. */
  messageId: string;
  /** The parent message that this fork lives under. */
  parentId: string | null | undefined;
  /**
   * Sibling metadata already attached to the message by the backend
   * linearizer. When `siblingCount <= 1` the component renders nothing
   * without fetching, so this is safe to mount for every message.
   */
  siblingIndex: number | undefined;
  siblingCount: number | undefined;
}

export function ForkNavigator({
  workspaceId,
  conversationId,
  messageId,
  parentId,
  siblingIndex,
  siblingCount,
}: ForkNavigatorProps) {
  const hasSiblings = (siblingCount ?? 1) > 1;

  // Only fetch the sibling list when the user is actually looking at a
  // fork — an unbranched conversation should never hit /branches.
  const {
    data: siblings,
    isFetching,
  } = useSiblingBranches(workspaceId, conversationId, parentId ?? undefined, {
    enabled: hasSiblings && !!parentId,
  });

  const setMain = useSetMainBranch(workspaceId, conversationId);

  const currentIndex = useMemo(() => {
    // Prefer the freshly-fetched sibling list (it may include a
    // just-created branch); fall back to the linearizer's snapshot.
    if (siblings && siblings.length > 0) {
      const idx = siblings.findIndex((s) => s.id === messageId);
      if (idx >= 0) return idx;
    }
    return siblingIndex ?? 0;
  }, [siblings, messageId, siblingIndex]);

  const total = siblings?.length ?? siblingCount ?? 1;

  const canGoPrev = currentIndex > 0;
  const canGoNext = currentIndex < total - 1;

  const goTo = useCallback(
    (index: number) => {
      const target = siblings?.[index];
      if (!target || !parentId) return;
      setMain.mutate({ messageId: target.id, parentId });
    },
    [siblings, parentId, setMain]
  );

  if (!hasSiblings || !parentId) return null;

  const disabled = setMain.isPending || isFetching;

  return (
    <div
      className="flex items-center gap-1 text-xs text-muted-foreground"
      role="group"
      aria-label={`Alternative response ${currentIndex + 1} of ${total}`}
    >
      <button
        type="button"
        onClick={() => goTo(currentIndex - 1)}
        disabled={!canGoPrev || disabled}
        aria-label="Previous alternative"
        className="rounded p-0.5 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
      >
        <ChevronLeft className="h-3 w-3" />
      </button>
      <span className="tabular-nums" aria-hidden>
        {currentIndex + 1} / {total}
      </span>
      <button
        type="button"
        onClick={() => goTo(currentIndex + 1)}
        disabled={!canGoNext || disabled}
        aria-label="Next alternative"
        className="rounded p-0.5 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
      >
        <ChevronRight className="h-3 w-3" />
      </button>
    </div>
  );
}
