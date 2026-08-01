'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  UseQueryResult,
  UseMutationResult,
} from '@tanstack/react-query';
import { api } from './client';

export interface Tool {
  id: string;
  workspaceId: string;
  name: string;
  displayName: string;
  description: string;
  category: string;
  type: 'HTTP' | 'GraphQL' | 'Database' | 'Search' | 'File' | 'Browser' | 'Python' | 'Webhook' | 'MCP' | 'Custom';
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  config: Record<string, unknown>;
  permission: 'PRIVATE' | 'WORKSPACE' | 'SHARED' | 'PUBLIC';
  maxParallelCalls?: number;
  rateLimit?: number;
  timeout?: number;
  maxRetries?: number;
  isAsync?: boolean;
  supportsStreaming?: boolean;
  requiresApproval?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ToolExecution {
  id: string;
  toolId: string;
  conversationId?: string;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
  status: 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'REQUIRES_APPROVAL' | 'REJECTED';
  approvedAt?: string;
  approvedBy?: string;
  rejectionReason?: string;
  rejectedAt?: string;
  rejectedBy?: string;
  createdAt: string;
  completedAt?: string;
}

export interface CreateToolInput {
  name: string;
  displayName: string;
  description: string;
  category: string;
  type: Tool['type'];
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  config: Record<string, unknown>;
  secrets?: string[];
  capabilities?: string[];
  permission?: Tool['permission'];
  maxParallelCalls?: number;
  rateLimit?: number;
  timeout?: number;
  maxRetries?: number;
  isAsync?: boolean;
  supportsStreaming?: boolean;
  requiresApproval?: boolean;
}

export interface UpdateToolInput {
  name?: string;
  displayName?: string;
  description?: string;
  category?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  config?: Record<string, unknown>;
  secrets?: string[];
  capabilities?: string[];
  permission?: Tool['permission'];
  maxParallelCalls?: number;
  rateLimit?: number;
  timeout?: number;
  maxRetries?: number;
  isAsync?: boolean;
  supportsStreaming?: boolean;
  requiresApproval?: boolean;
}

const TOOLS_KEY = 'tools';
const EXECUTIONS_KEY = 'executions';

/**
 * List tools in a workspace
 */
export function useWorkspaceTools(
  workspaceId: string,
  category?: string,
  options?: { enabled?: boolean }
): UseQueryResult<Tool[]> {
  return useQuery({
    queryKey: [TOOLS_KEY, workspaceId, category],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (category) params.append('category', category);

      const response = await api.get<{ items: Tool[] } | Tool[]>(
        `/api/workspaces/${workspaceId}/tools?${params.toString()}`
      );
      return Array.isArray(response) ? response : response.items || [];
    },
    enabled: !!workspaceId && options?.enabled !== false,
  });
}

/**
 * Get single tool
 */
export function useTool(
  workspaceId: string,
  toolId: string,
  options?: { enabled?: boolean }
): UseQueryResult<Tool> {
  return useQuery({
    queryKey: [TOOLS_KEY, 'tool', toolId],
    queryFn: async () => {
      return api.get<Tool>(
        `/api/workspaces/${workspaceId}/tools/${toolId}`
      );
    },
    enabled: !!workspaceId && !!toolId && options?.enabled !== false,
  });
}

/**
 * Create tool
 */
export function useCreateTool(
  workspaceId: string
): UseMutationResult<Tool, Error, CreateToolInput> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateToolInput) => {
      return api.post<Tool>(
        `/api/workspaces/${workspaceId}/tools`,
        input
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [TOOLS_KEY, workspaceId],
      });
    },
  });
}

/**
 * Update tool
 */
export function useUpdateTool(
  workspaceId: string,
  toolId: string
): UseMutationResult<Tool, Error, UpdateToolInput> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: UpdateToolInput) => {
      return api.patch<Tool>(
        `/api/workspaces/${workspaceId}/tools/${toolId}`,
        input
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [TOOLS_KEY, workspaceId],
      });
      queryClient.invalidateQueries({
        queryKey: [TOOLS_KEY, 'tool', toolId],
      });
    },
  });
}

/**
 * Delete tool
 */
export function useDeleteTool(
  workspaceId: string
): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (toolId: string) => {
      await api.delete(
        `/api/workspaces/${workspaceId}/tools/${toolId}`
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [TOOLS_KEY, workspaceId],
      });
    },
  });
}

/**
 * Execute tool
 */
export function useExecuteTool(
  workspaceId: string,
  toolId: string
): UseMutationResult<ToolExecution, Error, { input: Record<string, unknown>; conversationId?: string }> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { input: Record<string, unknown>; conversationId?: string }) => {
      return api.post<ToolExecution>(
        `/api/workspaces/${workspaceId}/tools/${toolId}/execute`,
        data
      );
    },
    onSuccess: (_, data) => {
      queryClient.invalidateQueries({
        queryKey: [EXECUTIONS_KEY, toolId],
      });
      if (data.conversationId) {
        queryClient.invalidateQueries({
          queryKey: [EXECUTIONS_KEY, 'conversation', data.conversationId],
        });
      }
    },
  });
}

/**
 * Get tool executions
 */
export function useToolExecutions(
  workspaceId: string,
  toolId: string,
  options?: { enabled?: boolean }
): UseQueryResult<ToolExecution[]> {
  return useQuery({
    queryKey: [EXECUTIONS_KEY, toolId],
    queryFn: async () => {
      const response = await api.get<{ items: ToolExecution[] } | ToolExecution[]>(
        `/api/workspaces/${workspaceId}/tools/${toolId}/executions`
      );
      return Array.isArray(response) ? response : response.items || [];
    },
    enabled: !!workspaceId && !!toolId && options?.enabled !== false,
  });
}

/**
 * Get single execution
 */
export function useToolExecution(
  workspaceId: string,
  executionId: string,
  options?: { enabled?: boolean }
): UseQueryResult<ToolExecution> {
  return useQuery({
    queryKey: [EXECUTIONS_KEY, 'execution', executionId],
    queryFn: async () => {
      return api.get<ToolExecution>(
        `/api/workspaces/${workspaceId}/executions/${executionId}`
      );
    },
    enabled: !!workspaceId && !!executionId && options?.enabled !== false,
  });
}

/**
 * Approve tool execution (if requiresApproval)
 */
export function useApproveExecution(
  workspaceId: string
): UseMutationResult<ToolExecution, Error, string> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (executionId: string) => {
      return api.post<ToolExecution>(
        `/api/workspaces/${workspaceId}/executions/${executionId}/approve`,
        {}
      );
    },
    onSuccess: (_data, executionId) => {
      queryClient.invalidateQueries({
        queryKey: [EXECUTIONS_KEY, 'execution', executionId],
      });
    },
  });
}

/**
 * Reject tool execution
 */
export function useRejectExecution(
  workspaceId: string
): UseMutationResult<ToolExecution, Error, { executionId: string; reason: string }> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ executionId, reason }: { executionId: string; reason: string }) => {
      return api.post<ToolExecution>(
        `/api/workspaces/${workspaceId}/executions/${executionId}/reject`,
        { reason }
      );
    },
    onSuccess: (_data, { executionId }) => {
      queryClient.invalidateQueries({
        queryKey: [EXECUTIONS_KEY, 'execution', executionId],
      });
    },
  });
}
