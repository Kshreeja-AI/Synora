/**
 * Thumbs-up / thumbs-down + report affordance for a single
 * assistant message. Fetches the current user's existing feedback
 * via `useMyMessageFeedback` and reflects it in the button state
 * (filled thumb = your active vote). Clicking a thumb submits an
 * upsert; the mutation itself is fire-and-forget with a toast on
 * error — the optimistic UI is driven by immediately setting
 * `activeVote` and reverting on error.
 *
 * The "Report" button opens `ReportProblemDialog` for correction /
 * hallucination submission — that flow currently owns its own
 * imperative flow (no optimistic UI) because it's a rare action.
 */

'use client';

import { useCallback, useState } from 'react';
import { ThumbsUp, ThumbsDown, Flag } from 'lucide-react';
import { toast } from 'sonner';
import { useMutation } from '@tanstack/react-query';
import {
  feedbackApi,
  type MessageFeedbackRecord,
} from '@/lib/api/feedback';
import {
  useMyMessageFeedback,
  useInvalidateMyMessageFeedback,
} from '@/hooks/useMyMessageFeedback';
import { ReportProblemDialog } from './ReportProblemDialog';

type Vote = 'up' | 'down' | null;

function voteOf(record?: MessageFeedbackRecord): Vote {
  if (!record) return null;
  if (record.thumbsUp || record.isHelpful === true) return 'up';
  if (record.thumbsDown || record.isHelpful === false) return 'down';
  return null;
}

interface FeedbackControlsProps {
  workspaceId: string;
  conversationId: string;
  messageId: string;
  /** Assistant message content — needed to pre-fill the correction dialog. */
  messageContent: string;
}

export function FeedbackControls({
  workspaceId,
  conversationId,
  messageId,
  messageContent,
}: FeedbackControlsProps) {
  const { byMessageId } = useMyMessageFeedback(workspaceId, conversationId);
  const invalidate = useInvalidateMyMessageFeedback();

  const persisted = voteOf(byMessageId.get(messageId));
  // Local vote state overrides the fetched state during optimistic
  // updates; falls back to what the server told us once the mutation
  // settles and the cache is invalidated.
  const [optimistic, setOptimistic] = useState<Vote>(persisted);
  const activeVote: Vote = optimistic ?? persisted;

  const [reportOpen, setReportOpen] = useState(false);

  const submit = useMutation({
    mutationFn: (vote: 'up' | 'down') =>
      feedbackApi.createMessageFeedback(workspaceId, {
        messageId,
        conversationId,
        feedbackType: vote === 'up' ? 'HELPFUL' : 'UNHELPFUL',
        isHelpful: vote === 'up',
        thumbsUp: vote === 'up',
        thumbsDown: vote === 'down',
      }),
    onError: (err, vote) => {
      // Revert to whatever the server last confirmed.
      setOptimistic(persisted);
      toast.error(
        err instanceof Error
          ? `Couldn't record your feedback: ${err.message}`
          : `Couldn't record your ${vote === 'up' ? 'thumbs up' : 'thumbs down'}`
      );
    },
    onSuccess: () => {
      invalidate(workspaceId, conversationId);
    },
  });

  const handleVote = useCallback(
    (vote: 'up' | 'down') => {
      setOptimistic(vote);
      submit.mutate(vote);
    },
    [submit]
  );

  return (
    <>
      <button
        type="button"
        onClick={() => handleVote('up')}
        disabled={submit.isPending}
        aria-label="Thumbs up"
        aria-pressed={activeVote === 'up'}
        className={`flex items-center gap-1 rounded px-1.5 py-0.5 transition ${
          activeVote === 'up'
            ? 'bg-green-500/10 text-green-600 dark:text-green-400'
            : 'hover:bg-muted hover:text-foreground'
        }`}
      >
        <ThumbsUp className="h-3 w-3" />
      </button>

      <button
        type="button"
        onClick={() => handleVote('down')}
        disabled={submit.isPending}
        aria-label="Thumbs down"
        aria-pressed={activeVote === 'down'}
        className={`flex items-center gap-1 rounded px-1.5 py-0.5 transition ${
          activeVote === 'down'
            ? 'bg-red-500/10 text-red-600 dark:text-red-400'
            : 'hover:bg-muted hover:text-foreground'
        }`}
      >
        <ThumbsDown className="h-3 w-3" />
      </button>

      <button
        type="button"
        onClick={() => setReportOpen(true)}
        aria-label="Report a problem with this response"
        className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-muted hover:text-foreground transition"
      >
        <Flag className="h-3 w-3" />
      </button>

      <ReportProblemDialog
        open={reportOpen}
        onOpenChange={setReportOpen}
        workspaceId={workspaceId}
        conversationId={conversationId}
        messageId={messageId}
        messageContent={messageContent}
      />
    </>
  );
}
