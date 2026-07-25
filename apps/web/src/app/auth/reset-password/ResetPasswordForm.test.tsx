import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

let searchParamsValue = new URLSearchParams('token=raw-reset-token');
vi.mock('next/navigation', () => ({
  useSearchParams: () => searchParamsValue,
}));

vi.mock('../../../lib/api/auth', () => ({
  resetPassword: vi.fn(),
}));

import { resetPassword } from '../../../lib/api/auth';
import { ApiError } from '../../../lib/api/client';
import { ResetPasswordForm } from './ResetPasswordForm';

describe('ResetPasswordForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchParamsValue = new URLSearchParams('token=raw-reset-token');
  });

  it('shows an "invalid link" state when there is no token', () => {
    searchParamsValue = new URLSearchParams();
    render(<ResetPasswordForm />);
    expect(screen.getByText(/invalid reset link/i)).toBeDefined();
  });

  it('rejects mismatched passwords before calling the API', async () => {
    render(<ResetPasswordForm />);

    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'a-valid-password-123' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: 'a-different-password-456' },
    });
    fireEvent.click(screen.getByRole('button', { name: /reset password/i }));

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Passwords do not match');
    expect(resetPassword).not.toHaveBeenCalled();
  });

  it('submits the token and new password, then shows success', async () => {
    (resetPassword as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ message: 'ok' });
    render(<ResetPasswordForm />);

    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'a-valid-password-123' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: 'a-valid-password-123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /reset password/i }));

    await waitFor(() => {
      expect(resetPassword).toHaveBeenCalledWith('raw-reset-token', 'a-valid-password-123');
      expect(screen.getByText(/password reset$/i)).toBeDefined();
    });
  });

  it('shows the backend error message for an expired/invalid token', async () => {
    (resetPassword as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError(401, { message: 'Invalid or expired reset token' })
    );
    render(<ResetPasswordForm />);

    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'a-valid-password-123' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: 'a-valid-password-123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /reset password/i }));

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Invalid or expired reset token');
  });
});
