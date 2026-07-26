import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type React from 'react';
import ProjectsPage from './page';

vi.mock('../../../hooks/useCurrentWorkspace', () => ({
  useCurrentWorkspace: vi.fn(),
}));

vi.mock('../../../lib/api/projects', () => ({
  listProjects: vi.fn(),
  createProject: vi.fn(),
}));

import { useCurrentWorkspace } from '../../../hooks/useCurrentWorkspace';
import { listProjects, createProject } from '../../../lib/api/projects';

const WORKSPACE = { id: 'w1', name: 'Acme Inc', slug: 'acme-inc', role: 'OWNER' as const, memberCount: 1 };

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('ProjectsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows an empty state with no projects', async () => {
    (useCurrentWorkspace as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      currentWorkspace: WORKSPACE,
      isLoading: false,
    });
    (listProjects as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    renderWithClient(<ProjectsPage />);

    await waitFor(() => {
      expect(screen.getByText(/no projects yet/i)).toBeDefined();
    });
  });

  it('lists existing projects', async () => {
    (useCurrentWorkspace as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      currentWorkspace: WORKSPACE,
      isLoading: false,
    });
    (listProjects as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'p1', name: 'Launch Plan', description: 'Q3 launch', workspaceId: 'w1' },
    ]);

    renderWithClient(<ProjectsPage />);

    await waitFor(() => {
      expect(screen.getByText('Launch Plan')).toBeDefined();
    });
  });

  it('creates a project through the dialog', async () => {
    (useCurrentWorkspace as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      currentWorkspace: WORKSPACE,
      isLoading: false,
    });
    (listProjects as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (createProject as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'p1', name: 'New Project' });
    const user = userEvent.setup();

    renderWithClient(<ProjectsPage />);
    await user.click((await screen.findAllByRole('button', { name: /new project/i }))[0]);
    await user.type(screen.getByLabelText('Project name'), 'New Project');
    await user.click(screen.getByRole('button', { name: /create project/i }));

    await waitFor(() => {
      expect(createProject).toHaveBeenCalledWith({ name: 'New Project', workspaceId: 'w1' });
    });
  });

  it('shows an empty state when there is no current workspace', () => {
    (useCurrentWorkspace as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      currentWorkspace: undefined,
      isLoading: false,
    });

    renderWithClient(<ProjectsPage />);

    expect(screen.getByText(/no workspace yet/i)).toBeDefined();
  });
});
