'use client';

import {
  useQuery,
  UseQueryResult,
} from '@tanstack/react-query';
import { api } from './client';

/**
 * Mirrors the backend ConversationUsage record (aggregate-only
 * accounting, one row per conversation). The route returns a zeroed
 * shape when no usage has been recorded yet, so `id`/timestamps are
 * optional.
 */
export interface ConversationUsage {
  id?: string;
  conversationId: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface UsageMetric {
  provider: string;
  model?: string;
  inputTokens: number;
  outputTokens: number;
  costCents: number;
  conversationCount?: number;
  percentOfTotal?: number;
}

export interface UsageSummary {
  totalConversations: number;
  totalMessages: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostCents: number;
  costByProvider: Record<string, number>;
  costByModel: Record<string, number>;
  topUsers?: Array<{ userId: string; costCents: number; conversationCount: number }>;
  topProviders: UsageMetric[];
  dateRange: {
    from: string;
    to: string;
  };
}

export interface UsageLedgerEntry {
  id: string;
  conversationId: string;
  providerId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costCents: number;
  createdAt: string;
}

export interface UsageLedger {
  items: UsageLedgerEntry[];
  total: number;
  hasMore: boolean;
}

const ANALYTICS_KEY = 'analytics';
const USAGE_KEY = 'usage';

/**
 * Get usage for a single conversation
 */
export function useConversationUsage(
  workspaceId: string,
  conversationId: string,
  options?: { enabled?: boolean }
): UseQueryResult<ConversationUsage> {
  return useQuery({
    queryKey: [USAGE_KEY, 'conversation', conversationId],
    queryFn: async () => {
      return api.get<ConversationUsage>(
        `/api/workspaces/${workspaceId}/conversations/${conversationId}/usage`
      );
    },
    enabled: !!workspaceId && !!conversationId && options?.enabled !== false,
  });
}

/**
 * Get usage summary for workspace
 */
export function useWorkspaceUsageSummary(
  workspaceId: string,
  dateRange?: { from: string; to: string },
  options?: { enabled?: boolean }
): UseQueryResult<UsageSummary> {
  return useQuery({
    queryKey: [ANALYTICS_KEY, 'summary', workspaceId, dateRange?.from, dateRange?.to],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (dateRange?.from) params.append('from', dateRange.from);
      if (dateRange?.to) params.append('to', dateRange.to);

      const queryString = params.toString();
      const url = queryString
        ? `/api/workspaces/${workspaceId}/usage/summary?${queryString}`
        : `/api/workspaces/${workspaceId}/usage/summary`;

      return api.get<UsageSummary>(url);
    },
    enabled: !!workspaceId && options?.enabled !== false,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Get detailed usage ledger
 */
export function useWorkspaceUsageLedger(
  workspaceId: string,
  options?: {
    skip?: number;
    take?: number;
    from?: string;
    to?: string;
    enabled?: boolean;
  }
): UseQueryResult<UsageLedger> {
  return useQuery({
    queryKey: [ANALYTICS_KEY, 'ledger', workspaceId, options?.skip, options?.from, options?.to],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (options?.skip !== undefined) params.append('skip', String(options.skip));
      if (options?.take !== undefined) params.append('take', String(options.take));
      if (options?.from) params.append('from', options.from);
      if (options?.to) params.append('to', options.to);

      const queryString = params.toString();
      const url = queryString
        ? `/api/workspaces/${workspaceId}/usage/ledger?${queryString}`
        : `/api/workspaces/${workspaceId}/usage/ledger`;

      const response = await api.get<UsageLedger | UsageLedgerEntry[]>(url);
      if (Array.isArray(response)) {
        return {
          items: response,
          total: response.length,
          hasMore: false,
        };
      }
      return response;
    },
    enabled: !!workspaceId && options?.enabled !== false,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Export usage as CSV
 */
export async function exportUsageCSV(
  workspaceId: string,
  options?: {
    from?: string;
    to?: string;
  }
): Promise<Blob> {
  const params = new URLSearchParams();
  if (options?.from) params.append('from', options.from);
  if (options?.to) params.append('to', options.to);

  const queryString = params.toString();
  const url = queryString
    ? `/api/workspaces/${workspaceId}/usage/export/csv?${queryString}`
    : `/api/workspaces/${workspaceId}/usage/export/csv`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${typeof window !== 'undefined' ? localStorage.getItem('token') || '' : ''}`,
    },
  });

  if (!response.ok) {
    throw new Error('Failed to export usage data');
  }

  return response.blob();
}

/**
 * Helper function to format cost in dollars
 */
export function formatCost(costCents: number): string {
  return `$${(costCents / 100).toFixed(4)}`;
}

/**
 * Helper function to calculate percentage
 */
export function getPercentage(value: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((value / total) * 100);
}

/**
 * Helper function to format token count
 */
export function formatTokens(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`;
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1)}K`;
  }
  return String(count);
}
