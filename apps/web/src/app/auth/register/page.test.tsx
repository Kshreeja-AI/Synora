import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import RegisterPage from './page';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock('../../../lib/api/auth', () => ({
  register: vi.fn(),
}));

import { register } from '../../../lib/api/auth';
import { ApiError } from '../../../lib/api/client';

describe('RegisterPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function fill(overrides: { email?: string; password?: string; confirm?: string } = {}) {
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: overrides.email ?? 'ada@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: overrides.password ?? 'a-valid-password-123' },
    });
    fireEvent.change(screen.getByLabelText('Confirm Password'), {
      target: { value: overrides.confirm ?? overrides.password ?? 'a-valid-password-123' },
    });
  }

  it('registers and redirects to the dashboard', async () => {
    (register as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    render(<RegisterPage />);

    fill();
    fireEvent.click(screen.getByRole('button', { name: /sign up/i }));

    await waitFor(() => {
      expect(register).toHaveBeenCalledWith('ada@example.com', 'a-valid-password-123', undefined);
      expect(pushMock).toHaveBeenCalledWith('/dashboard');
    });
  });

  it('rejects mismatched passwords before calling the API', async () => {
    render(<RegisterPage />);

    fill({ password: 'a-valid-password-123', confirm: 'a-different-password-456' });
    fireEvent.click(screen.getByRole('button', { name: /sign up/i }));

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Passwords do not match');
    expect(register).not.toHaveBeenCalled();
  });

  it('rejects a too-short password before calling the API', async () => {
    render(<RegisterPage />);

    fill({ password: 'short1', confirm: 'short1' });
    fireEvent.click(screen.getByRole('button', { name: /sign up/i }));

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Password must be at least 8 characters'
    );
    expect(register).not.toHaveBeenCalled();
  });

  it('shows the backend error message on failure', async () => {
    (register as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError(400, { message: 'Email already registered' })
    );
    render(<RegisterPage />);

    fill();
    fireEvent.click(screen.getByRole('button', { name: /sign up/i }));

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Email already registered');
  });
});
