/**
 * Conversation-folder client contract.
 *
 * These folders are a different table from the asset folders in
 * `./folders`, reached over a different route. A previous change
 * implemented conversation folders on top of `/folders`, which is the
 * asset-folder endpoint — so a folder created for a chat could never
 * hold an asset and vice versa. These tests pin each client to its own
 * URL so that cannot recur silently.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/lib/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/client')>('@/lib/api/client');
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } };
});

import { api } from '@/lib/api/client';
import {
  useConversationFolders,
  useCreateConversationFolder,
  useDeleteConversationFolder,
  useMoveConversationToFolder,
} from '../conversationFolders';
import { listFolders } from '../folders';

const mockApi = api as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  patch: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client }, children);
}

describe('conversation folders client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists root folders from the conversation-folders route', async () => {
    mockApi.get.mockResolvedValue([]);
    const { result } = renderHook(() => useConversationFolders('ws-1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApi.get).toHaveBeenCalledWith('/api/workspaces/ws-1/conversation-folders');
  });

  it('lists children when given a parent', async () => {
    mockApi.get.mockResolvedValue([]);
    const { result } = renderHook(() => useConversationFolders('ws-1', 'parent-1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApi.get).toHaveBeenCalledWith(
      '/api/workspaces/ws-1/conversation-folders?parentId=parent-1'
    );
  });

  it('creates a folder on the conversation-folders route', async () => {
    mockApi.post.mockResolvedValue({ id: 'f1' });
    const { result } = renderHook(() => useCreateConversationFolder('ws-1'), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ name: 'Research' });
    });

    expect(mockApi.post).toHaveBeenCalledWith('/api/workspaces/ws-1/conversation-folders', {
      name: 'Research',
    });
  });

  it('deletes by id', async () => {
    mockApi.delete.mockResolvedValue(undefined);
    const { result } = renderHook(() => useDeleteConversationFolder('ws-1'), { wrapper });

    await act(async () => {
      await result.current.mutateAsync('f1');
    });

    expect(mockApi.delete).toHaveBeenCalledWith('/api/workspaces/ws-1/conversation-folders/f1');
  });

  it('files a conversation into a folder', async () => {
    mockApi.post.mockResolvedValue(undefined);
    const { result } = renderHook(() => useMoveConversationToFolder('ws-1'), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ conversationId: 'c1', folderId: 'f1' });
    });

    expect(mockApi.post).toHaveBeenCalledWith('/api/workspaces/ws-1/conversation-folders/move', {
      conversationId: 'c1',
      folderId: 'f1',
    });
  });

  it('files a conversation out of every folder with null', async () => {
    mockApi.post.mockResolvedValue(undefined);
    const { result } = renderHook(() => useMoveConversationToFolder('ws-1'), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ conversationId: 'c1', folderId: null });
    });

    expect(mockApi.post).toHaveBeenCalledWith('/api/workspaces/ws-1/conversation-folders/move', {
      conversationId: 'c1',
      folderId: null,
    });
  });

  it('does not share a URL with the asset-folder client', async () => {
    mockApi.get.mockResolvedValue([]);
    await listFolders('ws-1', { projectId: 'p1' });

    expect(mockApi.get).toHaveBeenCalledWith('/api/workspaces/ws-1/folders?projectId=p1');
    expect(mockApi.get).not.toHaveBeenCalledWith(
      expect.stringContaining('conversation-folders')
    );
  });
});
