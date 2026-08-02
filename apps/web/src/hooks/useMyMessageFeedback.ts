'use client';

import { useMemo } from 'react';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { feedbackApi, type MessageFeedbackRecord } from '@/lib/api/feedback';

const MY_FEEDBACK_KEY = 'feedback-mine';

/**
 * The current user's feedback records for every message in a
 * conversation, keyed by messageId for O(1) lookup by consumers.
 *
 * One fetch per conversation, cached under a stable query key so
 * mutation hooks can invalidate it after a submission. This is what
 * powers the "you already thumbed this up" reflection in
 * `FeedbackControls` — without it, page reloads would lose the
 * visible state of user feedback until the next mutation ran.
 */
export function useMyMessageFeedback(
  workspaceId: string,
  conversationId: string,
  options?: { enabled?: boolean }
): UseQueryResult<MessageFeedbackRecord[]> & {
  byMessageId: Map<string, MessageFeedbackRecord>;
} {
  const query = useQuery({
    queryKey: [MY_FEEDBACK_KEY, workspaceId, conversationId],
    queryFn: async () => {
      const response = await feedbackApi.listMyMessageFeedback(workspaceId, conversationId);
      return response.items;
    },
    enabled: !!workspaceId && !!conversationId && options?.enabled !== false,
  });

  const byMessageId = useMemo(() => {
    const map = new Map<string, MessageFeedbackRecord>();
    for (const record of query.data ?? []) {
      // The backend orders newest-first — first write wins so we keep
      // the most recent record when duplicates ever appear.
      if (!map.has(record.messageId)) {
        map.set(record.messageId, record);
      }
    }
    return map;
  }, [query.data]);

  return Object.assign(query, { byMessageId });
}

/**
 * Invalidate the my-feedback cache for a conversation. Call this
 * after a successful feedback mutation so a subsequent re-render
 * reflects the fresh state.
 */
export function useInvalidateMyMessageFeedback(): (
  workspaceId: string,
  conversationId: string
) => void {
  const queryClient = useQueryClient();
  return (workspaceId, conversationId) => {
    queryClient.invalidateQueries({
      queryKey: [MY_FEEDBACK_KEY, workspaceId, conversationId],
    });
  };
}
