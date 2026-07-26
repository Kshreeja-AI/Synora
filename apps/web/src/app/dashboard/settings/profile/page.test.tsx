import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ProfileSettingsPage from './page';

vi.mock('../../../../hooks/useCurrentUser', () => ({
  useCurrentUser: vi.fn(),
}));
vi.mock('../../../../lib/api/account', () => ({
  updateProfile: vi.fn(),
  uploadAvatar: vi.fn(),
  removeAvatar: vi.fn(),
}));
vi.mock('../../../../lib/api/auth', () => ({
  resendVerificationEmail: vi.fn(),
}));

import { useCurrentUser } from '../../../../hooks/useCurrentUser';
import { removeAvatar, updateProfile, uploadAvatar } from '../../../../lib/api/account';
import { resendVerificationEmail } from '../../../../lib/api/auth';

const baseUser = {
  id: 'u1',
  email: 'ada@example.com',
  name: 'Ada',
  image: null,
  role: 'USER',
  emailVerified: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  profile: { bio: null, website: null, location: null },
  preferences: { theme: 'DARK', emailNotifications: true, pushNotifications: false, marketingEmails: false },
};

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('ProfileSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a skeleton while loading', () => {
    (useCurrentUser as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ data: undefined, isLoading: true });
    renderWithClient(<ProfileSettingsPage />);
    expect(screen.queryByText('Change avatar')).toBeNull();
  });

  it('populates the form from the loaded user and saves changes', async () => {
    (useCurrentUser as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ data: baseUser, isLoading: false });
    (updateProfile as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(baseUser);
    renderWithClient(<ProfileSettingsPage />);

    const nameInput = screen.getByLabelText('Name') as HTMLInputElement;
    expect(nameInput.value).toBe('Ada');

    fireEvent.change(screen.getByLabelText('Bio'), { target: { value: 'Hello world' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(updateProfile).toHaveBeenCalledWith({
        name: 'Ada',
        bio: 'Hello world',
        website: '',
        location: '',
      });
    });
  });

  it('shows a resend-verification link when the email is unverified', async () => {
    (useCurrentUser as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ data: baseUser, isLoading: false });
    (resendVerificationEmail as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ message: 'ok' });
    renderWithClient(<ProfileSettingsPage />);

    expect(screen.getByText(/not verified/i)).toBeDefined();
    fireEvent.click(screen.getByText('Resend verification'));

    await waitFor(() => {
      expect(resendVerificationEmail).toHaveBeenCalled();
    });
  });

  it('does not show the verification prompt once verified', () => {
    (useCurrentUser as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { ...baseUser, emailVerified: true },
      isLoading: false,
    });
    renderWithClient(<ProfileSettingsPage />);
    expect(screen.queryByText(/not verified/i)).toBeNull();
  });

  it('uploads an avatar through the hidden file input', async () => {
    (useCurrentUser as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ data: baseUser, isLoading: false });
    (uploadAvatar as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ image: 'http://localhost:3001/uploads/avatars/u1/x.png' });
    renderWithClient(<ProfileSettingsPage />);

    const file = new File(['bytes'], 'avatar.png', { type: 'image/png' });
    const input = screen.getByLabelText('Upload avatar') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(uploadAvatar).toHaveBeenCalledWith(file);
    });
  });

  it('shows a Remove button and removes the avatar when one is set', async () => {
    (useCurrentUser as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { ...baseUser, image: 'http://localhost:3001/uploads/avatars/u1/x.png' },
      isLoading: false,
    });
    (removeAvatar as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ message: 'ok' });
    renderWithClient(<ProfileSettingsPage />);

    fireEvent.click(screen.getByRole('button', { name: /remove/i }));

    await waitFor(() => {
      expect(removeAvatar).toHaveBeenCalled();
    });
  });
});
