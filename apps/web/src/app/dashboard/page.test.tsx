import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import DashboardPage from './page';

vi.mock('../../hooks/useCurrentUser', () => ({
  useCurrentUser: vi.fn(),
}));

vi.mock('../../lib/api/auth', () => ({
  resendVerificationEmail: vi.fn(),
}));

import { useCurrentUser } from '../../hooks/useCurrentUser';
import { resendVerificationEmail } from '../../lib/api/auth';

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a skeleton while the user is loading', () => {
    (useCurrentUser as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ data: undefined, isLoading: true });
    render(<DashboardPage />);
    expect(screen.queryByText(/welcome/i)).toBeNull();
  });

  it('greets the user by name once loaded, with no verification banner when verified', () => {
    (useCurrentUser as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { id: 'u1', email: 'ada@example.com', name: 'Ada', emailVerified: true },
      isLoading: false,
    });
    render(<DashboardPage />);

    expect(screen.getByText(/welcome, ada!/i)).toBeDefined();
    expect(screen.queryByText(/verify your email/i)).toBeNull();
  });

  it('shows a verification banner with a working resend button when unverified', async () => {
    (useCurrentUser as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { id: 'u1', email: 'ada@example.com', name: 'Ada', emailVerified: false },
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
});
