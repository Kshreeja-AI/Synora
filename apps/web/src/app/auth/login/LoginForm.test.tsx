import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LoginForm } from './LoginForm';

const pushMock = vi.fn();
let searchParamsValue = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => searchParamsValue,
}));

vi.mock('../../../lib/api/auth', () => ({
  login: vi.fn(),
}));

import { login } from '../../../lib/api/auth';
import { ApiError } from '../../../lib/api/client';

describe('LoginForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchParamsValue = new URLSearchParams();
  });

  function fillAndSubmit(overrides: { email?: string; password?: string } = {}) {
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: overrides.email ?? 'ada@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: overrides.password ?? 'a-valid-password-123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
  }

  it('logs in and redirects to the dashboard by default', async () => {
    (login as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    render(<LoginForm />);

    fillAndSubmit();

    await waitFor(() => {
      expect(login).toHaveBeenCalledWith('ada@example.com', 'a-valid-password-123', false);
      expect(pushMock).toHaveBeenCalledWith('/dashboard');
    });
  });

  it('passes rememberMe through when the checkbox is checked', async () => {
    (login as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    render(<LoginForm />);

    fireEvent.click(screen.getByLabelText('Remember me'));
    fillAndSubmit();

    await waitFor(() => {
      expect(login).toHaveBeenCalledWith('ada@example.com', 'a-valid-password-123', true);
    });
  });

  it('redirects to a same-origin next path from the query string', async () => {
    searchParamsValue = new URLSearchParams('next=/dashboard/settings');
    (login as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    render(<LoginForm />);

    fillAndSubmit();

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/dashboard/settings');
    });
  });

  it('ignores an external next path to prevent an open redirect', async () => {
    searchParamsValue = new URLSearchParams('next=//evil.example.com');
    (login as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    render(<LoginForm />);

    fillAndSubmit();

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/dashboard');
    });
  });

  it('shows the backend error message on failure', async () => {
    (login as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError(400, { message: 'Invalid email or password' })
    );
    render(<LoginForm />);

    fillAndSubmit();

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('Invalid email or password');
    });
  });

  it('falls back to a generic message for a non-API error', async () => {
    (login as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network down'));
    render(<LoginForm />);

    fillAndSubmit();

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/error occurred/i);
    });
  });
});
