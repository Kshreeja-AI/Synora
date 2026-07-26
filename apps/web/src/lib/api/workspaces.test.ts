import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client');
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } };
});

import { api } from './client';
import {
  listWorkspaces,
  createWorkspace,
  getWorkspace,
  updateWorkspace,
  listWorkspaceMembers,
  updateMemberRole,
  removeMember,
  listInvitations,
  createInvitation,
  revokeInvitation,
  listAuditLog,
} from './workspaces';

describe('lib/api/workspaces', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('listWorkspaces fetches /api/workspaces', async () => {
    (api.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await listWorkspaces();
    expect(api.get).toHaveBeenCalledWith('/api/workspaces');
  });

  it('createWorkspace posts the name and description', async () => {
    (api.post as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'w1' });
    await createWorkspace({ name: 'Acme', description: 'A company' });
    expect(api.post).toHaveBeenCalledWith('/api/workspaces', { name: 'Acme', description: 'A company' });
  });

  it('getWorkspace fetches /api/workspaces/:id', async () => {
    (api.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'w1' });
    await getWorkspace('w1');
    expect(api.get).toHaveBeenCalledWith('/api/workspaces/w1');
  });

  it('updateWorkspace patches /api/workspaces/:id', async () => {
    (api.patch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'w1' });
    await updateWorkspace('w1', { name: 'New Name' });
    expect(api.patch).toHaveBeenCalledWith('/api/workspaces/w1', { name: 'New Name' });
  });

  it('listWorkspaceMembers fetches /api/workspaces/:id/members', async () => {
    (api.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await listWorkspaceMembers('w1');
    expect(api.get).toHaveBeenCalledWith('/api/workspaces/w1/members');
  });

  it('updateMemberRole patches the member role', async () => {
    (api.patch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'm1' });
    await updateMemberRole('w1', 'm1', 'ADMIN');
    expect(api.patch).toHaveBeenCalledWith('/api/workspaces/w1/members/m1', { role: 'ADMIN' });
  });

  it('removeMember deletes the membership', async () => {
    (api.delete as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ message: 'ok' });
    await removeMember('w1', 'm1');
    expect(api.delete).toHaveBeenCalledWith('/api/workspaces/w1/members/m1');
  });

  it('listInvitations fetches pending invitations', async () => {
    (api.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await listInvitations('w1');
    expect(api.get).toHaveBeenCalledWith('/api/workspaces/w1/invitations');
  });

  it('createInvitation posts email and role', async () => {
    (api.post as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'i1' });
    await createInvitation('w1', { email: 'a@b.com', role: 'MEMBER' });
    expect(api.post).toHaveBeenCalledWith('/api/workspaces/w1/invitations', { email: 'a@b.com', role: 'MEMBER' });
  });

  it('revokeInvitation deletes the invitation', async () => {
    (api.delete as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ message: 'ok' });
    await revokeInvitation('w1', 'i1');
    expect(api.delete).toHaveBeenCalledWith('/api/workspaces/w1/invitations/i1');
  });

  it('listAuditLog fetches the audit log', async () => {
    (api.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await listAuditLog('w1');
    expect(api.get).toHaveBeenCalledWith('/api/workspaces/w1/audit-log');
  });
});
