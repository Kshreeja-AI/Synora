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
  isMfaChallenge: (r: unknown) =>
    typeof r === 'object' && r !== null && (r as { mfaRequired?: boolean }).mfaRequired === true,
}));

vi.mock('../../../lib/api/mfa', () => ({
  verifyMfaChallenge: vi.fn(),
  verifyMfaChallengeWithRecoveryCode: vi.fn(),
}));

import { login } from '../../../lib/api/auth';
import { verifyMfaChallenge, verifyMfaChallengeWithRecoveryCode } from '../../../lib/api/mfa';
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

  it('switches to the second-factor step when login returns an MFA challenge', async () => {
    (login as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      mfaRequired: true,
      mfaChallengeToken: 'challenge-1',
      expiresAt: '2026-08-03T00:05:00Z',
    });
    (verifyMfaChallenge as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      mfaVerified: true,
    });
    render(<LoginForm />);

    fillAndSubmit();

    // No redirect yet — the form asks for the authenticator code instead.
    const codeInput = await screen.findByLabelText('Verification code');
    expect(pushMock).not.toHaveBeenCalled();

    fireEvent.change(codeInput, { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /verify/i }));

    await waitFor(() => {
      expect(verifyMfaChallenge).toHaveBeenCalledWith('challenge-1', '123456');
      expect(pushMock).toHaveBeenCalledWith('/dashboard');
    });
  });

  it('supports completing the challenge with a recovery code', async () => {
    (login as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      mfaRequired: true,
      mfaChallengeToken: 'challenge-2',
      expiresAt: '2026-08-03T00:05:00Z',
    });
    (
      verifyMfaChallengeWithRecoveryCode as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ mfaVerified: true });
    render(<LoginForm />);

    fillAndSubmit();
    await screen.findByLabelText('Verification code');

    fireEvent.click(screen.getByRole('button', { name: /use a recovery code instead/i }));
    fireEvent.change(screen.getByLabelText('Recovery code'), {
      target: { value: 'AAAA-BBBB' },
    });
    fireEvent.click(screen.getByRole('button', { name: /verify/i }));

    await waitFor(() => {
      expect(verifyMfaChallengeWithRecoveryCode).toHaveBeenCalledWith('challenge-2', 'AAAA-BBBB');
      expect(pushMock).toHaveBeenCalledWith('/dashboard');
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
