/**
 * Two-factor authentication settings: the enrollment wizard (scan →
 * verify → recovery codes) and password-confirmed disable.
 *
 * The property that matters most on "recovery": Finish setup must stay
 * disabled until the person has explicitly acknowledged saving the
 * codes, because they are shown exactly once.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MfaSection } from '../MfaSection';
import * as mfaApi from '../../../lib/api/mfa';
import { ApiError } from '../../../lib/api/client';

vi.mock('../../../lib/api/mfa');

vi.mock('../QrCodeImage', () => ({
  QrCodeImage: ({ value }: { value: string }) => <div data-testid="qr-code">{value}</div>,
}));

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MfaSection />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(mfaApi.getMfaStatus).mockResolvedValue({
    enabled: false,
    type: null,
    status: null,
  });
});

describe('MfaSection — enrollment', () => {
  it('starts from an offer to enable, not already enrolled', async () => {
    renderSection();
    expect(await screen.findByRole('button', { name: /enable two-factor/i })).toBeInTheDocument();
  });

  it('walks scan -> verify -> recovery codes -> finish', async () => {
    vi.mocked(mfaApi.initiateMfaSetup).mockResolvedValue({
      setupToken: 'setup-1',
      secret: 'JBSWY3DPEHPK3PXP',
      qrCode: 'otpauth://totp/Synora:me@example.com?secret=JBSWY3DPEHPK3PXP',
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    });
    vi.mocked(mfaApi.verifyMfaSetup).mockResolvedValue({
      recoveryCodes: ['aaaa-1111', 'bbbb-2222'],
      codeHashes: ['hash1', 'hash2'],
      setupToken: 'setup-1',
    });
    vi.mocked(mfaApi.confirmMfaSetup).mockResolvedValue({ success: true });

    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: /enable two-factor/i }));

    // Scan step: the QR image and the manual-entry secret both appear.
    expect(await screen.findByTestId('qr-code')).toHaveTextContent(
      'otpauth://totp/Synora:me@example.com?secret=JBSWY3DPEHPK3PXP',
    );
    expect(screen.getByText('JBSWY3DPEHPK3PXP')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/verification code/i), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: /verify code/i }));

    expect(await screen.findByText('aaaa-1111')).toBeInTheDocument();
    expect(screen.getByText('bbbb-2222')).toBeInTheDocument();

    // Shown once, so leaving without acknowledging must not be allowed
    // through the primary path.
    const finish = screen.getByRole('button', { name: /finish setup/i });
    expect(finish).toBeDisabled();

    fireEvent.click(screen.getByRole('checkbox'));
    expect(finish).not.toBeDisabled();

    fireEvent.click(finish);

    await waitFor(() =>
      expect(mfaApi.confirmMfaSetup).toHaveBeenCalledWith('setup-1', ['hash1', 'hash2']),
    );
  });

  it('shows the server error when a verification code is rejected', async () => {
    vi.mocked(mfaApi.initiateMfaSetup).mockResolvedValue({
      setupToken: 'setup-1',
      secret: 'SECRET',
      qrCode: 'otpauth://totp/x',
      expiresAt: new Date().toISOString(),
    });
    vi.mocked(mfaApi.verifyMfaSetup).mockRejectedValue(
      new ApiError(400, { message: 'That code was not accepted.' }),
    );

    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: /enable two-factor/i }));
    fireEvent.change(await screen.findByLabelText(/verification code/i), {
      target: { value: '000000' },
    });
    fireEvent.click(screen.getByRole('button', { name: /verify code/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/not accepted/i);
  });

  it('cancel from the scan step returns to the offer, without enrolling', async () => {
    vi.mocked(mfaApi.initiateMfaSetup).mockResolvedValue({
      setupToken: 'setup-1',
      secret: 'SECRET',
      qrCode: 'otpauth://totp/x',
      expiresAt: new Date().toISOString(),
    });

    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: /enable two-factor/i }));
    fireEvent.click(await screen.findByRole('button', { name: /cancel/i }));

    expect(await screen.findByRole('button', { name: /enable two-factor/i })).toBeInTheDocument();
    expect(mfaApi.verifyMfaSetup).not.toHaveBeenCalled();
  });
});

describe('MfaSection — enabled state', () => {
  beforeEach(() => {
    vi.mocked(mfaApi.getMfaStatus).mockResolvedValue({
      enabled: true,
      type: 'TOTP',
      status: 'ACTIVE',
      recoveryCodesRemaining: 7,
      recoveryCodesTotal: 10,
    });
  });

  it('shows enabled status and remaining recovery codes', async () => {
    renderSection();
    expect(await screen.findByText('Enabled')).toBeInTheDocument();
    expect(screen.getByText(/7 of 10 recovery codes remaining/)).toBeInTheDocument();
  });

  it('flags recovery mode distinctly from a healthy enrollment', async () => {
    vi.mocked(mfaApi.getMfaStatus).mockResolvedValue({
      enabled: true,
      type: 'TOTP',
      status: 'RECOVERY_MODE',
      recoveryCodesRemaining: 1,
      recoveryCodesTotal: 10,
    });

    renderSection();
    expect(await screen.findByText(/recovery mode/i)).toBeInTheDocument();
  });

  it('disables only after the account password is confirmed', async () => {
    vi.mocked(mfaApi.disableMfa).mockResolvedValue({ mfaEnabled: false });

    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: /^disable$/i }));

    const passwordField = screen.getByLabelText(/confirm your password to disable/i);
    fireEvent.change(passwordField, { target: { value: 'correct-horse-battery' } });
    fireEvent.click(screen.getByRole('button', { name: /disable two-factor authentication/i }));

    await waitFor(() => expect(mfaApi.disableMfa).toHaveBeenCalledWith('correct-horse-battery'));
  });

  it('shows the server error when the disable password is wrong', async () => {
    vi.mocked(mfaApi.disableMfa).mockRejectedValue(
      new ApiError(400, { message: 'Invalid password' }),
    );

    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: /^disable$/i }));
    fireEvent.change(screen.getByLabelText(/confirm your password to disable/i), {
      target: { value: 'wrong' },
    });
    fireEvent.click(screen.getByRole('button', { name: /disable two-factor authentication/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/invalid password/i);
  });
});
