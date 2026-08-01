import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type React from 'react';

const replaceMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
  usePathname: () => '/dashboard/settings',
}));

vi.mock('../lib/api/account', () => ({
  getCurrentUser: vi.fn(),
}));

import { getCurrentUser } from '../lib/api/account';
import { useRequireAuth } from './useRequireAuth';

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useRequireAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('redirects to login when getCurrentUser fails (no valid auth)', async () => {
    (getCurrentUser as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('unauthorized'));

    renderHook(() => useRequireAuth(), { wrapper });

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith('/auth/login?next=%2Fdashboard%2Fsettings');
    });
  });

  it('does not redirect once the current user loads successfully', async () => {
    (getCurrentUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'u1',
      email: 'ada@example.com',
      name: 'Ada',
      image: null,
      role: 'USER',
      emailVerified: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      profile: null,
      preferences: { theme: 'DARK', emailNotifications: true, pushNotifications: false, marketingEmails: false },
    });

    const { result } = renderHook(() => useRequireAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.data?.email).toBe('ada@example.com');
    });
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
