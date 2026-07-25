import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { useCreateWorkspaceStore } from '../../stores/create-workspace-store';

vi.mock('../../hooks/useCurrentWorkspace', () => ({
  useCurrentWorkspace: vi.fn(),
}));

import { useCurrentWorkspace } from '../../hooks/useCurrentWorkspace';

describe('WorkspaceSwitcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCreateWorkspaceStore.setState({ isOpen: false });
  });

  it('shows a loading skeleton while workspaces load', () => {
    (useCurrentWorkspace as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      workspaces: [],
      currentWorkspace: null,
      setCurrentWorkspaceId: vi.fn(),
      isLoading: true,
    });
    const { container } = render(<WorkspaceSwitcher />);
    expect(container.querySelector('[class*="animate-pulse"]')).not.toBeNull();
  });

  it('shows the current workspace name in the trigger', () => {
    (useCurrentWorkspace as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      workspaces: [{ id: 'w1', name: 'Acme Inc', slug: 'acme-inc', role: 'OWNER', memberCount: 1 }],
      currentWorkspace: { id: 'w1', name: 'Acme Inc', slug: 'acme-inc', role: 'OWNER', memberCount: 1 },
      setCurrentWorkspaceId: vi.fn(),
      isLoading: false,
    });
    render(<WorkspaceSwitcher />);
    expect(screen.getByText('Acme Inc')).toBeDefined();
  });

  it('switches workspaces when another one is selected from the menu', async () => {
    const user = userEvent.setup();
    const setCurrentWorkspaceId = vi.fn();
    (useCurrentWorkspace as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      workspaces: [
        { id: 'w1', name: 'Acme Inc', slug: 'acme-inc', role: 'OWNER', memberCount: 1 },
        { id: 'w2', name: 'Beta Co', slug: 'beta-co', role: 'MEMBER', memberCount: 2 },
      ],
      currentWorkspace: { id: 'w1', name: 'Acme Inc', slug: 'acme-inc', role: 'OWNER', memberCount: 1 },
      setCurrentWorkspaceId,
      isLoading: false,
    });
    render(<WorkspaceSwitcher />);

    await user.click(screen.getByText('Acme Inc'));
    await user.click(await screen.findByText('Beta Co'));

    expect(setCurrentWorkspaceId).toHaveBeenCalledWith('w2');
  });

  it('opens the create-workspace dialog from the menu', async () => {
    const user = userEvent.setup();
    (useCurrentWorkspace as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      workspaces: [{ id: 'w1', name: 'Acme Inc', slug: 'acme-inc', role: 'OWNER', memberCount: 1 }],
      currentWorkspace: { id: 'w1', name: 'Acme Inc', slug: 'acme-inc', role: 'OWNER', memberCount: 1 },
      setCurrentWorkspaceId: vi.fn(),
      isLoading: false,
    });
    render(<WorkspaceSwitcher />);

    await user.click(screen.getByText('Acme Inc'));
    await user.click(await screen.findByText('Create workspace'));

    expect(useCreateWorkspaceStore.getState().isOpen).toBe(true);
  });
});
