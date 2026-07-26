import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getConfig } from '../config';

vi.mock('../config', () => ({ getConfig: vi.fn() }));

const uploadMock = vi.fn();
const deleteMock = vi.fn();
vi.mock('./resolver', () => ({
  resolveStorageProvider: vi.fn(async () => ({ id: 'local', upload: uploadMock, delete: deleteMock })),
}));

import { uploadAvatar, avatarKeyFromUrl, deleteAvatar, isAllowedAvatarContentType } from './index';

describe('storage facade', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getConfig as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      urls: { backendUrl: 'http://localhost:3001' },
      storage: { publicBasePath: '/uploads' },
    });
  });

  describe('isAllowedAvatarContentType', () => {
    it('allows common image types', () => {
      expect(isAllowedAvatarContentType('image/png')).toBe(true);
      expect(isAllowedAvatarContentType('image/jpeg')).toBe(true);
      expect(isAllowedAvatarContentType('image/webp')).toBe(true);
    });

    it('rejects non-image types', () => {
      expect(isAllowedAvatarContentType('application/pdf')).toBe(false);
      expect(isAllowedAvatarContentType('text/html')).toBe(false);
    });
  });

  describe('uploadAvatar', () => {
    it('uploads with a fresh, per-user key and returns the provider result', async () => {
      uploadMock.mockResolvedValue({ key: 'avatars/user-1/abc.png', url: 'http://localhost:3001/uploads/avatars/user-1/abc.png' });

      const result = await uploadAvatar({ userId: 'user-1', buffer: Buffer.from('x'), contentType: 'image/png' });

      expect(uploadMock).toHaveBeenCalledWith(
        expect.objectContaining({ contentType: 'image/png', key: expect.stringMatching(/^avatars\/user-1\/.+\.png$/) })
      );
      expect(result.url).toContain('avatars/user-1');
    });

    it('rejects an unsupported content type before calling the provider', async () => {
      await expect(
        uploadAvatar({ userId: 'user-1', buffer: Buffer.from('x'), contentType: 'application/pdf' })
      ).rejects.toThrow(/Unsupported avatar content type/);
      expect(uploadMock).not.toHaveBeenCalled();
    });
  });

  describe('avatarKeyFromUrl', () => {
    it('extracts the key from a URL hosted by this app', () => {
      expect(avatarKeyFromUrl('http://localhost:3001/uploads/avatars/user-1/abc.png')).toBe(
        'avatars/user-1/abc.png'
      );
    });

    it('returns null for a URL not hosted by this app', () => {
      expect(avatarKeyFromUrl('https://cdn.example.com/avatars/abc.png')).toBeNull();
    });
  });

  describe('deleteAvatar', () => {
    it('delegates to the resolved provider', async () => {
      await deleteAvatar('avatars/user-1/abc.png');
      expect(deleteMock).toHaveBeenCalledWith('avatars/user-1/abc.png');
    });
  });
});
