import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client');
  return { ...actual, api: { get: vi.fn(), patch: vi.fn(), upload: vi.fn(), delete: vi.fn(), post: vi.fn() } };
});

import { api } from './client';
import {
  changePassword,
  deleteAccount,
  getCurrentUser,
  getPreferences,
  removeAvatar,
  updatePreferences,
  updateProfile,
  uploadAvatar,
} from './account';

describe('lib/api/account', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getCurrentUser fetches /api/users/me', async () => {
    (api.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'u1' });
    await getCurrentUser();
    expect(api.get).toHaveBeenCalledWith('/api/users/me');
  });

  it('updateProfile patches /api/users/me with the given fields', async () => {
    (api.patch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'u1' });
    await updateProfile({ name: 'Ada', bio: 'Hi' });
    expect(api.patch).toHaveBeenCalledWith('/api/users/me', { name: 'Ada', bio: 'Hi' });
  });

  it('uploadAvatar wraps the file in FormData under the "avatar" field', async () => {
    (api.upload as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ image: 'url' });
    const file = new File(['x'], 'a.png', { type: 'image/png' });

    await uploadAvatar(file);

    expect(api.upload).toHaveBeenCalledWith('/api/users/me/avatar', expect.any(FormData));
    const formData = (api.upload as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as FormData;
    expect(formData.get('avatar')).toBe(file);
  });

  it('removeAvatar deletes /api/users/me/avatar', async () => {
    (api.delete as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ message: 'ok' });
    await removeAvatar();
    expect(api.delete).toHaveBeenCalledWith('/api/users/me/avatar');
  });

  it('changePassword posts current and new password', async () => {
    (api.post as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ message: 'ok' });
    await changePassword('old', 'new');
    expect(api.post).toHaveBeenCalledWith('/api/users/me/password', { currentPassword: 'old', newPassword: 'new' });
  });

  it('getPreferences fetches /api/users/me/preferences', async () => {
    (api.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ theme: 'DARK' });
    await getPreferences();
    expect(api.get).toHaveBeenCalledWith('/api/users/me/preferences');
  });

  it('updatePreferences patches /api/users/me/preferences', async () => {
    (api.patch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ theme: 'LIGHT' });
    await updatePreferences({ theme: 'LIGHT' });
    expect(api.patch).toHaveBeenCalledWith('/api/users/me/preferences', { theme: 'LIGHT' });
  });

  it('deleteAccount deletes /api/users/me with the password in the body', async () => {
    (api.delete as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ message: 'ok' });
    await deleteAccount('my-password');
    expect(api.delete).toHaveBeenCalledWith('/api/users/me', { password: 'my-password' });
  });
});
