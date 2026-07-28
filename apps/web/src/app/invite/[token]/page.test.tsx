import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type React from 'react';
import InvitePage from './page';

const pushMock = vi.fn();

vi.mock('next/navigation', () => ({
  useParams: () => ({ token: 'tok123' }),
  useRouter: () => ({ push: pushMock }),
}));

vi.mock('../../../lib/api/invitations', () => ({
  previewInvitation: vi.fn(),
  acceptInvitation: vi.fn(),
}));

vi.mock('../../../lib/auth/token-storage', () => ({
  getAccessToken: vi.fn(),
}));

import { previewInvitation, acceptInvitation } from '../../../lib/api/invitations';
import { getAccessToken } from '../../../lib/auth/token-storage';

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('InvitePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows workspace + inviter details from a valid preview', async () => {
    (getAccessToken as unknown as ReturnType<typeof vi.fn>).mockReturnValue(null);
    (previewInvitation as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      workspaceName: 'Acme Inc',
      role: 'EDITOR',
      email: 'invitee@example.com',
      invitedBy: 'Ada',
    });

    renderWithClient(<InvitePage />);

    await waitFor(() => {
      expect(screen.getByText(/join acme inc/i)).toBeDefined();
      expect(screen.getAllByText(/invitee@example\.com/).length).toBeGreaterThan(0);
    });
  });

  it('prompts login/signup when not authenticated', async () => {
    (getAccessToken as unknown as ReturnType<typeof vi.fn>).mockReturnValue(null);
    (previewInvitation as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      workspaceName: 'Acme Inc',
      role: 'MEMBER',
      email: 'invitee@example.com',
      invitedBy: null,
    });

    renderWithClient(<InvitePage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /log in/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /sign up/i })).toBeDefined();
    });
  });

  it('accepts the invitation when authenticated and redirects to the dashboard', async () => {
    (getAccessToken as unknown as ReturnType<typeof vi.fn>).mockReturnValue('a-token');
    (previewInvitation as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      workspaceName: 'Acme Inc',
      role: 'MEMBER',
      email: 'invitee@example.com',
      invitedBy: 'Ada',
    });
    (acceptInvitation as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ workspaceId: 'w1' });
    const user = userEvent.setup();

    renderWithClient(<InvitePage />);
    await user.click(await screen.findByRole('button', { name: /accept invitation/i }));

    await waitFor(() => {
      expect(acceptInvitation).toHaveBeenCalledWith('tok123');
      expect(pushMock).toHaveBeenCalledWith('/dashboard');
    });
  });

  it('shows a not-found state for an invalid token', async () => {
    (getAccessToken as unknown as ReturnType<typeof vi.fn>).mockReturnValue(null);
    (previewInvitation as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('not found'));

    renderWithClient(<InvitePage />);

    await waitFor(() => {
      expect(screen.getByText(/invitation not found/i)).toBeDefined();
    });
  });
});
