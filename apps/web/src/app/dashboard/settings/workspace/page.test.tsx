import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type React from 'react';
import WorkspaceSettingsPage from './page';

vi.mock('../../../../hooks/useCurrentWorkspace', () => ({
  useCurrentWorkspace: vi.fn(),
}));

vi.mock('../../../../hooks/useCurrentUser', () => ({
  useCurrentUser: vi.fn(),
}));

vi.mock('../../../../lib/api/workspaces', () => ({
  updateWorkspace: vi.fn(),
  listWorkspaceMembers: vi.fn(),
  updateMemberRole: vi.fn(),
  removeMember: vi.fn(),
  listInvitations: vi.fn(),
  createInvitation: vi.fn(),
  revokeInvitation: vi.fn(),
  listAuditLog: vi.fn(),
}));

import { useCurrentWorkspace } from '../../../../hooks/useCurrentWorkspace';
import { useCurrentUser } from '../../../../hooks/useCurrentUser';
import {
  updateWorkspace,
  listWorkspaceMembers,
  updateMemberRole,
  removeMember,
  listInvitations,
  createInvitation,
  revokeInvitation,
  listAuditLog,
} from '../../../../lib/api/workspaces';

const OWNER_WORKSPACE = {
  id: 'w1',
  name: 'Acme Inc',
  slug: 'acme-inc',
  role: 'OWNER' as const,
  memberCount: 2,
};

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('WorkspaceSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useCurrentUser as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ data: { id: 'u1' } });
    (listWorkspaceMembers as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'm1', role: 'OWNER', createdAt: '', user: { id: 'u1', name: 'Ada', email: 'ada@example.com', image: null } },
      {
        id: 'm2',
        role: 'MEMBER',
        createdAt: '',
        user: { id: 'u2', name: 'Grace', email: 'grace@example.com', image: null },
      },
    ]);
    (listInvitations as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (listAuditLog as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  });

  it('shows the workspace slug and an editable name field for the owner', async () => {
    (useCurrentWorkspace as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      currentWorkspace: OWNER_WORKSPACE,
      isLoading: false,
    });

    renderWithClient(<WorkspaceSettingsPage />);

    expect(screen.getByText(/synora\.ai\/acme-inc/i)).toBeDefined();
    expect(screen.getByLabelText('Workspace name')).toHaveValue('Acme Inc');
  });

  it('saves a rename for the owner', async () => {
    (useCurrentWorkspace as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      currentWorkspace: OWNER_WORKSPACE,
      isLoading: false,
    });
    (updateWorkspace as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ...OWNER_WORKSPACE, name: 'New Name' });

    renderWithClient(<WorkspaceSettingsPage />);

    fireEvent.change(screen.getByLabelText('Workspace name'), { target: { value: 'New Name' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(updateWorkspace).toHaveBeenCalledWith('w1', { name: 'New Name' });
    });
  });

  it('shows a read-only name for a non-owner member, with no rename form', () => {
    (useCurrentWorkspace as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      currentWorkspace: { ...OWNER_WORKSPACE, role: 'MEMBER' },
      isLoading: false,
    });

    renderWithClient(<WorkspaceSettingsPage />);

    expect(screen.getByText(/only the workspace owner can rename/i)).toBeDefined();
    expect(screen.queryByLabelText('Workspace name')).toBeNull();
  });

  it('lists workspace members on the Members tab', async () => {
    (useCurrentWorkspace as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      currentWorkspace: OWNER_WORKSPACE,
      isLoading: false,
    });
    const user = userEvent.setup();

    renderWithClient(<WorkspaceSettingsPage />);
    await user.click(screen.getByRole('tab', { name: 'Members' }));

    await waitFor(() => {
      expect(screen.getByText('Ada')).toBeDefined();
      expect(screen.getByText('Grace')).toBeDefined();
    });
  });

  it('lets the owner change another member’s role', async () => {
    (useCurrentWorkspace as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      currentWorkspace: OWNER_WORKSPACE,
      isLoading: false,
    });
    (updateMemberRole as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'm2', role: 'EDITOR' });
    const user = userEvent.setup();

    renderWithClient(<WorkspaceSettingsPage />);
    await user.click(screen.getByRole('tab', { name: 'Members' }));
    await waitFor(() => expect(screen.getByText('Grace')).toBeDefined());

    const menuButtons = screen.getAllByRole('button', { name: 'Member actions' });
    await user.click(menuButtons[1]);
    await user.click(await screen.findByRole('menuitem', { name: 'Make Editor' }));

    await waitFor(() => {
      expect(updateMemberRole).toHaveBeenCalledWith('w1', 'm2', 'EDITOR');
    });
  });

  it('lets the owner remove another member', async () => {
    (useCurrentWorkspace as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      currentWorkspace: OWNER_WORKSPACE,
      isLoading: false,
    });
    (removeMember as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ message: 'ok' });
    const user = userEvent.setup();

    renderWithClient(<WorkspaceSettingsPage />);
    await user.click(screen.getByRole('tab', { name: 'Members' }));
    await waitFor(() => expect(screen.getByText('Grace')).toBeDefined());

    const menuButtons = screen.getAllByRole('button', { name: 'Member actions' });
    await user.click(menuButtons[1]);
    await user.click(await screen.findByRole('menuitem', { name: 'Remove member' }));

    await waitFor(() => {
      expect(removeMember).toHaveBeenCalledWith('w1', 'm2');
    });
  });

  it('sends an invitation from the Invitations tab', async () => {
    (useCurrentWorkspace as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      currentWorkspace: OWNER_WORKSPACE,
      isLoading: false,
    });
    (createInvitation as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'i1',
      email: 'new@example.com',
      role: 'MEMBER',
    });
    const user = userEvent.setup();

    renderWithClient(<WorkspaceSettingsPage />);
    await user.click(screen.getByRole('tab', { name: 'Invitations' }));
    await user.click(await screen.findByRole('button', { name: 'Invite member' }));

    await user.type(screen.getByLabelText('Email'), 'new@example.com');
    await user.click(screen.getByRole('button', { name: 'Send invitation' }));

    await waitFor(() => {
      expect(createInvitation).toHaveBeenCalledWith('w1', { email: 'new@example.com', role: 'MEMBER' });
    });
  });

  it('lists and revokes a pending invitation', async () => {
    (useCurrentWorkspace as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      currentWorkspace: OWNER_WORKSPACE,
      isLoading: false,
    });
    (listInvitations as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'i1',
        email: 'pending@example.com',
        role: 'MEMBER',
        createdAt: '',
        expiresAt: '',
        invitedBy: { id: 'u1', name: 'Ada', email: 'ada@example.com' },
      },
    ]);
    (revokeInvitation as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ message: 'ok' });
    const user = userEvent.setup();

    renderWithClient(<WorkspaceSettingsPage />);
    await user.click(screen.getByRole('tab', { name: 'Invitations' }));

    await waitFor(() => expect(screen.getByText('pending@example.com')).toBeDefined());
    await user.click(screen.getByRole('button', { name: 'Revoke' }));

    await waitFor(() => {
      expect(revokeInvitation).toHaveBeenCalledWith('w1', 'i1');
    });
  });

  it('shows audit log entries on the Activity tab', async () => {
    (useCurrentWorkspace as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      currentWorkspace: OWNER_WORKSPACE,
      isLoading: false,
    });
    (listAuditLog as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'a1',
        action: 'workspace.updated',
        targetType: 'workspace',
        targetId: 'w1',
        metadata: {},
        createdAt: new Date().toISOString(),
        actor: { id: 'u1', name: 'Ada', email: 'ada@example.com' },
      },
    ]);
    const user = userEvent.setup();

    renderWithClient(<WorkspaceSettingsPage />);
    await user.click(screen.getByRole('tab', { name: 'Activity' }));

    await waitFor(() => {
      expect(screen.getByText(/workspace updated/i)).toBeDefined();
    });
  });
});
