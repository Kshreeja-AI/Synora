import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type React from 'react';
import { setTokens, clearTokens } from '../lib/auth/token-storage';
import { useWorkspaceStore } from '../stores/workspace-store';

vi.mock('../lib/api/workspaces', () => ({
  listWorkspaces: vi.fn(),
}));

import { listWorkspaces } from '../lib/api/workspaces';
import { useCurrentWorkspace } from './useCurrentWorkspace';

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useCurrentWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearTokens();
    useWorkspaceStore.setState({ currentWorkspaceId: null });
  });

  it('returns null and an empty list before any workspaces load', () => {
    const { result } = renderHook(() => useCurrentWorkspace(), { wrapper });
    expect(result.current.currentWorkspace).toBeNull();
    expect(result.current.workspaces).toEqual([]);
  });

  it('falls back to the first workspace and persists the choice', async () => {
    setTokens({ accessToken: 'a', refreshToken: 'r' });
    (listWorkspaces as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'w1', name: 'Acme', slug: 'acme', role: 'OWNER' },
      { id: 'w2', name: 'Beta', slug: 'beta', role: 'MEMBER' },
    ]);

    const { result } = renderHook(() => useCurrentWorkspace(), { wrapper });

    await waitFor(() => {
      expect(result.current.currentWorkspace?.id).toBe('w1');
    });
    expect(useWorkspaceStore.getState().currentWorkspaceId).toBe('w1');
  });

  it('honors a previously persisted workspace id when it still exists', async () => {
    setTokens({ accessToken: 'a', refreshToken: 'r' });
    useWorkspaceStore.setState({ currentWorkspaceId: 'w2' });
    (listWorkspaces as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'w1', name: 'Acme', slug: 'acme', role: 'OWNER' },
      { id: 'w2', name: 'Beta', slug: 'beta', role: 'MEMBER' },
    ]);

    const { result } = renderHook(() => useCurrentWorkspace(), { wrapper });

    await waitFor(() => {
      expect(result.current.currentWorkspace?.id).toBe('w2');
    });
  });
});
