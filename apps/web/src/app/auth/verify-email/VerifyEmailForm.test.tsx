import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

let searchParamsValue = new URLSearchParams('token=raw-verify-token');
vi.mock('next/navigation', () => ({
  useSearchParams: () => searchParamsValue,
}));

vi.mock('../../../lib/api/auth', () => ({
  verifyEmail: vi.fn(),
  resendVerificationEmail: vi.fn(),
}));

import { verifyEmail, resendVerificationEmail } from '../../../lib/api/auth';
import { ApiError } from '../../../lib/api/client';
import { VerifyEmailForm } from './VerifyEmailForm';

describe('VerifyEmailForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchParamsValue = new URLSearchParams('token=raw-verify-token');
  });

  it('shows a verifying state, then success once the token is confirmed', async () => {
    (verifyEmail as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ message: 'ok' });
    render(<VerifyEmailForm />);

    expect(screen.getByText(/verifying your email/i)).toBeDefined();

    await waitFor(() => {
      expect(verifyEmail).toHaveBeenCalledWith('raw-verify-token');
      expect(screen.getByText(/email verified/i)).toBeDefined();
    });
  });

  it('shows an error state with the backend message when the token is rejected', async () => {
    (verifyEmail as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError(401, { message: 'Invalid or expired verification token' })
    );
    render(<VerifyEmailForm />);

    await waitFor(() => {
      expect(screen.getByText(/verification failed/i)).toBeDefined();
      expect(screen.getByText('Invalid or expired verification token')).toBeDefined();
    });
  });

  it('shows an error state immediately when there is no token', () => {
    searchParamsValue = new URLSearchParams();
    render(<VerifyEmailForm />);
    expect(screen.getByText(/verification failed/i)).toBeDefined();
  });

  it('lets the user resend a verification email from the error state', async () => {
    searchParamsValue = new URLSearchParams();
    (resendVerificationEmail as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ message: 'ok' });
    render(<VerifyEmailForm />);

    fireEvent.click(screen.getByRole('button', { name: /resend verification email/i }));

    await waitFor(() => {
      expect(resendVerificationEmail).toHaveBeenCalled();
      expect(screen.getByText(/new verification email has been sent/i)).toBeDefined();
    });
  });
});
