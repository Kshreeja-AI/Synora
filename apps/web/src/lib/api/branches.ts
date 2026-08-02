/**
 * Branch API client.
 *
 * The backend models branching as sibling `Message` records under a
 * shared `parentId`. `MessageBranch` is a per-message record carrying
 * `branchIndex` and `isMainBranch`; it exists only for messages that
 * actually participate in a fork. The endpoints are:
 *
 *   POST   /branches                 → create a sibling under parentId
 *   GET    /branches?parentId=X      → list siblings at a fork
 *   POST   /branches/set-main        → mark a sibling as the canonical
 *                                       continuation of its parent
 *   DELETE /branches/:messageId      → delete a non-main sibling
 *   GET    /tree                     → full conversation DAG
 *
 * These hooks are the only sanctioned client surface for that shape —
 * do not mint your own fetch calls against /branches from components.
 */

'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  UseQueryResult,
  UseMutationResult,
} from '@tanstack/react-query';
import { api } from './client';
import type { ConversationMessage } from './messages';

const BRANCH_SIBLINGS_KEY = 'branch-siblings';
const MESSAGES_KEY = 'messages';

export interface CreateBranchInput {
  parentId: string;
  content?: string;
}

export interface MessageBranchRecord {
  id: string;
  messageId: string;
  branchIndex: number;
  isMainBranch: boolean;
}

/**
 * List the sibling messages at a given fork. Returns each sibling as a
 * `ConversationMessage` so the UI can preview alternatives without a
 * second fetch. Disabled when `parentId` is falsy, so it's safe to pass
 * `undefined` for a message that has no siblings.
 */
export function useSiblingBranches(
  workspaceId: string,
  conversationId: string,
  parentId: string | undefined,
  options?: { enabled?: boolean }
): UseQueryResult<ConversationMessage[]> {
  return useQuery({
    queryKey: [BRANCH_SIBLINGS_KEY, conversationId, parentId],
    queryFn: async () => {
      const qs = new URLSearchParams({ parentId: parentId! }).toString();
      const response = await api.get<{ branches: ConversationMessage[]; total: number }>(
        `/api/workspaces/${workspaceId}/conversations/${conversationId}/branches?${qs}`
      );
      return response.branches;
    },
    enabled:
      !!workspaceId && !!conversationId && !!parentId && options?.enabled !== false,
  });
}

/**
 * Create a new sibling message under `parentId`. Currently used to
 * fork an alternative assistant response — the caller passes the
 * assistant message's parent (the user turn) as `parentId`, and the
 * backend creates a new empty assistant sibling that generation can
 * then stream into.
 */
export function useCreateBranch(
  workspaceId: string,
  conversationId: string
): UseMutationResult<ConversationMessage, Error, CreateBranchInput> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateBranchInput) =>
      api.post<ConversationMessage>(
        `/api/workspaces/${workspaceId}/conversations/${conversationId}/branches`,
        input
      ),
    onSuccess: (_created, input) => {
      queryClient.invalidateQueries({
        queryKey: [BRANCH_SIBLINGS_KEY, conversationId, input.parentId],
      });
      queryClient.invalidateQueries({ queryKey: [MESSAGES_KEY, conversationId] });
    },
  });
}

/**
 * Mark a given message as the canonical continuation of its parent —
 * this is what "switch to that alternative" means to the linearizer.
 * Invalidates both the fork's sibling list *and* the linearized
 * message list, since the canonical path has changed.
 */
export function useSetMainBranch(
  workspaceId: string,
  conversationId: string
): UseMutationResult<MessageBranchRecord, Error, { messageId: string; parentId?: string }> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ messageId }) =>
      api.post<MessageBranchRecord>(
        `/api/workspaces/${workspaceId}/conversations/${conversationId}/branches/set-main`,
        { messageId }
      ),
    onSuccess: (_result, { parentId }) => {
      if (parentId) {
        queryClient.invalidateQueries({
          queryKey: [BRANCH_SIBLINGS_KEY, conversationId, parentId],
        });
      }
      queryClient.invalidateQueries({ queryKey: [MESSAGES_KEY, conversationId] });
    },
  });
}

/**
 * Delete a non-main sibling. The backend rejects deleting the main
 * branch (throws 403), so components must gate the button.
 */
export function useDeleteBranch(
  workspaceId: string,
  conversationId: string
): UseMutationResult<void, Error, { messageId: string; parentId?: string }> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ messageId }) =>
      api.delete<void>(
        `/api/workspaces/${workspaceId}/conversations/${conversationId}/branches/${messageId}`
      ),
    onSuccess: (_result, { parentId }) => {
      if (parentId) {
        queryClient.invalidateQueries({
          queryKey: [BRANCH_SIBLINGS_KEY, conversationId, parentId],
        });
      }
      queryClient.invalidateQueries({ queryKey: [MESSAGES_KEY, conversationId] });
    },
  });
}
