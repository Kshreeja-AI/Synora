import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ForgotPasswordPage from './page';

vi.mock('../../../lib/api/auth', () => ({
  forgotPassword: vi.fn(),
}));

import { forgotPassword } from '../../../lib/api/auth';
import { ApiError } from '../../../lib/api/client';

describe('ForgotPasswordPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a generic confirmation message after submitting, regardless of account existence', async () => {
    (forgotPassword as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ message: 'ok' });
    render(<ForgotPasswordPage />);

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));

    await waitFor(() => {
      expect(forgotPassword).toHaveBeenCalledWith('ada@example.com');
      expect(screen.getByText(/check your email/i)).toBeDefined();
    });
  });

  it('shows the backend error message if the request itself fails', async () => {
    (forgotPassword as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError(429, { message: 'Too many requests' })
    );
    render(<ForgotPasswordPage />);

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Too many requests');
  });
});
