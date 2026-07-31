import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useConversations,
  useConversation,
  useCreateConversation,
  useUpdateConversation,
  useDeleteConversation,
  useArchiveConversation,
  useRestoreConversation,
  useSearchConversations,
} from '../conversations';
import { api } from '../client';

vi.mock('../client');

const mockApi = vi.mocked(api);

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return ({ children }: { children: React.ReactNode }): React.ReactElement => (
    React.createElement(QueryClientProvider, { client: queryClient }, children)
  );
};

const mockConversation = {
  id: 'conv-1',
  workspaceId: 'ws-1',
  title: 'Test Conversation',
  description: 'Test Description',
  isArchived: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe('Conversations API Hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('useConversations', () => {
    it('should fetch conversations list', async () => {
      const mockResponse = {
        items: [mockConversation],
        total: 1,
        hasMore: false,
      };
      mockApi.get.mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useConversations('ws-1'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isPending).toBe(false);
      });

      expect(result.current.data).toBeDefined();
    });

    it('should respect enabled option', () => {
      const { result } = renderHook(() => useConversations('ws-1', { enabled: false }), {
        wrapper: createWrapper(),
      });

      expect(mockApi.get).not.toHaveBeenCalled();
    });

    it('should not fetch if workspaceId is empty', () => {
      renderHook(() => useConversations(''), {
        wrapper: createWrapper(),
      });

      expect(mockApi.get).not.toHaveBeenCalled();
    });
  });

  describe('useConversation', () => {
    it('should fetch single conversation', async () => {
      mockApi.get.mockResolvedValue(mockConversation);

      const { result } = renderHook(() => useConversation('ws-1', 'conv-1'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isPending).toBe(false);
      });

      expect(result.current.data).toEqual(mockConversation);
      expect(mockApi.get).toHaveBeenCalledWith('/api/workspaces/ws-1/conversations/conv-1');
    });

    it('should not fetch if conversationId is missing', () => {
      renderHook(() => useConversation('ws-1', ''), {
        wrapper: createWrapper(),
      });

      expect(mockApi.get).not.toHaveBeenCalled();
    });

    it('should respect enabled option', () => {
      const { result } = renderHook(() => useConversation('ws-1', 'conv-1', { enabled: false }), {
        wrapper: createWrapper(),
      });

      expect(mockApi.get).not.toHaveBeenCalled();
    });
  });

  describe('useCreateConversation', () => {
    it('should create conversation', async () => {
      mockApi.post.mockResolvedValue(mockConversation);

      const { result } = renderHook(() => useCreateConversation('ws-1'), {
        wrapper: createWrapper(),
      });

      result.current.mutate({
        title: 'New Conversation',
      });

      await waitFor(() => {
        expect(result.current.isPending).toBe(false);
      });

      expect(mockApi.post).toHaveBeenCalledWith(
        '/api/workspaces/ws-1/conversations',
        { title: 'New Conversation' }
      );
      expect(result.current.data).toEqual(mockConversation);
    });

    it('should handle creation error', async () => {
      const error = new Error('Creation failed');
      mockApi.post.mockRejectedValue(error);

      const { result } = renderHook(() => useCreateConversation('ws-1'), {
        wrapper: createWrapper(),
      });

      result.current.mutate({ title: 'New Conversation' });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });
    });
  });

  describe('useUpdateConversation', () => {
    it('should update conversation', async () => {
      const updated = { ...mockConversation, title: 'Updated Title' };
      mockApi.patch.mockResolvedValue(updated);

      const { result } = renderHook(() => useUpdateConversation('ws-1', 'conv-1'), {
        wrapper: createWrapper(),
      });

      result.current.mutate({ title: 'Updated Title' });

      await waitFor(() => {
        expect(result.current.isPending).toBe(false);
      });

      expect(mockApi.patch).toHaveBeenCalledWith(
        '/api/workspaces/ws-1/conversations/conv-1',
        { title: 'Updated Title' }
      );
    });
  });

  describe('useDeleteConversation', () => {
    it('should delete conversation', async () => {
      mockApi.delete.mockResolvedValue(undefined);

      const { result } = renderHook(() => useDeleteConversation('ws-1', 'conv-1'), {
        wrapper: createWrapper(),
      });

      result.current.mutate();

      await waitFor(() => {
        expect(result.current.isPending).toBe(false);
      });

      expect(mockApi.delete).toHaveBeenCalledWith('/api/workspaces/ws-1/conversations/conv-1');
    });
  });

  describe('useArchiveConversation', () => {
    it('should archive conversation', async () => {
      const archived = { ...mockConversation, isArchived: true };
      mockApi.patch.mockResolvedValue(archived);

      const { result } = renderHook(() => useArchiveConversation('ws-1', 'conv-1'), {
        wrapper: createWrapper(),
      });

      result.current.mutate();

      await waitFor(() => {
        expect(result.current.isPending).toBe(false);
      });

      expect(mockApi.patch).toHaveBeenCalledWith(
        '/api/workspaces/ws-1/conversations/conv-1',
        { isArchived: true }
      );
    });
  });

  describe('useRestoreConversation', () => {
    it('should restore conversation', async () => {
      const restored = { ...mockConversation, isArchived: false };
      mockApi.patch.mockResolvedValue(restored);

      const { result } = renderHook(() => useRestoreConversation('ws-1', 'conv-1'), {
        wrapper: createWrapper(),
      });

      result.current.mutate();

      await waitFor(() => {
        expect(result.current.isPending).toBe(false);
      });

      expect(mockApi.patch).toHaveBeenCalledWith(
        '/api/workspaces/ws-1/conversations/conv-1',
        { isArchived: false }
      );
    });
  });

  describe('useSearchConversations', () => {
    it('should search conversations', async () => {
      const mockResponse = {
        items: [mockConversation],
        total: 1,
      };
      mockApi.get.mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useSearchConversations('ws-1', 'test'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isPending).toBe(false);
      });

      expect(mockApi.get).toHaveBeenCalledWith(
        '/api/workspaces/ws-1/conversations?search=test&take=20'
      );
    });

    it('should not search with empty query', () => {
      renderHook(() => useSearchConversations('ws-1', ''), {
        wrapper: createWrapper(),
      });

      expect(mockApi.get).not.toHaveBeenCalled();
    });
  });
});
