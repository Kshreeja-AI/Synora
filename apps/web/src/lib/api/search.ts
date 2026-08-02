'use client';

import { useQuery, UseQueryResult } from '@tanstack/react-query';
import { api } from './client';

export interface SearchResult {
  id: string;
  type: 'conversation' | 'message';
  title?: string;
  content?: string;
  snippet?: string;
  conversationId?: string;
  createdAt: string;
  relevance: number;
}

export interface SearchResponse {
  items: SearchResult[];
  total: number;
  hasMore: boolean;
}

const SEARCH_KEY = 'search';

/**
 * Search conversations by title and description (full-text search)
 */
export function useSearchConversations(
  workspaceId: string,
  query: string,
  options?: {
    skip?: number;
    take?: number;
    enabled?: boolean;
  }
): UseQueryResult<SearchResponse> {
  return useQuery({
    queryKey: [SEARCH_KEY, 'conversations', workspaceId, query, options?.skip || 0],
    queryFn: async () => {
      if (!query.trim()) {
        return { items: [], total: 0, hasMore: false };
      }

      const params = new URLSearchParams();
      params.append('q', query);
      if (options?.skip !== undefined) params.append('skip', String(options.skip));
      if (options?.take !== undefined) params.append('take', String(options.take));

      const response = await api.get<SearchResponse>(
        `/api/workspaces/${workspaceId}/search?${params.toString()}`
      );

      return {
        ...response,
        hasMore: (response.items?.length || 0) > 0,
      };
    },
    enabled:
      !!workspaceId && !!query?.trim() && options?.enabled !== false,
    staleTime: 30000, // 30 seconds
  });
}

/**
 * Search messages within conversations (full-text search on content)
 */
export function useSearchMessages(
  workspaceId: string,
  query: string,
  options?: {
    skip?: number;
    take?: number;
    enabled?: boolean;
  }
): UseQueryResult<SearchResponse> {
  return useQuery({
    queryKey: [SEARCH_KEY, 'messages', workspaceId, query, options?.skip || 0],
    queryFn: async () => {
      if (!query.trim()) {
        return { items: [], total: 0, hasMore: false };
      }

      const params = new URLSearchParams();
      params.append('q', query);
      if (options?.skip !== undefined) params.append('skip', String(options.skip));
      if (options?.take !== undefined) params.append('take', String(options.take));

      const response = await api.get<SearchResponse>(
        `/api/workspaces/${workspaceId}/search/messages?${params.toString()}`
      );

      return {
        ...response,
        hasMore: (response.items?.length || 0) > 0,
      };
    },
    enabled:
      !!workspaceId && !!query?.trim() && options?.enabled !== false,
    staleTime: 30000,
  });
}

/**
 * Index a conversation and its messages for search
 */
export async function indexConversation(
  workspaceId: string,
  conversationId: string
): Promise<{
  success: boolean;
  conversationId: string;
  messagesIndexed: number;
}> {
  return api.post(
    `/api/workspaces/${workspaceId}/search/index/${conversationId}`,
    {}
  );
}
