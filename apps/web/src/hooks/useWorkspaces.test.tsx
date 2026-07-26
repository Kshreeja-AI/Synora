import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type React from 'react';
import { setTokens, clearTokens } from '../lib/auth/token-storage';

vi.mock('../lib/api/workspaces', () => ({
  listWorkspaces: vi.fn(),
}));

import { listWorkspaces } from '../lib/api/workspaces';
import { useWorkspaces } from './useWorkspaces';

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useWorkspaces', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearTokens();
  });

  it('never fires the query when there is no access token', () => {
    const { result } = renderHook(() => useWorkspaces(), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(listWorkspaces).not.toHaveBeenCalled();
  });

  it('fetches the workspace list when a token is present', async () => {
    setTokens({ accessToken: 'a', refreshToken: 'r' });
    (listWorkspaces as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'w1', name: 'Acme', slug: 'acme', role: 'OWNER' },
    ]);

    const { result } = renderHook(() => useWorkspaces(), { wrapper });

    await waitFor(() => {
      expect(result.current.data).toHaveLength(1);
    });
  });
});
