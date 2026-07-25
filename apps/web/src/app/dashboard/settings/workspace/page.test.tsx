import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type React from 'react';
import WorkspaceSettingsPage from './page';

vi.mock('../../../../hooks/useCurrentWorkspace', () => ({
  useCurrentWorkspace: vi.fn(),
}));

vi.mock('../../../../lib/api/workspaces', () => ({
  updateWorkspace: vi.fn(),
  listWorkspaceMembers: vi.fn(),
}));

import { useCurrentWorkspace } from '../../../../hooks/useCurrentWorkspace';
import { updateWorkspace, listWorkspaceMembers } from '../../../../lib/api/workspaces';

const OWNER_WORKSPACE = {
  id: 'w1',
  name: 'Acme Inc',
  slug: 'acme-inc',
  role: 'OWNER' as const,
  memberCount: 1,
};

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('WorkspaceSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (listWorkspaceMembers as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'm1', role: 'OWNER', user: { id: 'u1', name: 'Ada', email: 'ada@example.com', image: null } },
    ]);
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

  it('lists workspace members', async () => {
    (useCurrentWorkspace as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      currentWorkspace: OWNER_WORKSPACE,
      isLoading: false,
    });

    renderWithClient(<WorkspaceSettingsPage />);

    await waitFor(() => {
      expect(screen.getByText('Ada')).toBeDefined();
      expect(screen.getByText('ada@example.com')).toBeDefined();
    });
  });
});
