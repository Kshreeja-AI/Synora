import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import DashboardPage from './page';
import { useCreateWorkspaceStore } from '../../stores/create-workspace-store';

vi.mock('../../hooks/useCurrentUser', () => ({
  useCurrentUser: vi.fn(),
}));

vi.mock('../../hooks/useCurrentWorkspace', () => ({
  useCurrentWorkspace: vi.fn(),
}));

vi.mock('../../lib/api/auth', () => ({
  resendVerificationEmail: vi.fn(),
}));

import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useCurrentWorkspace } from '../../hooks/useCurrentWorkspace';
import { resendVerificationEmail } from '../../lib/api/auth';

const AUTHENTICATED_USER = { id: 'u1', email: 'ada@example.com', name: 'Ada', emailVerified: true };

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCreateWorkspaceStore.setState({ isOpen: false });
  });

  it('shows a skeleton while the user or workspace is loading', () => {
    (useCurrentUser as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ data: undefined, isLoading: true });
    (useCurrentWorkspace as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      currentWorkspace: null,
      isLoading: true,
    });
    render(<DashboardPage />);
    expect(screen.queryByText(/welcome/i)).toBeNull();
  });

  it('greets the user by name once loaded, with no verification banner when verified', () => {
    (useCurrentUser as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ data: AUTHENTICATED_USER, isLoading: false });
    (useCurrentWorkspace as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      currentWorkspace: null,
      isLoading: false,
    });
    render(<DashboardPage />);

    expect(screen.getByText(/welcome, ada!/i)).toBeDefined();
    expect(screen.queryByText(/verify your email/i)).toBeNull();
  });

  it('shows a verification banner with a working resend button when unverified', async () => {
    (useCurrentUser as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { ...AUTHENTICATED_USER, emailVerified: false },
      isLoading: false,
    });
    (useCurrentWorkspace as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      currentWorkspace: null,
      isLoading: false,
    });
    (resendVerificationEmail as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ message: 'ok' });
    render(<DashboardPage />);

    expect(screen.getByText(/verify your email/i)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /resend verification email/i }));

    await waitFor(() => {
      expect(resendVerificationEmail).toHaveBeenCalled();
      expect(screen.getByText(/verification email sent/i)).toBeDefined();
    });
  });

  it('shows an empty state with a create-workspace action when the user has no workspace', () => {
    (useCurrentUser as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ data: AUTHENTICATED_USER, isLoading: false });
    (useCurrentWorkspace as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      currentWorkspace: null,
      isLoading: false,
    });
    render(<DashboardPage />);

    expect(screen.getByText(/create your first workspace/i)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /create workspace/i }));
    expect(useCreateWorkspaceStore.getState().isOpen).toBe(true);
  });

  it('shows a real workspace overview when the user has a workspace', () => {
    (useCurrentUser as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ data: AUTHENTICATED_USER, isLoading: false });
    (useCurrentWorkspace as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      currentWorkspace: {
        id: 'w1',
        name: 'Acme Inc',
        slug: 'acme-inc',
        role: 'OWNER',
        memberCount: 3,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      isLoading: false,
    });
    render(<DashboardPage />);

    expect(screen.getByText('Acme Inc')).toBeDefined();
    expect(screen.getByText('/acme-inc')).toBeDefined();
    expect(screen.getByText('3')).toBeDefined();
    expect(screen.getByText('OWNER')).toBeDefined();
    expect(screen.queryByText(/create your first workspace/i)).toBeNull();
  });
});
