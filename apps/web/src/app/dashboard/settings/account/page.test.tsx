import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AccountSettingsPage from './page';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock('../../../../lib/api/account', () => ({
  changePassword: vi.fn(),
  getPreferences: vi.fn(),
  updatePreferences: vi.fn(),
  deleteAccount: vi.fn(),
}));

vi.mock('../../../../lib/auth/token-storage', () => ({
  clearTokens: vi.fn(),
}));

import {
  changePassword,
  deleteAccount,
  getPreferences,
  updatePreferences,
} from '../../../../lib/api/account';
import { clearTokens } from '../../../../lib/auth/token-storage';
import { ApiError } from '../../../../lib/api/client';

const preferences = {
  theme: 'DARK' as const,
  emailNotifications: true,
  pushNotifications: false,
  marketingEmails: false,
};

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('AccountSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getPreferences as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(preferences);
  });

  describe('password change', () => {
    it('rejects mismatched new passwords before calling the API', async () => {
      renderWithClient(<AccountSettingsPage />);

      fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'old-password-123' } });
      fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-password-456' } });
      fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'different-789' } });
      fireEvent.click(screen.getByRole('button', { name: /update password/i }));

      expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'New passwords do not match');
      expect(changePassword).not.toHaveBeenCalled();
    });

    it('submits a matching password change', async () => {
      (changePassword as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ message: 'ok' });
      renderWithClient(<AccountSettingsPage />);

      fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'old-password-123' } });
      fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-password-456' } });
      fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'new-password-456' } });
      fireEvent.click(screen.getByRole('button', { name: /update password/i }));

      await waitFor(() => {
        expect(changePassword).toHaveBeenCalledWith('old-password-123', 'new-password-456');
      });
    });

    it('shows the backend error on failure', async () => {
      (changePassword as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
        new ApiError(401, { message: 'Current password is incorrect.' })
      );
      renderWithClient(<AccountSettingsPage />);

      fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'wrong' } });
      fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-password-456' } });
      fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'new-password-456' } });
      fireEvent.click(screen.getByRole('button', { name: /update password/i }));

      expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Current password is incorrect.');
    });
  });

  describe('notification preferences', () => {
    it('loads preferences and toggles one', async () => {
      (updatePreferences as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        ...preferences,
        marketingEmails: true,
      });
      renderWithClient(<AccountSettingsPage />);

      const marketingSwitch = await screen.findByLabelText('Marketing emails');
      fireEvent.click(marketingSwitch);

      await waitFor(() => {
        expect(updatePreferences).toHaveBeenCalled();
      });
      expect((updatePreferences as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toEqual({
        marketingEmails: true,
      });
    });
  });

  describe('account deletion', () => {
    it('keeps the delete button disabled until DELETE is typed and a password is entered', async () => {
      renderWithClient(<AccountSettingsPage />);

      fireEvent.click(screen.getByRole('button', { name: /^delete account$/i }));
      const confirmButton = await screen.findByRole('button', { name: /delete my account/i });
      expect(confirmButton).toBeDisabled();

      fireEvent.change(screen.getByLabelText('Type DELETE to confirm'), { target: { value: 'DELETE' } });
      fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'my-password-123' } });

      expect(confirmButton).not.toBeDisabled();
    });

    it('deletes the account, clears tokens, and redirects home', async () => {
      (deleteAccount as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ message: 'ok' });
      renderWithClient(<AccountSettingsPage />);

      fireEvent.click(screen.getByRole('button', { name: /^delete account$/i }));
      fireEvent.change(await screen.findByLabelText('Type DELETE to confirm'), { target: { value: 'DELETE' } });
      fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'my-password-123' } });
      fireEvent.click(screen.getByRole('button', { name: /delete my account/i }));

      await waitFor(() => {
        expect(deleteAccount).toHaveBeenCalledWith('my-password-123');
        expect(clearTokens).toHaveBeenCalled();
        expect(pushMock).toHaveBeenCalledWith('/');
      });
    });
  });
});
