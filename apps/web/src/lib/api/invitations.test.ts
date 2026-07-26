import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client');
  return { ...actual, api: { get: vi.fn(), post: vi.fn() } };
});

import { api } from './client';
import { previewInvitation, acceptInvitation } from './invitations';

describe('lib/api/invitations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('previewInvitation fetches anonymously', async () => {
    (api.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ workspaceName: 'Acme' });
    await previewInvitation('tok');
    expect(api.get).toHaveBeenCalledWith('/api/invitations/tok', { anonymous: true });
  });

  it('acceptInvitation posts to the accept endpoint', async () => {
    (api.post as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ workspaceId: 'w1' });
    await acceptInvitation('tok');
    expect(api.post).toHaveBeenCalledWith('/api/invitations/tok/accept');
  });
});
