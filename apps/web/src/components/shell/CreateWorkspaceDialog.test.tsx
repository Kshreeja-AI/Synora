import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type React from 'react';
import { CreateWorkspaceDialog } from './CreateWorkspaceDialog';
import { useCreateWorkspaceStore } from '../../stores/create-workspace-store';
import { useWorkspaceStore } from '../../stores/workspace-store';

vi.mock('../../lib/api/workspaces', () => ({
  createWorkspace: vi.fn(),
}));

import { createWorkspace } from '../../lib/api/workspaces';

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  return { ...result, client };
}

describe('CreateWorkspaceDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCreateWorkspaceStore.setState({ isOpen: false });
    useWorkspaceStore.setState({ currentWorkspaceId: null });
  });

  it('is not visible when the store is closed', () => {
    renderWithClient(<CreateWorkspaceDialog />);
    expect(screen.queryByText('Create workspace')).toBeNull();
  });

  it('creates a workspace, selects it, and closes on success', async () => {
    useCreateWorkspaceStore.setState({ isOpen: true });
    (createWorkspace as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'w1',
      name: 'Acme Inc',
      slug: 'acme-inc',
    });

    const { client } = renderWithClient(<CreateWorkspaceDialog />);
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');

    fireEvent.change(screen.getByLabelText('Workspace name'), { target: { value: 'Acme Inc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }));

    await waitFor(() => {
      expect(createWorkspace).toHaveBeenCalledWith({ name: 'Acme Inc' });
      expect(useWorkspaceStore.getState().currentWorkspaceId).toBe('w1');
      expect(useCreateWorkspaceStore.getState().isOpen).toBe(false);
    });

    // Creating a workspace also creates a real "Workspace created" notification
    // server-side, so the notifications cache must be invalidated too.
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['workspaces'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['notifications'] });
  });

  it('closes without creating when Cancel is clicked', () => {
    useCreateWorkspaceStore.setState({ isOpen: true });
    renderWithClient(<CreateWorkspaceDialog />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(useCreateWorkspaceStore.getState().isOpen).toBe(false);
    expect(createWorkspace).not.toHaveBeenCalled();
  });
});
